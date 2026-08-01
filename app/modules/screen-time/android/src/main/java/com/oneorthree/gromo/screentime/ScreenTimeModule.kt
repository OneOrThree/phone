package com.oneorthree.gromo.screentime

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Calendar

// 안드로이드 스크린타임 측정 코어(GROMO-994) — iOS ScreenTimeModule.swift의 안드로이드 대응.
// JS 계약(services/ScreenTimeModule.ts 20개) 중 M1+M2 범위를 구현한다:
//   M1 — 권한(requestAuthorization·getAuthorizationStatus) + 오늘/어제 사용시간 조회 + 목표 저장.
//   M2(GROMO-995) — 앱 선택 피커 지원: 설치 앱 목록 조회 + 측정 대상(pending 2단계)·집중
//   허용앱(즉시 저장) 선택 저장. 피커 UI 자체는 RN(AndroidAppPickerHost)이 그린다.
// 집중 실드/타이머 알림(M3)·어제 결과 판정(M4)은 후속 티켓.
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
    // 미설정 = 전체 앱 측정. 피커(M2)가 pending에 저장하고 promoteSelection이 활성으로 승격한다.
    private const val KEY_SELECTION_PACKAGES = "selectionPackages"
    private const val KEY_PENDING_SELECTION_PACKAGES = "pendingSelectionPackages"

    // 집중 허용앱 패키지명 집합 — iOS gromo:focus:allowedSelection과 1:1. pending 없이 즉시
    // 저장(§8 1단계). 실드(M3)가 이 키를 허용 목록으로 읽는다.
    private const val KEY_FOCUS_ALLOWED_PACKAGES = "focusAllowedSelectionPackages"
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

    // 사용시간 목표(초) 저장 — iOS의 App Group 기록 대응. M1은 저장만 한다.
    AsyncFunction("setGoalSeconds") { seconds: Int ->
      prefs.edit().putInt(KEY_GOAL_SECONDS, seconds).apply()
    }

    // 오늘 사용시간(분) — 오늘 0시~지금. 이름의 Bucket은 iOS 15분 눈금의 흔적으로,
    // 안드로이드는 정확한 분값을 반환한다(호출부 계약상 무해 — 03 문서 §4).
    AsyncFunction("getTodayUsageBucketMinutes") {
      usageMinutes(startOfDay(0), System.currentTimeMillis())
    }

    // 어제 사용시간(분) — 어제 0시~오늘 0시.
    AsyncFunction("getYesterdayUsageBucketMinutes") {
      usageMinutes(startOfDay(-1), startOfDay(0))
    }

    // ── 앱 선택 피커(M2, GROMO-995) — UI는 RN(AndroidAppPickerHost), 여기는 목록·저장만 ──

    // 설치 앱(런처 앱) 목록 — [{ packageName, label, iconUri }]. AsyncFunction은 모듈 백그라운드
    // 큐에서 돌아 아이콘 캐시 생성(첫 호출)이 UI를 막지 않는다.
    AsyncFunction("getInstalledApps") {
      InstalledAppCatalog.launcherApps(context)
    }

    // 측정 대상 선택 조회 — 피커 프리로드용. 아직 승격 전인 대기(pending)가 있으면 그게 최신
    // 선택이라 활성분보다 우선한다(iOS presentAppPicker 프리로드와 동일 규칙). 미설정이면 null.
    AsyncFunction("getSelectionPackages") {
      packagesOrNull(KEY_PENDING_SELECTION_PACKAGES) ?: packagesOrNull(KEY_SELECTION_PACKAGES)
    }

    // 측정 대상 선택을 대기(pending)에 저장 — 활성 반영은 promoteSelection이 한다(§4.4 2단계).
    AsyncFunction("setPendingSelection") { packages: List<String> ->
      prefs.edit().putStringSet(KEY_PENDING_SELECTION_PACKAGES, packages.toSet()).apply()
    }

    // 대기 측정 대상을 활성으로 승격 — true(승격함) | false(대기 없음). iOS와 동일 계약.
    // 안드로이드는 조회형이라 승격 즉시 오늘 하루 전체가 새 기준으로 소급 재계산된다(§4.4).
    AsyncFunction("promoteSelection") {
      val pending = prefs.getStringSet(KEY_PENDING_SELECTION_PACKAGES, null)
      if (pending == null) {
        false
      } else {
        prefs.edit()
          .putStringSet(KEY_SELECTION_PACKAGES, HashSet(pending))
          .remove(KEY_PENDING_SELECTION_PACKAGES)
          .apply()
        true
      }
    }

    // 집중 허용앱 조회 — 미설정이면 null(호출부가 '미설정'과 '0개 허용'을 구분한다).
    AsyncFunction("getAllowedPackages") {
      packagesOrNull(KEY_FOCUS_ALLOWED_PACKAGES)
    }

    // 집중 허용앱 저장 — pending 없이 즉시 적용(iOS 허용앱 피커와 동일 1단계).
    AsyncFunction("setAllowedSelection") { packages: List<String> ->
      prefs.edit().putStringSet(KEY_FOCUS_ALLOWED_PACKAGES, packages.toSet()).apply()
    }

    // 설정을 다녀온 복귀 감지 — 대기 중인 권한 요청을 실제 AppOps 상태로 마감한다(§2).
    OnActivityEntersForeground {
      pendingAuthPromise?.let { promise ->
        pendingAuthPromise = null
        promise.resolve(isUsageAccessGranted())
      }
    }
  }

  // 저장된 패키지 집합 → 리스트(미설정 null). getStringSet 반환 집합은 수정 금지 계약이라 복사한다.
  private fun packagesOrNull(key: String): List<String>? =
    prefs.getStringSet(key, null)?.toList()

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
  private fun usageMinutes(begin: Long, end: Long): Int {
    if (!isUsageAccessGranted()) return 0
    val usageStatsManager =
      context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    // M2 전에는 selection 미설정 = 전체 앱 측정(빈 집합도 동일 취급 — §8 기본).
    val selection = prefs.getStringSet(KEY_SELECTION_PACKAGES, null)
    val millis = UsageSessionCalculator.foregroundMillis(usageStatsManager, selection, begin, end)
    return (millis / 60_000L).toInt()
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
