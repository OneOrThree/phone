package com.oneorthree.gromo.subjectmask

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.UUID
import java.util.concurrent.ExecutionException
import kotlin.math.max
import kotlin.math.roundToInt

// 피사체 누끼 로컬 네이티브 모듈(안드로이드) — iOS SubjectMaskModule.swift의 안드 대응.
// Google ML Kit Subject Segmentation(온디바이스)으로 사진에서 주 피사체만 잘라 투명 PNG로
// 캐시에 저장하고 그 file:// URI를 돌려준다. JS 계약(services/subjectMask.ts)은 iOS와 동일하다.
//
// 그레이스풀 원칙: GMS 없음·모델 미다운로드·피사체 미검출 등 어떤 실패에서도 cutout()은 throw하지
// 않고 원본 URI + cutout:false + reason 을 돌려준다(iOS와 동일). 화면은 원본 사진으로라도 진행한다.
class SubjectMaskModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    // JS에서 requireOptionalNativeModule('SubjectMask')로 찾는 이름 — iOS Swift와 동일해야 한다.
    Name("SubjectMask")

    // 누끼 지원 여부 — ML Kit는 GMS(구글 플레이 서비스)에 의존하므로 GMS 가용성으로 판정한다.
    Function("isSupported") {
      isGmsAvailable()
    }

    // 사진 URI → 누끼 PNG URI. AsyncFunction은 백그라운드 스레드에서 돌아 JS/UI를 막지 않는다.
    AsyncFunction("cutout") { uri: String ->
      cutout(uri)
    }

    // 합성된 오브젝트 캐릭터(팔·다리·눈까지 구워진 투명 PNG)를 앱 내부 저장소에 영구 저장한다.
    // 화면에서 캡처한 base64 PNG를 그대로 받아 customCharacter.png 한 장으로 덮어쓴다(항상 1장 유지).
    // cutout과 달리 실패 시 폴백하지 않고 throw한다(영구 저장은 성공/실패가 명확해야 한다).
    AsyncFunction("saveCustomCharacter") { base64: String ->
      saveCustomCharacter(base64)
    }
  }

  // MARK: - 누끼

  private fun cutout(uri: String): Map<String, Any> {
    // GMS가 없는 기기(화웨이 등)는 ML Kit 자체가 동작하지 않는다 — 원본 폴백.
    if (!isGmsAvailable()) return resultMap(uri, 0, 0, false, "gms_unavailable")

    val decoded = loadNormalizedBitmap(uri) ?: return resultMap(uri, 0, 0, false, "load_failed")
    val bitmap = decoded.bitmap
    val rotation = decoded.rotationDegrees
    // 폴백 시 돌려줄 '표시 기준' 크기 — 90/270도 회전이면 가로세로가 뒤바뀐다.
    val orientedWidth = if (rotation == 90 || rotation == 270) bitmap.height else bitmap.width
    val orientedHeight = if (rotation == 90 || rotation == 270) bitmap.width else bitmap.height

    val segmenter = SubjectSegmentation.getClient(
      SubjectSegmenterOptions.Builder().enableForegroundBitmap().build(),
    )
    try {
      // EXIF 회전각을 InputImage에 전달 — 세로로 찍은 사진이 눕지 않게 한다
      // (iOS는 kCGImageSourceCreateThumbnailWithTransform로 픽셀에 방향을 반영해 정규화한다).
      val input = InputImage.fromBitmap(bitmap, rotation)
      // ML Kit Task를 백그라운드 스레드에서 동기 대기해 Promise로 브리지한다
      // (AsyncFunction 본문은 JS 스레드가 아니라 별도 스레드에서 실행되므로 await가 안전하다).
      val result = Tasks.await(segmenter.process(input))
      // foregroundBitmap: 배경이 투명해진 비트맵. 피사체를 못 찾으면 null → 원본 폴백.
      val foreground = result.foregroundBitmap
        ?: return resultMap(uri, orientedWidth, orientedHeight, false, "no_subject")
      val outWidth = foreground.width
      val outHeight = foreground.height
      val outUri = savePng(foreground) // savePng이 foreground를 recycle한다.
      return resultMap(outUri, outWidth, outHeight, true, "")
    } catch (e: Exception) {
      // 모델 미다운로드는 재시도하면 되는 일시 상태 — 안내 문구가 다르므로 별도 사유로 구분한다.
      val cause = (e as? ExecutionException)?.cause ?: e
      val reason = if (cause is MlKitException && cause.errorCode == MlKitException.UNAVAILABLE) {
        "model_downloading"
      } else {
        "vision_failed"
      }
      return resultMap(uri, orientedWidth, orientedHeight, false, reason)
    } finally {
      segmenter.close()
      bitmap.recycle()
    }
  }

  // MARK: - 영구 저장

  private fun saveCustomCharacter(base64: String): String {
    val bytes = try {
      Base64.decode(base64, Base64.DEFAULT)
    } catch (e: IllegalArgumentException) {
      throw SubjectMaskDecodeException()
    }
    // 유효한 이미지인지 확인만 한다(iOS는 UIImage(data:)로 검증). 저장은 원본 바이트를 그대로 쓴다.
    val probe = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw SubjectMaskDecodeException()
    probe.recycle()

    // filesDir = 앱 내부 영구 저장소(iOS Documents 대응). 이전 파일을 덮어써 항상 1장만 유지한다.
    val file = File(context.filesDir, "customCharacter.png")
    FileOutputStream(file).use { it.write(bytes) }
    return Uri.fromFile(file).toString()
  }

  // 누끼 PNG를 캐시에 저장하고 file:// 절대경로를 돌려준다. 화면은 항상 마지막 1장만 쓰므로
  // 저장 전에 이전 결과를 지워 '다시 선택'을 반복해도 파일이 쌓이지 않게 한다(iOS와 동일).
  private fun savePng(bitmap: Bitmap): String {
    val dir = File(context.cacheDir, "subject-mask").apply {
      mkdirs()
      listFiles()?.forEach { it.delete() }
    }
    val file = File(dir, "cutout-${UUID.randomUUID()}.png")
    try {
      FileOutputStream(file).use { out ->
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
      }
    } finally {
      bitmap.recycle()
    }
    return Uri.fromFile(file).toString()
  }

  // MARK: - 이미지 로딩

  private data class DecodedImage(val bitmap: Bitmap, val rotationDegrees: Int)

  // URI를 읽어 긴 변 최대 1600px로 줄인 비트맵 + EXIF 회전각을 만든다.
  // 다운샘플을 디코드 단계(inSampleSize)에서 먼저 하는 이유: 48MP·파노라마를 원본 해상도로 풀
  // 디코드하면 메모리가 치솟아 OOM으로 죽고, OOM은 폴백조차 불가능해지기 때문이다(iOS 스파이크와 동일).
  private fun loadNormalizedBitmap(uri: String, maxSide: Int = 1600): DecodedImage? {
    val parsed = try {
      Uri.parse(uri)
    } catch (_: Exception) {
      return null
    }

    // 1) 크기만 먼저 읽는다(inJustDecodeBounds).
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    openStream(parsed)?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: return null
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    // 2) EXIF 회전각(0/90/180/270)을 읽는다.
    val rotation = openStream(parsed)?.use { readExifRotation(it) } ?: 0

    // 3) inSampleSize(2의 거듭제곱)로 목표의 ~2배 이하까지 줄여 디코드한다.
    val options = BitmapFactory.Options().apply {
      inSampleSize = computeInSampleSize(bounds.outWidth, bounds.outHeight, maxSide)
    }
    val decoded = openStream(parsed)?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null

    // 4) 긴 변을 정확히 maxSide로 맞춘다(원본이 이미 작으면 확대하지 않음).
    return DecodedImage(scaleToMaxSide(decoded, maxSide), rotation)
  }

  // file://·content:// URI 모두 ContentResolver로 스트림을 연다(이미지 피커가 둘 중 하나를 줄 수 있음).
  private fun openStream(uri: Uri): InputStream? = try {
    context.contentResolver.openInputStream(uri)
  } catch (_: Exception) {
    null
  }

  // EXIF 방향 태그 → 회전 각도. 반전(flip/transpose) 계열은 ML Kit이 각도만 받으므로 0으로 취급한다(희귀).
  private fun readExifRotation(input: InputStream): Int = try {
    when (ExifInterface(input).getAttributeInt(
      ExifInterface.TAG_ORIENTATION,
      ExifInterface.ORIENTATION_NORMAL,
    )) {
      ExifInterface.ORIENTATION_ROTATE_90 -> 90
      ExifInterface.ORIENTATION_ROTATE_180 -> 180
      ExifInterface.ORIENTATION_ROTATE_270 -> 270
      else -> 0
    }
  } catch (_: Exception) {
    0
  }

  // 긴 변이 maxSide*2를 넘지 않을 때까지 2배씩 줄이는 샘플링 배수. 이후 4)에서 정확히 맞춘다.
  private fun computeInSampleSize(width: Int, height: Int, maxSide: Int): Int {
    var sample = 1
    val longSide = max(width, height)
    while (longSide / (sample * 2) >= maxSide) {
      sample *= 2
    }
    return sample
  }

  // 긴 변을 정확히 maxSide로 축소한다. 원본이 이미 작으면 그대로 둔다(확대 금지).
  private fun scaleToMaxSide(src: Bitmap, maxSide: Int): Bitmap {
    val longSide = max(src.width, src.height)
    if (longSide <= maxSide) return src
    val ratio = maxSide.toFloat() / longSide
    val width = (src.width * ratio).roundToInt().coerceAtLeast(1)
    val height = (src.height * ratio).roundToInt().coerceAtLeast(1)
    val scaled = Bitmap.createScaledBitmap(src, width, height, true)
    if (scaled != src) src.recycle()
    return scaled
  }

  // MARK: - 유틸

  private fun isGmsAvailable(): Boolean =
    GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

  // JS로 그대로 넘어가는 결과 객체 — iOS Record와 같은 형태 {uri,width,height,cutout,reason}.
  private fun resultMap(uri: String, width: Int, height: Int, cutout: Boolean, reason: String): Map<String, Any> =
    mapOf(
      "uri" to uri,
      "width" to width,
      "height" to height,
      "cutout" to cutout,
      "reason" to reason,
    )
}

// saveCustomCharacter 실패 시 JS로 던지는 에러(iOS decodeFailed 대응).
private class SubjectMaskDecodeException :
  CodedException("커스텀 캐릭터 이미지를 디코드하지 못했어요.")
