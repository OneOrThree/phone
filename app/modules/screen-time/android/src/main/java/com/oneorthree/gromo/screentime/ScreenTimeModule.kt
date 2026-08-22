package com.oneorthree.gromo.screentime

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.Base64
import java.io.ByteArrayOutputStream
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Calendar

// 안드로이드 스크린타임 측정 코어(GROMO-994) — iOS ScreenTimeModule.swift의 안드로이드 대응.
// JS 계약(services/ScreenTimeModule.ts 20개) 중 M1 범위만 구현한다:
//   권한(requestAuthorization·getAuthorizationStatus) + 오늘/어제 사용시간 조회 + 목표 저장.
// 앱 선택 피커(M2)·집중 실드/타이머 알림(M3)·어제 결과 판정(M4)은 후속 티켓.
//
// iOS와의 구조 차이(03-스크린타임-구현 §0·§2):
//  - 측정: UsageStatsManager로 사용 기록을 직접 조회한다 — 익스텐션·App Group·threshold 예약 불필요.
//  - 권한: Usage Access는 시스템 팝업이 없는 특수 권한 — 설정 화면으로 보내고 복귀 시 재확인한다.
//    'notDetermined' 개념이 없어 "설정에 보낸 적" 로컬 플래그로 denied와 구분한다.
class ScreenTimeModule : Module() {
  companion object {
    private const val PREFS_NAME = "gromo_screen_time"

    // '설정 보낸 적' 플래그 — notDetermined(안 보냄)/denied(보냈는데 미허용) 구분(§2).
    private const val KEY_SENT_TO_SETTINGS = "sentToUsageAccessSettings"

    // 사용시간 목표(초) — M1은 저장만. 판정(getYesterdayResult)은 M4에서 이 값(날짜별 스냅샷)으로 계산.
    private const val KEY_GOAL_SECONDS = "goalSeconds"

    // 측정 대상 패키지명 집합 — iOS의 selection/pending 2단계 키 구조와 1:1(§8).
    // M1은 피커가 없어 항상 미설정 = 전체 앱 측정. M2 피커가 이 키에 저장·승격한다.
    private const val KEY_SELECTION_PACKAGES = "selectionPackages"
    // iOS의 '다음날 적용' 대기 선택 자리였다. 안드로이드는 조회 시점에 원시 이벤트를
    // 필터링해 재계산하므로 예약이 필요 없어 쓰지 않는다.
    @Suppress("unused")
    private const val KEY_PENDING_SELECTION_PACKAGES = "pendingSelectionPackages"

    // 목록 아이콘 한 변(px). 행에 그려지는 크기(약 40dp)의 고밀도 대비 여유분.
    private const val ICON_PX = 96
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val prefs: SharedPreferences
    get() = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  // 설정 복귀를 기다리는 requestAuthorization — 복귀(OnActivityEntersForeground) 시 재확인 후 resolve.
  private var pendingAuthPromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("ScreenTimeModule")

    // 현재 권한 상태 — approved / denied / notDetermined (JS AuthorizationStatus와 동일 문자열).
    AsyncFunction("getAuthorizationStatus") {
      currentStatus()
    }

    // 권한 요청 — 시스템 팝업이 없으므로 Usage Access 설정 화면을 열고, 앱 복귀 시
    // AppOps를 재확인한 결과로 resolve한다(iOS의 '팝업 응답 후 resolve'와 같은 계약).
    AsyncFunction("requestAuthorization") { promise: Promise ->
      if (isUsageAccessGranted()) {
        promise.resolve(true)
        return@AsyncFunction
      }
      // 설정 화면을 열기 전에 '보낸 적' 기록 — 이후 미허용 상태는 denied로 구분된다.
      prefs.edit().putBoolean(KEY_SENT_TO_SETTINGS, true).apply()
      // 직전 요청이 아직 대기 중이면(연타 등) 현재 상태로 먼저 마감하고 새 요청으로 교체.
      pendingAuthPromise?.resolve(isUsageAccessGranted())
      pendingAuthPromise = promise
      try {
        openUsageAccessSettings()
      } catch (_: Exception) {
        // 설정 화면을 못 여는 기기 — 요청 실패는 '미허용'으로 마감(호출부 계약 유지).
        pendingAuthPromise = null
        promise.resolve(false)
      }
    }

    // 사용 정보 접근 설정 화면 열기 — 권한 상태와 무관하게 **항상** 연다.
    //
    // requestAuthorization은 이미 허용된 상태면 설정을 열지 않고 즉시 resolve한다(위). 그래서
    // '허용됨' 상태에서 권한을 끄러 가려는 경로로는 쓸 수 없다. 앱 상세 설정(Linking.openSettings)도
    // 답이 아니다 — 거기엔 사용 정보 접근 토글이 없다(reopenAndroidUsageAccess 주석과 같은 이유).
    // 그 자리를 메우는 전용 함수다(코드리뷰 반영).
    //
    // 여는 데 실패하면 false — 호출부가 앱 상세 설정으로 폴백한다.
    AsyncFunction("openUsageAccessSettings") {
      try {
        openUsageAccessSettings()
        true
      } catch (_: Exception) {
        false
      }
    }

    // 사용시간 목표(초) 저장 — iOS의 App Group 기록 대응. M1은 저장만 한다.
    AsyncFunction("setGoalSeconds") { seconds: Int ->
      prefs.edit().putInt(KEY_GOAL_SECONDS, seconds).apply()
    }

    // 오늘 사용시간(분) — 오늘 0시~지금. 이름의 Bucket은 iOS 15분 눈금의 흔적으로,
    // 안드로이드는 정확한 분값을 반환한다(호출부 계약상 무해 — 03 문서 §4).
    /**
     * 오늘 총 사용시간(초) — 위 분값과 같은 소스, 내림 전 값이다.
     * 상세 화면이 '앱별 목록에 안 잡히는 시간'을 정확히 계산하는 데 쓴다.
     */
    AsyncFunction("getTodayUsageSeconds") {
      usageSeconds(startOfDay(0), System.currentTimeMillis())
    }

    AsyncFunction("getTodayUsageBucketMinutes") {
      usageMinutes(startOfDay(0), System.currentTimeMillis())
    }

    // 어제 사용시간(분) — 어제 0시~오늘 0시.
    AsyncFunction("getYesterdayUsageBucketMinutes") {
      usageMinutes(startOfDay(-1), startOfDay(0))
    }

    // 앱별 사용시간 — iOS는 DeviceActivityReport 익스텐션이 그려주는 화면을 통째로 받지만(수치는
    // JS로 못 가져온다), 안드로이드는 수치 자체를 넘길 수 있어 화면을 RN이 그린다.
    // dayOffset: 0=오늘(0시~지금), -1=어제(하루 전체). 사용 많은 순 정렬, 사용 0인 앱은 빠진다.
    AsyncFunction("getUsageByApp") { dayOffset: Int ->
      if (!isUsageAccessGranted()) {
        emptyList<Map<String, Any>>()
      } else {
        val begin = startOfDay(dayOffset)
        val end = if (dayOffset >= 0) System.currentTimeMillis() else startOfDay(dayOffset + 1)
        val usageStatsManager =
          context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val selection = prefs.getStringSet(KEY_SELECTION_PACKAGES, null)
        // 런처에 뜨는 앱만 보여준다. UsageStats에는 홈 런처(Pixel Launcher)·시스템 UI 같은
        // '앱으로 인식되지 않는 것'도 잡히는데, 그걸 목록에 올리면
        //   1) 홈 화면에 머문 시간이 앱 사용처럼 보이고
        //   2) 표시 이름을 못 읽어 `com.google.android.apps.nexuslauncher` 같은 줄이 남는다.
        // 사용자가 "내가 쓴 앱"으로 세는 건 런처에서 열 수 있는 앱이다(측정 대상 피커와 같은 기준).
        val launchable = launchablePackages()
        UsageSessionCalculator
          .foregroundMillisByPackage(usageStatsManager, selection, begin, end)
          .entries
          .filter { it.key in launchable }
          .sortedByDescending { it.value }
          .map {
            mapOf(
              "packageName" to it.key,
              "label" to appLabel(it.key),
              // 분이 아니라 **초**로 넘긴다 — 1분 미만 사용이 전부 0분으로 뭉개지면 목록 하단이
              // 통째로 "0분"이 된다. 표시 단위 반올림은 화면이 정한다.
              "seconds" to (it.value / 1000L).toInt(),
            )
          }
      }
    }

    // 앱 아이콘 1개를 base64 PNG로. 목록이 뜬 뒤 보이는 행만 요청하는 용도라 개별 호출이다.
    // 실패(패키지 삭제 등)는 예외가 아니라 null — 아이콘 하나 때문에 목록이 깨지면 안 된다.
    AsyncFunction("getAppIcon") { packageName: String ->
      runCatching { encodeIcon(context.packageManager.getApplicationIcon(packageName)) }
        .getOrNull()
    }

    // 설정을 다녀온 복귀 감지 — 대기 중인 권한 요청을 실제 AppOps 상태로 마감한다(§2).
    OnActivityEntersForeground {
      pendingAuthPromise?.let { promise ->
        pendingAuthPromise = null
        promise.resolve(isUsageAccessGranted())
      }
    }
  }

  // 런처에서 열 수 있는 앱의 패키지 집합 — '사용자가 앱으로 인식하는 것'의 기준이다.
  // 앱별 사용시간이 이 기준으로 걸러진다. 측정 대상 피커가 붙을 때도 **같은 기준**을 쓰게
  // 한 곳에 둔다: 한쪽만 바뀌면 "고를 수 없는 앱이 사용시간에 뜨거나", 반대로 "쓴 앱이
  // 목록에 없는" 어긋남이 생긴다.
  //
  // ⚠️ Android 11+ 패키지 가시성 — 이 조회가 결과를 돌려주려면 **앱 매니페스트의 queries 블록에
  //    MAIN/LAUNCHER 인텐트가 선언돼 있어야 한다.** 없으면 queryIntentActivities 가 거의 빈
  //    목록을 돌려주고, 아래 필터가 사용 기록을 통째로 걷어내 "쓴 앱이 하나도 없다"가 된다
  //    (코드리뷰 반영 — 그 상태로 올라갈 뻔했다).
  //    android/app/src/main/AndroidManifest.xml 에 넣어 뒀다. android/ 는 수동 관리이므로
  //    prebuild 재생성 시 함께 사라진다는 점에 주의(저장소 전반의 관례와 동일).
  //    QUERY_ALL_PACKAGES 는 쓰지 않는다 — Play 정책상 별도 소명이 필요한 제한 권한인데,
  //    우리에게 필요한 건 '런처에 뜨는 앱'뿐이라 인텐트 쿼리로 충분하다.
  private fun launchablePackages(): Set<String> {
    val pm = context.packageManager
    val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val resolved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      pm.queryIntentActivities(launcherIntent, PackageManager.ResolveInfoFlags.of(0L))
    } else {
      @Suppress("DEPRECATION")
      pm.queryIntentActivities(launcherIntent, 0)
    }
    // 런처 액티비티가 여럿인 앱은 같은 패키지가 중복으로 나오므로 집합으로 모은다.
    return resolved.mapTo(HashSet()) { it.activityInfo.packageName }
  }

  // 표시 이름 — 못 읽으면 패키지명 그대로. 목록에서 행이 통째로 빠지는 것보단 낫다.
  private fun appLabel(packageName: String): String = runCatching {
    val pm = context.packageManager
    val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      pm.getApplicationInfo(packageName, PackageManager.ApplicationInfoFlags.of(0L))
    } else {
      @Suppress("DEPRECATION")
      pm.getApplicationInfo(packageName, 0)
    }
    pm.getApplicationLabel(info).toString()
  }.getOrDefault(packageName)

  // 아이콘 → base64 PNG(data URI 없이 본문만). 어댑티브 아이콘은 Bitmap이 아니라
  // Drawable이라 캔버스에 직접 그려야 한다(BitmapDrawable 캐스팅은 그쪽에서 깨진다).
  private fun encodeIcon(drawable: Drawable): String {
    val bitmap = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    drawable.setBounds(0, 0, canvas.width, canvas.height)
    drawable.draw(canvas)
    val stream = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
    bitmap.recycle()
    return Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
  }

  private fun currentStatus(): String = when {
    isUsageAccessGranted() -> "approved"
    prefs.getBoolean(KEY_SENT_TO_SETTINGS, false) -> "denied"
    else -> "notDetermined"
  }

  // Usage Access 허용 여부 — AppOpsManager.checkOpNoThrow(OPSTR_GET_USAGE_STATS) 기준(§2).
  private fun isUsageAccessGranted(): Boolean {
    val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        Process.myUid(),
        context.packageName,
      )
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        Process.myUid(),
        context.packageName,
      )
    }
    // MODE_DEFAULT는 앱옵스 미기록 상태 — 매니페스트 권한 보유 여부로 판정(표준 관례).
    return if (mode == AppOpsManager.MODE_DEFAULT) {
      context.checkCallingOrSelfPermission(android.Manifest.permission.PACKAGE_USAGE_STATS) ==
        PackageManager.PERMISSION_GRANTED
    } else {
      mode == AppOpsManager.MODE_ALLOWED
    }
  }

  // Usage Access 설정 화면 열기 — 전체 목록 화면(유저가 목록에서 gromo를 찾아 토글, §2).
  // package: Uri로 앱 상세까지 딥링크하는 변형은 문서화되지 않은 동작이라(제조사별 크래시·
  // 빈 화면 보고) 예측 가능한 전체 목록으로 통일한다.
  private fun openUsageAccessSettings() {
    val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
    val activity = appContext.currentActivity
    if (activity != null) {
      activity.startActivity(intent)
    } else {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }

  // [begin, end) 구간 사용시간(분) — 세션 재구성 계산(UsageSessionCalculator).
  // 권한이 없으면 0 (호출부는 권한 확인 후 호출하는 게 기본 흐름).
  private fun usageMinutes(begin: Long, end: Long): Int = (usageSeconds(begin, end) / 60)

  /**
   * [begin, end) 구간 사용시간(**초**) — 위 분값과 **같은 소스**다.
   *
   * 상세 화면이 '앱별 목록에 안 잡히는 시간'(런처·시스템 UI)을 계산하는 데 쓴다.
   * 분값만 있으면 그걸 못 한다(코드리뷰 반영):
   *   - 초 단위 합을 내림된 분에서 빼면, 실제 차이가 1분을 넘어도 행이 안 생긴다
   *   - 내림한 분의 합에서 빼면, **차이가 없는데도 행이 생긴다**
   *     (각 40초씩 쓴 앱 둘 → 총계 floor(80/60)=1분, 행 합 0+0=0분 → 허위 '그 외 1분')
   * 두 실패가 정반대라 근사로는 못 없앤다. 초 단위 총계를 직접 준다.
   */
  private fun usageSeconds(begin: Long, end: Long): Int {
    if (!isUsageAccessGranted()) return 0
    val usageStatsManager =
      context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    // M2 전에는 selection 미설정 = 전체 앱 측정(빈 집합도 동일 취급 — §8 기본).
    val selection = prefs.getStringSet(KEY_SELECTION_PACKAGES, null)
    val millis = UsageSessionCalculator.foregroundMillis(usageStatsManager, selection, begin, end)
    return (millis / 1_000L).toInt()
  }

  // 로컬 자정 기준 하루 시작 시각(ms). offsetDays: 0=오늘, -1=어제. DST 보정은 Calendar가 처리.
  private fun startOfDay(offsetDays: Int): Long {
    val calendar = Calendar.getInstance()
    calendar.add(Calendar.DAY_OF_YEAR, offsetDays)
    calendar.set(Calendar.HOUR_OF_DAY, 0)
    calendar.set(Calendar.MINUTE, 0)
    calendar.set(Calendar.SECOND, 0)
    calendar.set(Calendar.MILLISECOND, 0)
    return calendar.timeInMillis
  }
}
