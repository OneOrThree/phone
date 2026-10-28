package com.oneorthree.gromo.subjectmask

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
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
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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

    // 사진 URI → 누끼 PNG URI. Coroutine으로 선언해 무거운 ML Kit 대기를 IO 디스패처로 넘긴다 —
    // 기본 AsyncFunction 본문은 Expo의 단일 공유 스레드(expo.modules.AsyncFunctionQueue)에서 돌아,
    // 거기서 블로킹 대기하면 앱 전체의 다른 네이티브 Promise가 함께 밀리기 때문이다.
    AsyncFunction("cutout") Coroutine { uri: String ->
      cutout(uri)
    }

    // 합성된 오브젝트 캐릭터(팔·다리·눈까지 구워진 투명 PNG)를 앱 내부 저장소에 영구 저장한다.
    // 화면에서 캡처한 base64 PNG를 그대로 받아 customCharacter.png 한 장으로 덮어쓴다(항상 1장 유지).
    // cutout과 달리 실패 시 폴백하지 않고 throw한다(영구 저장은 성공/실패가 명확해야 한다).
    AsyncFunction("saveCustomCharacter") Coroutine { base64: String, userId: String? ->
      saveCustomCharacter(base64, userId)
    }
  }

  // MARK: - 누끼

  private suspend fun cutout(uri: String): Map<String, Any> = withContext(Dispatchers.IO) {
    // GMS가 없는 기기(화웨이 등)는 ML Kit 자체가 동작하지 않는다 — 원본 폴백.
    if (!isGmsAvailable()) return@withContext resultMap(uri, 0, 0, false, "gms_unavailable")

    // EXIF 방향은 loadNormalizedBitmap이 픽셀에 반영해두므로, 비트맵 크기가 곧 표시 기준 크기다.
    val bitmap = loadNormalizedBitmap(uri)
      ?: return@withContext resultMap(uri, 0, 0, false, "load_failed")
    val orientedWidth = bitmap.width
    val orientedHeight = bitmap.height

    val segmenter = SubjectSegmentation.getClient(
      SubjectSegmenterOptions.Builder().enableForegroundBitmap().build(),
    )
    try {
      // 방향이 이미 픽셀에 반영돼 있으므로 회전각 0으로 넘긴다.
      val input = InputImage.fromBitmap(bitmap, 0)
      // ML Kit Task를 (IO 디스패처 위에서) 동기 대기해 Promise로 브리지한다.
      val result = Tasks.await(segmenter.process(input))
      // foregroundBitmap: 배경이 투명해진 비트맵. 피사체를 못 찾으면 null → 원본 폴백.
      val foreground = result.foregroundBitmap
        ?: return@withContext resultMap(uri, orientedWidth, orientedHeight, false, "no_subject")
      // ML Kit은 원본 캔버스 크기 그대로(피사체 밖은 투명)를 주므로, 피사체 알파 경계로 잘라
      // 크기를 실제 물체에 맞춘다(iOS croppedToInstancesExtent 대응). 안 자르면 JS로 넘어간
      // 크기가 여백을 포함해, 화면에서 눈·팔·다리가 물체에서 떠 버린다.
      // foreground가 전부 투명(불투명 픽셀 0 = 피사체 미검출)이면 crop이 null — 원본 폴백(no_subject).
      // 안 그러면 빈 캔버스에 팔다리·눈만 얹힌 결과를 cutout:true로 저장하게 된다.
      val cropped = cropToAlphaBounds(foreground)
      if (cropped == null) {
        foreground.recycle()
        return@withContext resultMap(uri, orientedWidth, orientedHeight, false, "no_subject")
      }
      val outWidth = cropped.width
      val outHeight = cropped.height
      val outUri = savePng(cropped) // savePng이 cropped를 recycle한다.
      resultMap(outUri, outWidth, outHeight, true, "")
    } catch (e: Exception) {
      // 모델 미다운로드는 재시도하면 되는 일시 상태 — 안내 문구가 다르므로 별도 사유로 구분한다.
      val cause = (e as? ExecutionException)?.cause ?: e
      val reason = if (cause is MlKitException && cause.errorCode == MlKitException.UNAVAILABLE) {
        "model_downloading"
      } else {
        "vision_failed"
      }
      resultMap(uri, orientedWidth, orientedHeight, false, reason)
    } finally {
      segmenter.close()
      bitmap.recycle()
    }
  }

  // ML Kit foregroundBitmap은 원본 캔버스 크기 그대로(피사체 밖은 투명)라, 피사체가 사진을 꽉
  // 채우지 않으면 투명 여백이 붙는다. 불투명(알파≠0) 픽셀의 경계 사각형으로 잘라 크기를 물체에
  // 맞춘 새 비트맵을 돌려준다. 잘라낸 경우 원본은 recycle한다.
  private fun cropToAlphaBounds(src: Bitmap): Bitmap? {
    val width = src.width
    val height = src.height
    val pixels = IntArray(width * height)
    src.getPixels(pixels, 0, width, 0, 0, width, height)

    var minX = width
    var minY = height
    var maxX = -1
    var maxY = -1
    for (y in 0 until height) {
      val row = y * width
      for (x in 0 until width) {
        // 최상위 8비트가 알파. 0이 아니면 피사체 픽셀.
        if (pixels[row + x] ushr 24 != 0) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }

    // 불투명 픽셀이 하나도 없으면(피사체 미검출) null — 호출측이 no_subject 원본 폴백을 타게 한다.
    if (maxX < minX || maxY < minY) return null
    val cropW = maxX - minX + 1
    val cropH = maxY - minY + 1
    // 이미 꽉 차 있으면(여백 없음) 그대로 둔다.
    if (cropW == width && cropH == height) return src

    val cropped = Bitmap.createBitmap(src, minX, minY, cropW, cropH)
    if (cropped != src) src.recycle()
    return cropped
  }

  // MARK: - 영구 저장

  // userId: 한 기기에 두 계정이 각각 누끼 캐릭터를 만들면 파일이 공유돼 서로 덮어써지므로
  // (iOS와 동일) userId별 파일명으로 저장한다. JS 래퍼가 (base64, userId ?? null) 2인자로 부르며,
  // 인자 수가 네이티브 선언과 맞아야 Expo가 호출을 거부하지 않는다. userId가 없으면 단일 파일명 폴백.
  private suspend fun saveCustomCharacter(base64: String, userId: String?): String = withContext(Dispatchers.IO) {
    val bytes = try {
      Base64.decode(base64, Base64.DEFAULT)
    } catch (e: IllegalArgumentException) {
      throw SubjectMaskDecodeException()
    }
    // 유효한 이미지인지 확인만 한다(iOS는 UIImage(data:)로 검증). 저장은 원본 바이트를 그대로 쓴다.
    val probe = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw SubjectMaskDecodeException()
    probe.recycle()

    // filesDir = 앱 내부 영구 저장소(iOS Documents 대응). 유저별 파일이라 그 유저의 이전 파일만 교체된다.
    // 임시 파일에 먼저 쓴 뒤 원자적으로 rename한다 — 쓰기 도중 죽거나 저장이 실패해도 이전
    // 캐릭터가 부분/빈 파일로 깨지지 않게 한다(iOS .atomic 쓰기 대응).
    val fileName = customCharacterFileName(userId)
    val file = File(context.filesDir, fileName)
    val tmp = File(context.filesDir, "$fileName.tmp")
    FileOutputStream(tmp).use { it.write(bytes) }
    if (!tmp.renameTo(file)) {
      tmp.delete()
      throw SubjectMaskSaveException()
    }
    Uri.fromFile(file).toString()
  }

  // 유저별 캐릭터 파일명 — userId가 없거나 빈 값이면 단일 파일명으로 폴백(하위호환, iOS와 동일).
  // 영숫자·하이픈·언더스코어만 남겨 방어적으로 정제하고, 정제 후 비면(비ASCII만 있던 경우) 폴백해
  // 잘못된 파일명으로 저장 실패하는 일을 막는다.
  private fun customCharacterFileName(userId: String?): String {
    if (userId.isNullOrEmpty()) return "customCharacter.png"
    val safe = userId.filter { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '-' || it == '_' }
    return if (safe.isEmpty()) "customCharacter.png" else "customCharacter_$safe.png"
  }

  // 누끼 PNG를 캐시에 저장하고 file:// 절대경로를 돌려준다. 화면은 항상 마지막 1장만 쓰므로
  // 저장 전에 이전 결과를 지워 '다시 선택'을 반복해도 파일이 쌓이지 않게 한다(iOS와 동일).
  private fun savePng(bitmap: Bitmap): String {
    val dir = File(context.cacheDir, "subject-mask").apply {
      mkdirs()
      listFiles()?.forEach { it.delete() }
    }
    val file = File(dir, "cutout-${UUID.randomUUID()}.png")
    val encoded = try {
      FileOutputStream(file).use { out ->
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
      }
    } finally {
      bitmap.recycle()
    }
    // compress가 false면 빈/부분 파일이 남는다 — 지우고 실패로 던져 cutout의 catch가 원본
    // 폴백(vision_failed)을 타게 한다(iOS encodeFailed 대응).
    if (!encoded) {
      file.delete()
      throw IllegalStateException("PNG 인코딩에 실패했어요.")
    }
    return Uri.fromFile(file).toString()
  }

  // MARK: - 이미지 로딩

  // URI를 읽어 긴 변 최대 1600px로 줄이고 EXIF 방향을 픽셀에 반영한 비트맵을 만든다.
  // 다운샘플을 디코드 단계(inSampleSize)에서 먼저 하는 이유: 48MP·파노라마를 원본 해상도로 풀
  // 디코드하면 메모리가 치솟아 OOM으로 죽고, OOM은 폴백조차 불가능해지기 때문이다(iOS 스파이크와 동일).
  private fun loadNormalizedBitmap(uri: String, maxSide: Int = 1600): Bitmap? {
    val parsed = try {
      Uri.parse(uri)
    } catch (_: Exception) {
      return null
    }

    // 1) 크기만 먼저 읽는다(inJustDecodeBounds).
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    openStream(parsed)?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: return null
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    // 2) EXIF 방향 태그(1~8)를 읽는다.
    val orientation =
      openStream(parsed)?.use { readExifOrientation(it) } ?: ExifInterface.ORIENTATION_NORMAL

    // 3) inSampleSize(2의 거듭제곱)로 목표의 ~2배 이하까지 줄여 디코드한다.
    val options = BitmapFactory.Options().apply {
      inSampleSize = computeInSampleSize(bounds.outWidth, bounds.outHeight, maxSide)
    }
    val decoded = openStream(parsed)?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null

    // 4) 긴 변을 정확히 maxSide로 맞추고, 5) EXIF 방향을 픽셀에 굽는다.
    //    ML Kit은 회전각(0/90/180/270)만 받아 반전(flip/transpose)을 표현할 수 없으므로, 8개
    //    방향을 모두 픽셀에 반영해 올바로 세운 뒤 회전 0으로 넘긴다(iOS WithTransform 정규화 대응).
    val scaled = scaleToMaxSide(decoded, maxSide)
    return applyExifOrientation(scaled, orientation)
  }

  // file://·content:// URI 모두 ContentResolver로 스트림을 연다(이미지 피커가 둘 중 하나를 줄 수 있음).
  private fun openStream(uri: Uri): InputStream? = try {
    context.contentResolver.openInputStream(uri)
  } catch (_: Exception) {
    null
  }

  // EXIF 방향 태그(1~8)를 그대로 돌려준다. 못 읽으면 정상(회전 없음)으로 간주.
  private fun readExifOrientation(input: InputStream): Int = try {
    ExifInterface(input).getAttributeInt(
      ExifInterface.TAG_ORIENTATION,
      ExifInterface.ORIENTATION_NORMAL,
    )
  } catch (_: Exception) {
    ExifInterface.ORIENTATION_NORMAL
  }

  // 8개 EXIF 방향(회전 + 반전)을 Matrix로 픽셀에 반영해 똑바로 세운 비트맵을 만든다.
  // 방향 처리가 필요 없으면(NORMAL/UNDEFINED) 원본을 그대로 돌려주고, 변형한 경우 원본은 recycle한다.
  private fun applyExifOrientation(src: Bitmap, orientation: Int): Bitmap {
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> {
        matrix.setRotate(180f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.setRotate(90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.setRotate(-90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
      else -> return src
    }
    val rotated = Bitmap.createBitmap(src, 0, 0, src.width, src.height, matrix, true)
    if (rotated != src) src.recycle()
    return rotated
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

// saveCustomCharacter 디코드 실패 시 JS로 던지는 에러(iOS decodeFailed 대응).
private class SubjectMaskDecodeException :
  CodedException("커스텀 캐릭터 이미지를 디코드하지 못했어요.")

// saveCustomCharacter 저장(원자적 교체) 실패 시 JS로 던지는 에러 — 이전 캐릭터는 보존된다.
private class SubjectMaskSaveException :
  CodedException("커스텀 캐릭터를 저장하지 못했어요.")
