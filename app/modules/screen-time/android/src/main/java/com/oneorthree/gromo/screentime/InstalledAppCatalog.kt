package com.oneorthree.gromo.screentime

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import java.io.File
import java.text.Collator

// 설치 앱 카탈로그(GROMO-995) — RN 앱 선택 피커가 그릴 런처 앱 목록을 만든다.
// 조회 범위는 QUERY_ALL_PACKAGES(민감 권한·Play 선언 폼 필요) 대신 매니페스트 <queries>의
// 런처 인텐트 선언으로 한정한다(03-스크린타임-구현 §8) — 홈 화면에 아이콘 있는 앱만 보인다.
//
// 아이콘 노출 방식: base64 문자열 대신 캐시 디렉토리의 PNG 파일(file:// URI)로 노출한다.
// 100개+ 목록을 base64로 나르면 브릿지 페이로드가 수 MB가 되고 JS 힙에 계속 상주하는 반면,
// 파일 URI는 RN Image가 행 단위로 지연 로드하고 네이티브 이미지 캐시를 그대로 탄다.
internal object InstalledAppCatalog {

  private const val ICON_DIR = "screen_time_app_icons"
  private const val ICON_SIZE_PX = 96 // 48dp@2x — 목록 행 아이콘(40pt) 표시에 충분

  // 런처 앱 목록 — [{ packageName, label, iconUri }] 라벨 기준 로케일 정렬(한국어면 가나다순).
  // 자기 자신(gromo)은 제외한다 — 측정 대상으로도 집중 허용앱으로도 고르게 할 이유가 없다
  // (허용앱은 자기 앱이라 항상 사용 가능, M3 실드도 자기 앱은 차단하지 않는다).
  fun launcherApps(context: Context): List<Map<String, String>> {
    val pm = context.packageManager
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val resolved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0L))
    } else {
      @Suppress("DEPRECATION")
      pm.queryIntentActivities(intent, 0)
    }
    val iconDir = File(context.cacheDir, ICON_DIR).apply { mkdirs() }
    val seen = HashSet<String>()
    val apps = ArrayList<Map<String, String>>()
    for (info in resolved) {
      val pkg = info.activityInfo?.packageName ?: continue
      if (!seen.add(pkg)) continue // 런처 액티비티가 여럿인 앱은 1개로 합친다
      if (pkg == context.packageName) continue
      val label = info.loadLabel(pm)?.toString()?.takeIf { it.isNotBlank() } ?: pkg
      apps.add(
        mapOf(
          "packageName" to pkg,
          "label" to label,
          "iconUri" to iconUri(pm, info, pkg, iconDir),
        ),
      )
    }
    val collator = Collator.getInstance()
    apps.sortWith(compareBy(collator) { it["label"] ?: "" })
    return apps
  }

  // 아이콘 캐시 파일의 file:// URI — 없거나 앱이 업데이트됐으면(mtime < lastUpdateTime) 다시 그린다.
  // 실패는 빈 문자열로 — 아이콘 하나 때문에 목록 전체를 막지 않는다(JS가 이니셜 폴백을 그림).
  private fun iconUri(pm: PackageManager, info: ResolveInfo, pkg: String, iconDir: File): String {
    return try {
      val file = File(iconDir, "$pkg.png")
      val lastUpdate = try {
        pm.getPackageInfo(pkg, 0).lastUpdateTime
      } catch (_: Exception) {
        0L
      }
      if (!file.exists() || file.lastModified() < lastUpdate) {
        val bitmap = drawableToBitmap(info.loadIcon(pm))
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
      }
      Uri.fromFile(file).toString()
    } catch (_: Exception) {
      ""
    }
  }

  // Drawable → 고정 크기 비트맵. BitmapDrawable도 항상 새 비트맵에 그린다 —
  // PackageManager 캐시가 소유한 원본 비트맵을 건드리지(recycle) 않기 위해서다.
  private fun drawableToBitmap(drawable: Drawable): Bitmap {
    val bitmap = Bitmap.createBitmap(ICON_SIZE_PX, ICON_SIZE_PX, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    drawable.setBounds(0, 0, ICON_SIZE_PX, ICON_SIZE_PX)
    drawable.draw(canvas)
    return bitmap
  }
}
