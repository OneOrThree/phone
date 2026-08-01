package com.oneorthree.gromo.screentime

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

// 안드로이드 스크린타임 측정 코어(GROMO-994) — iOS ScreenTimeModule.swift의 안드로이드 대응.
// JS 계약(services/ScreenTimeModule.ts 20개) 중 M1~M3 범위를 구현한다:
//   M1 — 권한(requestAuthorization·getAuthorizationStatus) + 오늘/어제 사용시간 조회 + 목표 저장.
//   M2(GROMO-995) — 앱 선택 피커 지원: 설치 앱 목록 조회 + 측정 대상(pending 2단계)·집중
//   허용앱(즉시 저장) 선택 저장. 피커 UI 자체는 RN(AndroidAppPickerHost)이 그린다.
//   M3(GROMO-996) — 집중 실드·잠금화면 타이머: 포그라운드 서비스(FocusSessionService) 시작/
//   종료 + 차단 화면용 캐릭터 스냅샷·과목명 저장 + 브라우저 허용 토글 + 오버레이 권한 플로우.
//   M4(GROMO-997) — 목표 판정·다듬기: 어제 결과 계산(getYesterdayResult — 어제 사용 vs 그날
//   목표 스냅샷, 목표+60초 관용) + 목표 초과 알림(GoalExceededCheckWorker) + 확장 알림의 다른
//   과목 목록 + 배터리 최적화 예외 안내 플로우. 판정·스냅샷 규칙은 ScreenTimeGoals 참고.
//
// iOS와의 구조 차이(03-스크린타임-구현 §0·§2):
//  - 측정: UsageStatsManager로 사용 기록을 직접 조회한다 — 익스텐션·App Group·threshold 예약 불필요.
//  - 권한: Usage Access는 시스템 팝업이 없는 특수 권한 — 설정 화면으로 보내고 복귀 시 재확인한다.
//    'notDetermined' 개념이 없어 "설정에 보낸 적" 로컬 플래그로 denied와 구분한다.
class ScreenTimeModule : Module() {
  companion object {
    // 서비스(FocusSessionService)·차단 화면(FocusBlockActivity)이 함께 읽는 이름/키는
    // internal — 리터럴 중복으로 키가 어긋나는 사고를 막는다(M3).
    internal const val PREFS_NAME = "gromo_screen_time"

    // '설정 보낸 적' 플래그 — notDetermined(안 보냄)/denied(보냈는데 미허용) 구분(§2).
    private const val KEY_SENT_TO_SETTINGS = "sentToUsageAccessSettings"

    // 사용시간 목표(초) 현재값 — 판정은 아래 날짜별 스냅샷으로 한다(M4, ScreenTimeGoals).
    internal const val KEY_GOAL_SECONDS = "goalSeconds"

    // 날짜별 목표 스냅샷(M4) — {"YYYY-MM-DD": 초} JSON. setGoalSeconds가 기록하고 어제 판정·
    // 목표 초과 워커가 '그날 등록돼 있던 목표'를 읽는다(§7 — iOS 등록 시점 값 기준과 동작 일치).
    internal const val KEY_GOAL_SECONDS_BY_DATE = "goalSecondsByDate"

    // 목표 초과 알림을 보낸 날짜(M4) — 하루 1회 중복 방지(GoalExceededCheckWorker).
    internal const val KEY_GOAL_EXCEEDED_NOTIFIED_DATE = "goalExceededNotifiedDate"

    // 측정 대상 패키지명 집합 — iOS의 selection/pending 2단계 키 구조와 1:1(§8).
    // 미설정 = 전체 앱 측정. 피커(M2)가 pending에 저장하고 promoteSelection이 활성으로 승격한다.
    // 활성 키는 목표 초과 워커의 사용시간 계산(ScreenTimeGoals.usageMillis)도 읽는다(M4).
    internal const val KEY_SELECTION_PACKAGES = "selectionPackages"
    private const val KEY_PENDING_SELECTION_PACKAGES = "pendingSelectionPackages"

    // 집중 허용앱 패키지명 집합 — iOS gromo:focus:allowedSelection과 1:1. pending 없이 즉시
    // 저장(§8 1단계). 실드(M3)가 이 키를 허용 목록으로 읽는다.
    internal const val KEY_FOCUS_ALLOWED_PACKAGES = "focusAllowedSelectionPackages"

    // 집중 실드 표시용 과목명(M3) — 차단 화면 부제가 읽는다(iOS gromo:focus:shieldSubject 대응).
    internal const val KEY_FOCUS_SHIELD_SUBJECT = "focusShieldSubject"

    // 집중 중 브라우저 허용 토글(M3) — iOS '사파리·웹 허용'(gromo:focus:allowSafariWeb)의
    // 안드로이드 대응. 켜면 실드가 주요 브라우저 패키지를 허용 목록에 얹는다(03 문서 §4).
    internal const val KEY_FOCUS_ALLOW_BROWSERS = "focusAllowBrowsers"

    // 캐릭터 스냅샷 파일명(M3) — filesDir에 저장하고 차단 화면이 읽는다. iOS는 익스텐션과
    // 공유하려 App Group에 뒀지만 안드로이드는 같은 앱이라 내부 저장소로 충분(§4 간소화).
    internal const val SNAPSHOT_FILE_NAME = "focusCharacter.png"

    // iOS saveCharacterSnapshot과 동일한 다운스케일 상한(긴 변 px).
    private const val SNAPSHOT_MAX_SIDE = 256
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val prefs: SharedPreferences
    get() = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  // 설정 복귀를 기다리는 requestAuthorization — 복귀(OnActivityEntersForeground) 시 재확인 후 resolve.
  private var pendingAuthPromise: Promise? = null

  // 설정 복귀를 기다리는 requestOverlayPermission(M3) — Usage Access와 같은 왕복 계약.
  private var pendingOverlayPromise: Promise? = null

  // 설정 복귀를 기다리는 requestIgnoreBatteryOptimizations(M4) — 같은 왕복 계약.
  private var pendingBatteryPromise: Promise? = null

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

    // 사용시간 목표(초) 저장 — iOS의 App Group 기록 대응. 현재값과 함께 오늘 날짜 스냅샷을
    // 남겨(M4, ScreenTimeGoals) 어제 판정·목표 초과 체크가 '그날 목표' 기준으로 동작하게 하고,
    // 목표가 있으면 초과 체크 주기(WorkManager 15분)를 걸어 둔다(해제 시 취소).
    AsyncFunction("setGoalSeconds") { seconds: Int ->
      ScreenTimeGoals.recordSnapshot(prefs, seconds)
      if (seconds > 0) {
        GoalExceededCheckWorker.ensureScheduled(context)
      } else {
        GoalExceededCheckWorker.cancel(context)
      }
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

    // 어제 목표 달성 결과(M4, §7) — "success" | "fail" | null(판정 불가). iOS 구 계약
    // (자정 모니터가 남긴 판정 읽기, GROMO-942로 휴면)의 안드로이드 대응인데, 과거 조회가
    // 되므로 '어제 사용시간 vs 그날 목표 스냅샷' 계산으로 대체한다. 초과 판정선은 목표+60초
    // (정확히 목표에서 멈춘 유저 보호 — ScreenTimeGoals 관용 규칙).
    // null: 권한 없음 · 어제 이하 목표 스냅샷 없음(첫 설치·목표 해제) — iOS의 '결과 없음(nil)'.
    AsyncFunction("getYesterdayResult") {
      yesterdayResult()
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

    // ── 집중 실드·잠금화면 타이머(M3, GROMO-996 — 03 문서 §5·§6) ──

    // 오버레이 권한 상태 — 서비스가 차단 화면을 띄우려면 필수(안드10+ 백그라운드 액티비티
    // 시작 제약의 예외 조건). Usage Access처럼 시스템 팝업 없는 설정 토글 특수 권한이다.
    AsyncFunction("canDrawOverlays") {
      Settings.canDrawOverlays(context)
    }

    // 오버레이 권한 설정 딥링크 — 복귀(OnActivityEntersForeground) 시 재확인한 결과로 resolve.
    // Usage Access와 달리 package Uri 딥링크가 문서화된 공식 동작이라 앱 상세로 바로 연다.
    AsyncFunction("requestOverlayPermission") { promise: Promise ->
      if (Settings.canDrawOverlays(context)) {
        promise.resolve(true)
        return@AsyncFunction
      }
      // 직전 요청이 아직 대기 중이면(연타 등) 현재 상태로 먼저 마감하고 새 요청으로 교체.
      pendingOverlayPromise?.resolve(Settings.canDrawOverlays(context))
      pendingOverlayPromise = promise
      try {
        openOverlaySettings()
      } catch (_: Exception) {
        pendingOverlayPromise = null
        promise.resolve(false)
      }
    }

    // ── 배터리 최적화 예외(M4) — 제조사 절전이 백그라운드 측정(목표 초과 워커)·집중 FGS를
    // 죽이는 걸 완화하는 안내용. 개별 앱 요청 다이얼로그(REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)는
    // Play 민감 권한이라 쓰지 않고, 최적화 설정 목록(ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
    // 으로만 보낸다 — 유저가 목록에서 gromo를 찾아 '최적화 안 함'으로 바꾸는 UX. ──

    // 배터리 최적화 예외 여부 — true면 Doze·앱 대기의 영향을 덜 받는다.
    AsyncFunction("isIgnoringBatteryOptimizations") {
      isIgnoringBatteryOptimizations()
    }

    // 배터리 최적화 설정 딥링크 — Usage Access와 같은 왕복 계약(복귀 시 재확인 결과로 resolve).
    AsyncFunction("requestIgnoreBatteryOptimizations") { promise: Promise ->
      if (isIgnoringBatteryOptimizations()) {
        promise.resolve(true)
        return@AsyncFunction
      }
      // 직전 요청이 아직 대기 중이면(연타 등) 현재 상태로 먼저 마감하고 새 요청으로 교체.
      pendingBatteryPromise?.resolve(isIgnoringBatteryOptimizations())
      pendingBatteryPromise = promise
      try {
        openBatteryOptimizationSettings()
      } catch (_: Exception) {
        pendingBatteryPromise = null
        promise.resolve(false)
      }
    }

    // 집중 실드 켜기 — 포그라운드 서비스가 폴링으로 비허용앱을 차단한다(§5). 차단을 실제로
    // 집행할 수 없는 상태(사용 정보 접근·오버레이 권한 부재)면 false — 호출부(JS)가 iOS의
    // 권한 없음과 동일하게 '실드 없는 세션'(15초 이탈 정책 + 이탈 알림)으로 강등한다.
    // 반쪽짜리 차단(감지만 되고 화면은 못 띄움)을 켜 두는 것보다 기존 강등 경로가 안전하다.
    AsyncFunction("startFocusShield") { subjectName: String ->
      if (!isUsageAccessGranted() || !Settings.canDrawOverlays(context)) {
        false
      } else {
        // 차단 화면 부제가 읽을 과목명 — iOS의 App Group 기록 대응.
        prefs.edit().putString(KEY_FOCUS_SHIELD_SUBJECT, subjectName).apply()
        FocusSessionService.startShield(context, subjectName)
      }
    }

    // 집중 실드 끄기 — 세션 정지·고아 세션 정리 시 호출(멱등 — 서비스 없으면 no-op).
    AsyncFunction("stopFocusShield") {
      FocusSessionService.stopShield()
      // 스냅샷 제거 — 남겨두면 다음 세션 시작 후 새 스냅샷 저장 전(~2초)까지 차단 화면에
      // 직전 세션의 캐릭터가 노출된다(iOS stopFocusShield와 동일한 정리).
      File(context.filesDir, SNAPSHOT_FILE_NAME).delete()
    }

    // 집중 중 브라우저 허용 여부 저장 — 서비스가 폴링마다 prefs를 다시 읽으므로 실드 중에도
    // 1~2초 안에 반영된다(iOS setFocusAllowSafariWeb의 라이브 반영 대응).
    AsyncFunction("setFocusAllowSafariWeb") { allowed: Boolean ->
      prefs.edit().putBoolean(KEY_FOCUS_ALLOW_BROWSERS, allowed).apply()
    }

    // 저장된 브라우저 허용 여부 조회 (미설정 = false = 차단이 기본 — iOS와 동일).
    AsyncFunction("getFocusAllowSafariWeb") {
      prefs.getBoolean(KEY_FOCUS_ALLOW_BROWSERS, false)
    }

    // 캐릭터 스냅샷(base64 PNG) 저장 — 차단 화면이 표시한다. iOS와 동일하게 긴 변 256px로
    // 다운스케일해 저장한다(익스텐션 메모리 예산 같은 제약은 없지만 파일 크기·디코딩 부담 축소).
    AsyncFunction("saveCharacterSnapshot") { base64: String ->
      saveSnapshot(base64)
    }

    // 잠금화면 타이머 시작 — iOS Live Activity 대응(§6). 같은 포그라운드 서비스의 ongoing
    // 알림 + chronometer가 상단바·잠금화면에서 초를 실시간으로 올린다. 실드 없는 세션도 동작.
    // otherSubjectsJson([{ name, seconds, color }])은 확장 알림의 다른 과목 목록으로 표시한다
    // (M4 커스텀 알림 레이아웃 — 파싱·표시는 FocusSessionService).
    AsyncFunction("startFocusActivity") { subjectName: String, otherSubjectsJson: String ->
      val notificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      // 알림이 꺼져 있으면 타이머를 보여줄 방법이 없다 — 실드가 돌고 있지 않다면 보이지 않는
      // 서비스를 상주시킬 이유가 없으므로 시작하지 않는다(실드 중이면 서비스가 이미 필요).
      if (!notificationManager.areNotificationsEnabled() && !FocusSessionService.isShieldActive()) {
        false
      } else {
        FocusSessionService.startTimer(context, subjectName, otherSubjectsJson)
      }
    }

    // 잠금화면 타이머 종료(멱등) — 실드도 꺼져 있으면 서비스가 스스로 내려간다.
    AsyncFunction("endFocusActivity") {
      FocusSessionService.stopTimer()
    }

    // 설정을 다녀온 복귀 감지 — 대기 중인 권한 요청을 실제 상태로 마감한다(§2).
    OnActivityEntersForeground {
      pendingAuthPromise?.let { promise ->
        pendingAuthPromise = null
        promise.resolve(isUsageAccessGranted())
      }
      pendingOverlayPromise?.let { promise ->
        pendingOverlayPromise = null
        promise.resolve(Settings.canDrawOverlays(context))
      }
      pendingBatteryPromise?.let { promise ->
        pendingBatteryPromise = null
        promise.resolve(isIgnoringBatteryOptimizations())
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
  // 판정 본체는 목표 초과 워커와 공용인 UsageAccess로 분리했다(M4).
  private fun isUsageAccessGranted(): Boolean = UsageAccess.isGranted(context)

  // 어제 목표 달성 결과 계산(M4) — getYesterdayResult 본체. 규칙은 정의부 주석·ScreenTimeGoals 참고.
  private fun yesterdayResult(): String? {
    if (!isUsageAccessGranted()) return null
    val goalSeconds = ScreenTimeGoals.goalSecondsOn(prefs, ScreenTimeGoals.dateString(-1))
      ?: return null
    val usageMillis = ScreenTimeGoals.usageMillis(context, prefs, startOfDay(-1), startOfDay(0))
    return if (ScreenTimeGoals.isExceeded(usageMillis, goalSeconds)) "fail" else "success"
  }

  // 배터리 최적화 예외 여부(M4) — Doze·앱 대기에서 백그라운드 동작이 덜 죽는 상태.
  private fun isIgnoringBatteryOptimizations(): Boolean {
    val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return powerManager.isIgnoringBatteryOptimizations(context.packageName)
  }

  // 배터리 최적화 설정 목록 열기(M4) — 개별 앱 다이얼로그(Play 민감 권한)는 쓰지 않는다.
  private fun openBatteryOptimizationSettings() {
    val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
    val activity = appContext.currentActivity
    if (activity != null) {
      activity.startActivity(intent)
    } else {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
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

  // 오버레이 권한 설정 화면 열기 — 앱 상세 토글(M3).
  private fun openOverlaySettings() {
    val intent = Intent(
      Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
      Uri.parse("package:${context.packageName}"),
    )
    val activity = appContext.currentActivity
    if (activity != null) {
      activity.startActivity(intent)
    } else {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }

  // 캐릭터 스냅샷 저장(M3) — base64 디코드 → 긴 변 256px 다운스케일 → filesDir PNG.
  // 실패는 false로만 알린다(iOS와 동일 — 스냅샷 없이도 차단 화면은 텍스트로 동작).
  private fun saveSnapshot(base64: String): Boolean = try {
    val bytes = Base64.decode(base64, Base64.DEFAULT)
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    if (bitmap == null) {
      false
    } else {
      val longest = maxOf(bitmap.width, bitmap.height)
      val output = if (longest > SNAPSHOT_MAX_SIDE) {
        val ratio = SNAPSHOT_MAX_SIDE.toFloat() / longest
        Bitmap.createScaledBitmap(
          bitmap,
          (bitmap.width * ratio).toInt().coerceAtLeast(1),
          (bitmap.height * ratio).toInt().coerceAtLeast(1),
          true,
        )
      } else {
        bitmap
      }
      FileOutputStream(File(context.filesDir, SNAPSHOT_FILE_NAME)).use { stream ->
        output.compress(Bitmap.CompressFormat.PNG, 100, stream)
      }
      true
    }
  } catch (_: Exception) {
    false
  }

  // [begin, end) 구간 사용시간(분) — 세션 재구성 계산(활성 selection 필터 포함 —
  // ScreenTimeGoals.usageMillis). 권한이 없으면 0 (호출부는 권한 확인 후 호출하는 게 기본 흐름).
  private fun usageMinutes(begin: Long, end: Long): Int {
    if (!isUsageAccessGranted()) return 0
    return (ScreenTimeGoals.usageMillis(context, prefs, begin, end) / 60_000L).toInt()
  }

  // 로컬 자정 기준 하루 시작 시각(ms). offsetDays: 0=오늘, -1=어제. 본체는 워커와 공용인
  // ScreenTimeGoals로 이동(M4).
  private fun startOfDay(offsetDays: Int): Long = ScreenTimeGoals.startOfDayMillis(offsetDays)
}
