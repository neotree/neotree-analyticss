package app.neotree.downloads

import android.app.Activity
import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.pdf.PdfDocument
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.WebStorage
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

/**
 * Tracks HTTP downloads and saves WebView-generated exports. Android 10+ writes straight to public
 * Downloads. Android 7-9 cannot without a storage permission (blocked for this app), so the finished
 * file is kept privately and the user saves it with the system "Save as" picker.
 */
class NeotreeDownloadsModule : Module() {
  private data class ReadyExport(val file: File, val mime: String)
  private data class PendingSave(val id: String, val promise: Promise)

  private data class ExportSession(
    val file: File,
    val output: FileOutputStream,
    val name: String,
    val mime: String,
    val expected: Long,
    var written: Long = 0
  )

  private val sessions = mutableMapOf<String, ExportSession>()
  // Android 7-9 only: finished exports waiting for "Save as". Guarded by `sessions`.
  private val ready = mutableMapOf<String, ReadyExport>()
  private var pendingSave: PendingSave? = null
  private val saveRequestCode = 0x4E54
  private val savesToDownloads = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
  private val maxExportBytes = 100L * 1024 * 1024
  // About 200 dpi across an A4 content width; one decoded strip then stays near 15 MB.
  private val maxPdfPixelWidth = 1600
  private val maxPdfPages = 150

  /**
   * Splits a dashboard screenshot into A4 pages. Each page-sized strip is decoded on its own and
   * downsampled to about 200 dpi, so a very tall or wide dashboard never needs the whole image in memory.
   */
  private fun imageToPdf(imageFile: File, pdfFile: File) {
    val decoder = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      BitmapRegionDecoder.newInstance(imageFile.absolutePath)
    } else {
      @Suppress("DEPRECATION")
      BitmapRegionDecoder.newInstance(imageFile.absolutePath, false)
    }) ?: throw IllegalArgumentException("Could not decode dashboard image")
    val pdf = PdfDocument()
    try {
      val imageWidth = decoder.width
      val imageHeight = decoder.height
      require(imageWidth > 0 && imageHeight > 0) { "Could not decode dashboard image" }
      val pageWidth = 595
      val pageHeight = 842
      val margin = 20f
      val contentWidth = pageWidth - 2 * margin
      val contentHeight = pageHeight - 2 * margin
      val sourcePageHeight = (contentHeight * imageWidth / contentWidth).toInt().coerceAtLeast(1)
      val pageCount = (imageHeight + sourcePageHeight - 1) / sourcePageHeight
      require(pageCount <= maxPdfPages) { "This dashboard is too long to save as a PDF. Try Download as Image instead." }
      var sample = 1
      while (imageWidth / sample > maxPdfPixelWidth) sample *= 2
      val options = BitmapFactory.Options().apply { inSampleSize = sample }
      val paint = Paint(Paint.FILTER_BITMAP_FLAG)
      var top = 0
      var pageNumber = 1
      while (top < imageHeight) {
        val bottom = (top + sourcePageHeight).coerceAtMost(imageHeight)
        val strip = decoder.decodeRegion(Rect(0, top, imageWidth, bottom), options)
          ?: throw IllegalArgumentException("Could not decode dashboard image")
        try {
          val page = pdf.startPage(PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber++).create())
          val drawnHeight = (bottom - top) * contentWidth / imageWidth
          page.canvas.drawBitmap(strip, null, RectF(margin, margin, margin + contentWidth, margin + drawnHeight), paint)
          pdf.finishPage(page)
        } finally {
          strip.recycle()
        }
        top = bottom
      }
      FileOutputStream(pdfFile).use { pdf.writeTo(it) }
    } finally {
      pdf.close()
      decoder.recycle()
    }
  }

  private fun readyFolder(context: Context) = File(context.cacheDir, "neotree-exports")

  private fun discard(id: String) {
    synchronized(sessions) {
      sessions.remove(id)?.let { session ->
        try { session.output.close() } finally { session.file.delete() }
      }
      ready.remove(id)?.file?.parentFile?.deleteRecursively()
    }
  }

  /** Removes every export file, including leftovers from an app that was killed mid-export. */
  private fun discardAll(context: Context?) {
    synchronized(sessions) {
      sessions.values.forEach { runCatching { it.output.close() } }
      sessions.clear()
      ready.clear()
    }
    val cache = context?.cacheDir ?: return
    cache.listFiles { file -> file.name.startsWith("neotree-export-") || file.name.startsWith("neotree-pdf-") }
      ?.forEach { it.delete() }
    readyFolder(context).deleteRecursively()
  }

  /** Copies a finished export into the document the user created with "Save as". Runs off the main thread. */
  private fun completeSave(context: Context, save: PendingSave, target: android.net.Uri) {
    Thread {
      val export = synchronized(sessions) { ready[save.id] }
      val resolver = context.contentResolver
      try {
        if (export == null) {
          // The session ended while the picker was open: remove the empty file the picker created.
          runCatching { DocumentsContract.deleteDocument(resolver, target) }
          save.promise.resolve(false)
          return@Thread
        }
        resolver.openOutputStream(target)?.use { output ->
          export.file.inputStream().use { input -> input.copyTo(output) }
        } ?: throw IllegalStateException("Could not write the selected file")
        save.promise.resolve(true)
      } catch (error: Throwable) {
        runCatching { DocumentsContract.deleteDocument(resolver, target) }
        save.promise.reject("ERR_SAVE_EXPORT", error.message ?: "Could not save the export", error)
      }
    }.start()
  }

  override fun definition() = ModuleDefinition {
    Name("NeotreeDownloads")

    OnCreate { discardAll(appContext.reactContext) }

    OnActivityResult { activity, payload ->
      if (payload.requestCode != saveRequestCode) return@OnActivityResult
      val save = pendingSave ?: return@OnActivityResult
      pendingSave = null
      val target = payload.data?.data
      if (payload.resultCode != Activity.RESULT_OK || target == null) save.promise.resolve(false)
      else completeSave(activity.applicationContext, save, target)
    }

    AsyncFunction("startExport") { id: String, requestedName: String, mime: String, size: Double ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      require(id.matches(Regex("[A-Za-z0-9_-]{1,64}"))) { "Invalid export identifier" }
      require(size.isFinite() && size >= 0 && size <= maxExportBytes) { "Export is too large" }
      require(mime.length in 1..100 && !mime.contains('\n')) { "Invalid file type" }
      val name = requestedName.substringAfterLast('/').substringAfterLast('\\')
        .replace(Regex("[^A-Za-z0-9._ -]"), "_").take(120).trim()
        // A name made only of dots would point at a folder rather than a file.
        .let { if (it.isEmpty() || it.all { c -> c == '.' }) "export" else it }
      val file = File.createTempFile("neotree-export-", ".part", context.cacheDir)
      synchronized(sessions) {
        if (sessions.containsKey(id) || ready.containsKey(id)) {
          file.delete()
          throw IllegalArgumentException("Export already exists")
        }
        sessions[id] = ExportSession(file, FileOutputStream(file), name, mime, size.toLong())
      }
      name
    }

    AsyncFunction("appendExport") { id: String, encoded: String ->
      require(encoded.length <= 360_000) { "Export chunk is too large" }
      val bytes = Base64.decode(encoded, Base64.DEFAULT)
      synchronized(sessions) {
        val session = sessions[id] ?: throw IllegalArgumentException("Unknown export")
        require(session.written + bytes.size <= maxExportBytes && session.written + bytes.size <= session.expected) {
          "Export exceeds announced size"
        }
        session.output.write(bytes)
        session.written += bytes.size
        session.written.toDouble()
      }
    }

    AsyncFunction("finishExport") { id: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val session = synchronized(sessions) {
        sessions.remove(id) ?: throw IllegalArgumentException("Unknown export")
      }
      var uri: android.net.Uri? = null
      var converted: File? = null
      try {
        session.output.close()
        require(session.written == session.expected) { "Export is incomplete" }
        val convertToPdf = session.mime.startsWith("image/") && session.name.endsWith(".pdf", ignoreCase = true)
        if (convertToPdf) {
          val pdfFile = File.createTempFile("neotree-pdf-", ".pdf", context.cacheDir)
          converted = pdfFile
          imageToPdf(session.file, pdfFile)
        }
        val finalMime = if (convertToPdf) "application/pdf" else session.mime
        if (!savesToDownloads) {
          // Android 7-9: keep the file privately until the user picks a location with "Save as".
          val folder = File(readyFolder(context), id).apply { mkdirs() }
          val kept = File(folder, session.name)
          if (!(converted ?: session.file).renameTo(kept)) throw IllegalStateException("Could not prepare the export")
          synchronized(sessions) { ready[id] = ReadyExport(kept, finalMime) }
          return@AsyncFunction session.name
        }
        val resolver = context.contentResolver
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, session.name)
          put(MediaStore.Downloads.MIME_TYPE, finalMime)
          put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
          put(MediaStore.Downloads.IS_PENDING, 1)
        }
        uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
          ?: throw IllegalStateException("Could not create Downloads file")
        resolver.openOutputStream(uri)?.use { output ->
          (converted ?: session.file).inputStream().use { input -> input.copyTo(output) }
        } ?: throw IllegalStateException("Could not write Downloads file")
        resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        session.name
      } catch (error: Throwable) {
        // Throwable, not Exception: an OutOfMemoryError must still remove the pending Downloads entry.
        if (uri != null) runCatching { context.contentResolver.delete(uri, null, null) }
        if (!savesToDownloads) runCatching { File(readyFolder(context), id).deleteRecursively() }
        if (error is OutOfMemoryError) {
          throw IllegalStateException("This dashboard is too large to save as a PDF on this device. Try Download as Image instead.", error)
        }
        throw error
      } finally {
        session.file.delete()
        converted?.delete()
      }
    }

    AsyncFunction("abortExport") { id: String -> discard(id) }

    AsyncFunction("discardExport") { id: String -> discard(id) }

    // An open "Save as" picker cannot be closed from here; when it reports back, completeSave finds no
    // file and removes the empty document the picker created.
    AsyncFunction("discardAllExports") { discardAll(appContext.reactContext) }

    // Android 7-9: opens the system "Save as" picker. Resolves true once the file is written there,
    // false if the user cancelled.
    AsyncFunction("shareExport") { id: String, promise: Promise ->
      val activity = appContext.currentActivity
        ?: return@AsyncFunction promise.reject(Exceptions.MissingActivity())
      val export = synchronized(sessions) { ready[id] }
        ?: return@AsyncFunction promise.reject("ERR_SAVE_EXPORT", "This export is no longer available. Please export again.", null)
      if (pendingSave != null) return@AsyncFunction promise.reject("ERR_SAVE_EXPORT", "A save is already in progress", null)
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = export.mime
        putExtra(Intent.EXTRA_TITLE, export.file.name)
      }
      pendingSave = PendingSave(id, promise)
      try {
        activity.startActivityForResult(intent, saveRequestCode)
      } catch (error: Throwable) {
        pendingSave = null
        promise.reject("ERR_SAVE_EXPORT", "This device has no app for saving files", error)
      }
    }.runOnQueue(Queues.MAIN)

    // Ends this device's Superset session: the WebView's `incognito` only wipes cookies when the next
    // WebView mounts, so without this a signed-in cookie stays on disk after a lock or country switch.
    // CookieManager and WebStorage must be used from a thread with a Looper, hence the main queue.
    AsyncFunction("clearWebSession") { promise: Promise ->
      try {
        val cookies = CookieManager.getInstance()
        WebStorage.getInstance().deleteAllData()
        cookies.removeAllCookies {
          cookies.flush()
          promise.resolve(null)
        }
      } catch (error: Throwable) {
        promise.reject("ERR_CLEAR_WEB_SESSION", error.message ?: "Could not clear the web session", error)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("listDownloads") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      val result = mutableListOf<Map<String, Any?>>()
      manager.query(DownloadManager.Query())?.use { cursor ->
        val idIndex = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)
        val titleIndex = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE)
        val statusIndex = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)
        val doneIndex = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
        val totalIndex = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
        while (cursor.moveToNext()) {
          result.add(mapOf(
            "id" to cursor.getLong(idIndex).toString(),
            "name" to (cursor.getString(titleIndex) ?: "file"),
            "status" to cursor.getInt(statusIndex),
            "downloaded" to cursor.getLong(doneIndex).toDouble(),
            "total" to cursor.getLong(totalIndex).toDouble()
          ))
        }
      }
      result
    }
  }
}
