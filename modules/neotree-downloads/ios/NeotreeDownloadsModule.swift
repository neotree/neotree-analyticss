import ExpoModulesCore
import ImageIO
import UIKit

final class ExportException: GenericException<String>, @unchecked Sendable {
  override var reason: String { param }
}

/**
 * iOS counterpart of the Android module. Receives WebView-generated exports in chunks (same contract as
 * Android), writes them to a protected temporary folder, and hands the finished file to the share sheet,
 * where the user can choose "Save to Files". Nothing is kept after the export is dismissed or the
 * session ends, and leftovers from a killed app are removed on launch.
 */
public final class NeotreeDownloadsModule: Module {
  private struct Session {
    let handle: FileHandle
    let partURL: URL
    let name: String
    let mime: String
    let expected: Int64
    var written: Int64
  }

  private var sessions: [String: Session] = [:]
  private var ready: [String: URL] = [:]
  private let lock = NSLock()
  private weak var sheet: UIActivityViewController?
  private var pendingShare: Promise?

  private let maxExportBytes: Int64 = 100 * 1024 * 1024
  // About 200 dpi across an A4 content width.
  private let maxPdfPixelWidth: CGFloat = 1600
  // Long dashboards are rendered at a lower resolution instead of exhausting memory.
  private let maxPdfBitmapBytes: CGFloat = 96 * 1024 * 1024
  private let minPdfPixelWidth: CGFloat = 600
  private let maxPdfPages = 150

  private var exportsDirectory: URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("neotree-exports", isDirectory: true)
  }

  public func definition() -> ModuleDefinition {
    Name("NeotreeDownloads")

    OnCreate {
      // Leftovers from an app that was killed mid-export or while a share sheet was open.
      _ = try? FileManager.default.removeItem(at: self.exportsDirectory)
    }

    AsyncFunction("startExport") { (id: String, requestedName: String, mime: String, size: Double) -> String in
      guard id.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil else {
        throw ExportException("Invalid export identifier")
      }
      guard size.isFinite, size >= 0, size <= Double(self.maxExportBytes) else { throw ExportException("Export is too large") }
      guard (1...100).contains(mime.count), !mime.contains("\n") else { throw ExportException("Invalid file type") }

      let name = Self.sanitize(requestedName)
      let folder = self.exportsDirectory
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      let partURL = folder.appendingPathComponent("\(id).part")
      guard FileManager.default.createFile(atPath: partURL.path, contents: nil, attributes: [.protectionKey: FileProtectionType.complete]) else {
        throw ExportException("Could not create export file")
      }
      let handle = try FileHandle(forWritingTo: partURL)

      self.lock.lock()
      defer { self.lock.unlock() }
      if self.sessions[id] != nil || self.ready[id] != nil {
        try? handle.close()
        try? FileManager.default.removeItem(at: partURL)
        throw ExportException("Export already exists")
      }
      self.sessions[id] = Session(handle: handle, partURL: partURL, name: name, mime: mime, expected: Int64(size), written: 0)
      return name
    }

    AsyncFunction("appendExport") { (id: String, encoded: String) -> Double in
      guard encoded.count <= 360_000, let bytes = Data(base64Encoded: encoded) else {
        throw ExportException("Invalid export chunk")
      }
      self.lock.lock()
      defer { self.lock.unlock() }
      guard var session = self.sessions[id] else { throw ExportException("Unknown export") }
      let total = session.written + Int64(bytes.count)
      guard total <= self.maxExportBytes, total <= session.expected else { throw ExportException("Export exceeds announced size") }
      try session.handle.write(contentsOf: bytes)
      session.written = total
      self.sessions[id] = session
      return Double(total)
    }

    AsyncFunction("finishExport") { (id: String) -> String in
      self.lock.lock()
      let removed = self.sessions.removeValue(forKey: id)
      self.lock.unlock()
      guard let session = removed else { throw ExportException("Unknown export") }

      // Each export gets its own folder so the share sheet shows the real file name.
      let folder = self.exportsDirectory.appendingPathComponent(id, isDirectory: true)
      do {
        try session.handle.close()
        guard session.written == session.expected else { throw ExportException("Export is incomplete") }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let finalURL = folder.appendingPathComponent(session.name)
        if session.mime.hasPrefix("image/") && session.name.lowercased().hasSuffix(".pdf") {
          try self.imageToPdf(session.partURL, finalURL)
          try? FileManager.default.removeItem(at: session.partURL)
        } else {
          try FileManager.default.moveItem(at: session.partURL, to: finalURL)
        }
        try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: finalURL.path)
        self.lock.lock()
        self.ready[id] = finalURL
        self.lock.unlock()
        return session.name
      } catch {
        try? FileManager.default.removeItem(at: session.partURL)
        try? FileManager.default.removeItem(at: folder)
        throw error
      }
    }

    AsyncFunction("abortExport") { (id: String) in
      self.discard(id)
    }

    AsyncFunction("discardExport") { (id: String) in
      self.discard(id)
    }

    // Resolves true when the user completed an action (e.g. Save to Files), false when they closed the sheet.
    AsyncFunction("shareExport") { (id: String, promise: Promise) in
      self.lock.lock()
      let url = self.ready[id]
      self.lock.unlock()
      guard let url else {
        promise.reject(ExportException("This export is no longer available. Please export again."))
        return
      }
      guard self.sheet == nil, let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject(ExportException("Could not open the share sheet"))
        return
      }

      let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
      // "Save Image" needs Photos permission (crashes without it) and would copy health data into the
      // photo library and iCloud Photos. Contacts and Reading List make no sense for exports.
      controller.excludedActivityTypes = [.saveToCameraRoll, .assignToContact, .addToReadingList]
      // iPad presents the sheet as a popover, which must be anchored or UIKit raises an exception.
      if let popover = controller.popoverPresentationController {
        popover.sourceView = presenter.view
        popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
        popover.permittedArrowDirections = []
      }
      controller.completionWithItemsHandler = { [weak self] _, completed, _, _ in
        guard let self, let pending = self.pendingShare else { return }
        self.pendingShare = nil
        pending.resolve(completed)
      }
      self.pendingShare = promise
      self.sheet = controller
      presenter.present(controller, animated: true)
    }.runOnQueue(.main)

    // Called when a session ends: closes the share sheet and removes every export file.
    AsyncFunction("discardAllExports") {
      if let pending = self.pendingShare {
        self.pendingShare = nil
        pending.resolve(false)
      }
      self.sheet?.dismiss(animated: false)
      self.sheet = nil
      self.lock.lock()
      let open = Array(self.sessions.values)
      self.sessions.removeAll()
      self.ready.removeAll()
      self.lock.unlock()
      open.forEach { try? $0.handle.close() }
      try? FileManager.default.removeItem(at: self.exportsDirectory)
    }.runOnQueue(.main)
  }

  private func discard(_ id: String) {
    lock.lock()
    let session = sessions.removeValue(forKey: id)
    let url = ready.removeValue(forKey: id)
    lock.unlock()
    if let session {
      try? session.handle.close()
      try? FileManager.default.removeItem(at: session.partURL)
    }
    if let url {
      try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }
  }

  private static func sanitize(_ requested: String) -> String {
    let base = requested.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? ""
    let cleaned = base.replacingOccurrences(of: "[^A-Za-z0-9._ -]", with: "_", options: .regularExpression)
    let trimmed = String(cleaned.prefix(120)).trimmingCharacters(in: .whitespaces)
    // A name made only of dots would point at the folder itself.
    return trimmed.isEmpty || trimmed.allSatisfy({ $0 == "." }) ? "export" : trimmed
  }

  /**
   * Splits a dashboard screenshot into A4 pages. ImageIO decodes straight to a reduced size (about
   * 200 dpi, lower for very long dashboards), so the full-resolution bitmap is never held in memory.
   */
  private func imageToPdf(_ imageURL: URL, _ pdfURL: URL) throws {
    guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue,
          let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue,
          width > 0, height > 0 else {
      throw ExportException("Could not decode dashboard image")
    }

    let pageSize = CGSize(width: 595, height: 842)
    let margin: CGFloat = 20
    let contentWidth = pageSize.width - 2 * margin
    let contentHeight = pageSize.height - 2 * margin
    let pageCount = Int((CGFloat(height) / (contentHeight * CGFloat(width) / contentWidth)).rounded(.up))
    guard pageCount <= maxPdfPages else {
      throw ExportException("This dashboard is too long to save as a PDF. Try Download as Image instead.")
    }

    let budgetScale = (maxPdfBitmapBytes / (CGFloat(width) * CGFloat(height) * 4)).squareRoot()
    let scale = min(1, maxPdfPixelWidth / CGFloat(width), budgetScale)
    guard CGFloat(width) * scale >= min(CGFloat(width), minPdfPixelWidth) else {
      throw ExportException("This dashboard is too long to save as a PDF. Try Download as Image instead.")
    }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: Int((CGFloat(max(width, height)) * scale).rounded(.up)),
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
      throw ExportException("This dashboard is too large to save as a PDF on this device. Try Download as Image instead.")
    }

    let imageWidth = image.width
    let imageHeight = image.height
    let stripHeight = max(1, Int(contentHeight * CGFloat(imageWidth) / contentWidth))
    var failed = false
    let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: pageSize))
    try renderer.writePDF(to: pdfURL) { context in
      var top = 0
      while top < imageHeight {
        let bottom = min(top + stripHeight, imageHeight)
        guard let strip = image.cropping(to: CGRect(x: 0, y: top, width: imageWidth, height: bottom - top)) else {
          failed = true
          return
        }
        context.beginPage()
        let drawnHeight = CGFloat(bottom - top) * contentWidth / CGFloat(imageWidth)
        UIImage(cgImage: strip).draw(in: CGRect(x: margin, y: margin, width: contentWidth, height: drawnHeight))
        top = bottom
      }
    }
    if failed {
      try? FileManager.default.removeItem(at: pdfURL)
      throw ExportException("Could not convert the dashboard to PDF")
    }
  }
}
