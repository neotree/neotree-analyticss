package app.neotree.downloads

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

/** Tracks HTTP downloads and saves WebView-generated exports to public Downloads. */
class NeotreeDownloadsModule : Module() {
  private data class ExportSession(
    val file: File,
    val output: FileOutputStream,
    val name: String,
    val mime: String,
    val expected: Long,
    var written: Long = 0
  )

  private val sessions = mutableMapOf<String, ExportSession>()
  private val maxExportBytes = 100L * 1024 * 1024

  private fun discard(id: String) {
    synchronized(sessions) {
      sessions.remove(id)?.let { session ->
        try { session.output.close() } finally { session.file.delete() }
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("NeotreeDownloads")

    AsyncFunction("startExport") { id: String, requestedName: String, mime: String, size: Double ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      require(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) { "Saving exports to Downloads requires Android 10 or newer" }
      require(id.matches(Regex("[A-Za-z0-9_-]{1,64}"))) { "Invalid export identifier" }
      require(size.isFinite() && size >= 0 && size <= maxExportBytes) { "Export is too large" }
      require(mime.length in 1..100 && !mime.contains('\n')) { "Invalid file type" }
      val name = requestedName.substringAfterLast('/').substringAfterLast('\\')
        .replace(Regex("[^A-Za-z0-9._ -]"), "_").take(120).trim().ifEmpty { "export" }
      val file = File.createTempFile("neotree-export-", ".part", context.cacheDir)
      synchronized(sessions) {
        if (sessions.containsKey(id)) {
          file.delete()
          throw IllegalArgumentException("Export already exists")
        }
        sessions[id] = ExportSession(file, FileOutputStream(file), name, mime, size.toLong())
      }
      name
    }

    AsyncFunction("appendExport") { id: String, encoded: String ->
      require(encoded.length <= 90_000) { "Export chunk is too large" }
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
      try {
        session.output.close()
        require(session.written == session.expected) { "Export is incomplete" }
        val resolver = context.contentResolver
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, session.name)
          put(MediaStore.Downloads.MIME_TYPE, session.mime)
          put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
          put(MediaStore.Downloads.IS_PENDING, 1)
        }
        uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
          ?: throw IllegalStateException("Could not create Downloads file")
        resolver.openOutputStream(uri)?.use { output ->
          session.file.inputStream().use { input -> input.copyTo(output) }
        } ?: throw IllegalStateException("Could not write Downloads file")
        resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        session.name
      } catch (error: Exception) {
        if (uri != null) context.contentResolver.delete(uri, null, null)
        throw error
      } finally {
        session.file.delete()
      }
    }

    AsyncFunction("abortExport") { id: String -> discard(id) }

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
