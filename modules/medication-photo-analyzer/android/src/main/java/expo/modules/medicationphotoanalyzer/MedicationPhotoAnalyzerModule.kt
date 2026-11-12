package expo.modules.medicationphotoanalyzer

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.exifinterface.media.ExifInterface
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.roundToInt

class MedicationPhotoAnalyzerModule : Module() {
  private val analyzing = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("MedicationPhotoAnalyzer")

    // Burns the capture date and time into the photo so the caregiver sees when it was taken.
    // Returns a new JPEG in the app cache; the original camera file is left untouched.
    AsyncFunction("stampPhoto") { uri: String, label: String ->
      try {
        stamp(uri, label)
      } catch (_: Exception) {
        throw PhotoStampException()
      }
    }

    // Expo dispatches AsyncFunction's body off the JavaScript thread.
    AsyncFunction("analyzePhoto") { uri: String, promise: Promise ->
      if (!analyzing.compareAndSet(false, true)) {
        promise.reject("ERR_ANALYZER_BUSY", "사진 확인 중이에요. 잠시 후 다시 시도해 주세요.", null)
        return@AsyncFunction
      }

      var bitmap: Bitmap? = null
      var recognizer: TextRecognizer? = null
      var deadlineHandler: Handler? = null
      var deadlineRunnable: Runnable? = null
      try {
        val file = checkedFile(uri)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        require(bounds.outWidth in 1..20000 && bounds.outHeight in 1..20000)
        val orientation = ExifInterface(file).getAttributeInt(
          ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL
        )
        val swapped = orientation in listOf(
          ExifInterface.ORIENTATION_TRANSPOSE, ExifInterface.ORIENTATION_ROTATE_90,
          ExifInterface.ORIENTATION_TRANSVERSE, ExifInterface.ORIENTATION_ROTATE_270
        )
        val width = if (swapped) bounds.outHeight else bounds.outWidth
        val height = if (swapped) bounds.outWidth else bounds.outHeight
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > 2048) sample *= 2
        val decoded = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply {
          inSampleSize = sample
          inPreferredConfig = Bitmap.Config.ARGB_8888
        }) ?: throw IllegalArgumentException("Unreadable image")
        bitmap = decoded
        val oriented = orient(decoded, orientation)
        if (oriented !== decoded) decoded.recycle()
        bitmap = oriented
        val quality = quality(oriented)
        val requestBitmap = oriented
        val requestRecognizer = TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
        recognizer = requestRecognizer
        val settled = AtomicBoolean(false)
        val handler = Handler(Looper.getMainLooper())
        deadlineHandler = handler
        val deadline = Runnable {
          if (settled.compareAndSet(false, true)) {
            promise.reject("ERR_ANALYSIS_TIMEOUT", "사진 확인이 지연되고 있어요. 잠시 후 다시 촬영해 주세요.", null)
            runCatching { requestRecognizer.close() }
          }
        }
        deadlineRunnable = deadline
        val recognition = requestRecognizer.process(InputImage.fromBitmap(requestBitmap, 0))
        handler.postDelayed(deadline, 15000L)
        recognition.addOnCompleteListener { task ->
            try {
              if (!settled.compareAndSet(false, true)) return@addOnCompleteListener
              if (task.isSuccessful) {
                promise.resolve(mapOf(
                  "text" to task.result.text.take(20000),
                  "width" to width,
                  "height" to height,
                  "meanLuminance" to quality.mean,
                  "darkPixelRatio" to quality.darkRatio,
                  "blurScore" to quality.laplacianVariance
                ))
              } else {
                // Do not include OCR output, a local URI, or patient data in errors/logs.
                promise.reject("ERR_TEXT_RECOGNITION", "사진의 글자를 확인하지 못했어요. 다시 촬영해 주세요.", null)
              }
            } finally {
              handler.removeCallbacks(deadline)
              runCatching { requestRecognizer.close() }
              // Keep the bitmap alive until ML Kit really finishes, even after timeout.
              requestBitmap.recycle()
              analyzing.set(false)
            }
          }
      } catch (_: Exception) {
        deadlineRunnable?.let { deadlineHandler?.removeCallbacks(it) }
        recognizer?.let { runCatching { it.close() } }
        bitmap?.let { if (!it.isRecycled) it.recycle() }
        analyzing.set(false)
        promise.reject("ERR_PHOTO_ANALYSIS", "촬영한 사진을 확인하지 못했어요. 다시 촬영해 주세요.", null)
      }
    }
  }

  private fun stamp(uri: String, label: String): Map<String, Any> {
    require(label.isNotBlank() && label.length <= 80)
    val context = appContext.reactContext ?: throw IllegalStateException("No application context")
    val file = checkedFile(uri)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    require(bounds.outWidth in 1..20000 && bounds.outHeight in 1..20000)
    val orientation = ExifInterface(file).getAttributeInt(
      ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL
    )
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / sample > 4096) sample *= 2
    val decoded = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.ARGB_8888
      inMutable = true
    }) ?: throw IllegalArgumentException("Unreadable image")
    var bitmap = orient(decoded, orientation)
    if (bitmap !== decoded) decoded.recycle()
    if (!bitmap.isMutable) {
      val copy = bitmap.copy(Bitmap.Config.ARGB_8888, true)
      bitmap.recycle()
      bitmap = copy
    }
    try {
      drawStamp(bitmap, label)
      val output = File(context.cacheDir, "dose-stamped-${UUID.randomUUID()}.jpg")
      FileOutputStream(output).use { stream ->
        require(bitmap.compress(Bitmap.CompressFormat.JPEG, 88, stream))
      }
      return mapOf("uri" to Uri.fromFile(output).toString(), "width" to bitmap.width, "height" to bitmap.height)
    } finally {
      bitmap.recycle()
    }
  }

  /** A dark rounded label in the bottom-left corner, sized to the photo and never wider than it. */
  private fun drawStamp(bitmap: Bitmap, label: String) {
    val canvas = Canvas(bitmap)
    val shorter = minOf(bitmap.width, bitmap.height).toFloat()
    val margin = shorter * 0.03f
    val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      textSize = shorter * 0.045f
    }
    val available = bitmap.width - margin * 2
    val padding = text.textSize * 0.6f
    val measured = text.measureText(label) + padding * 2
    if (measured > available) text.textSize *= available / measured
    val pad = text.textSize * 0.6f
    val metrics = text.fontMetrics
    val bottom = bitmap.height - margin
    val top = bottom - (metrics.descent - metrics.ascent) - pad * 2
    val box = RectF(margin, top, margin + text.measureText(label) + pad * 2, bottom)
    val background = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(160, 0, 0, 0) }
    canvas.drawRoundRect(box, pad * 0.7f, pad * 0.7f, background)
    canvas.drawText(label, margin + pad, top + pad - metrics.ascent, text)
  }

  private fun checkedFile(value: String): File {
    val context = appContext.reactContext ?: throw IllegalStateException("No application context")
    val uri = Uri.parse(value)
    require(uri.scheme == "file" && uri.host.isNullOrEmpty() && uri.query == null && uri.fragment == null)
    val file = File(requireNotNull(uri.path)).canonicalFile
    val roots = listOfNotNull(context.cacheDir, context.filesDir, context.externalCacheDir)
    require(roots.any { file.path.startsWith(it.canonicalPath + File.separator) })
    require(file.isFile && file.canRead() && file.length() in 1L..(32L * 1024 * 1024))
    return file
  }

  private fun orient(bitmap: Bitmap, orientation: Int): Bitmap {
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(270f); matrix.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(270f)
      else -> return bitmap
    }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
  }

  private data class Quality(val mean: Double, val darkRatio: Double, val laplacianVariance: Double)

  private fun quality(bitmap: Bitmap): Quality {
    val scale = minOf(1.0, 320.0 / max(bitmap.width, bitmap.height))
    val width = max(1, (bitmap.width * scale).roundToInt())
    val height = max(1, (bitmap.height * scale).roundToInt())
    val sample = Bitmap.createScaledBitmap(bitmap, width, height, true)
    try {
      val pixels = IntArray(width * height)
      sample.getPixels(pixels, 0, width, 0, 0, width, height)
      val gray = DoubleArray(pixels.size)
      var total = 0.0
      var dark = 0
      for (index in pixels.indices) {
        val color = pixels[index]
        val value = 0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)
        gray[index] = value
        total += value
        if (value < 32.0) dark++
      }
      var sum = 0.0
      var squared = 0.0
      var count = 0
      for (y in 1 until height - 1) {
        for (x in 1 until width - 1) {
          val index = y * width + x
          val laplacian = gray[index - 1] + gray[index + 1] + gray[index - width] + gray[index + width] - 4.0 * gray[index]
          sum += laplacian
          squared += laplacian * laplacian
          count++
        }
      }
      val mean = if (count == 0) 0.0 else sum / count
      val variance = if (count == 0) 0.0 else max(0.0, squared / count - mean * mean)
      return Quality(total / pixels.size, dark.toDouble() / pixels.size, variance)
    } finally {
      if (sample !== bitmap) sample.recycle()
    }
  }
}

private class PhotoStampException :
  expo.modules.kotlin.exception.CodedException("ERR_PHOTO_STAMP", "사진을 저장할 준비를 하지 못했어요. 다시 촬영해 주세요.", null)
