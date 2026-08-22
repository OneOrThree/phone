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
import java.io.File
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

    /**
     * 오늘 대상을 바꾸기 **직전**의 선택과 그 날짜(코드리뷰 반영).
     *
     * 측정 대상은 조회 시점에 원시 이벤트를 필터링하는 방식이라, 대상을 바꾸면 **지난 날짜까지
     * 새 기준으로 다시 계산된다.** 오늘분은 그게 맞는 동작이지만(사용자가 방금 정한 기준),
     * 어제분은 아니다 — 전날 최종 동기화가 오프라인 등으로 밀려 있으면, 재시도 때 어제 사용량과
     * 목표 달성 여부가 **오늘 고른 앱 기준으로 다시 계산돼 서버 기록까지 잘못 확정된다.**
     *
     * 그래서 '오늘 처음 바꿀 때'의 직전 선택을 한 벌 보관해, 지난 날짜 조회는 그걸 쓴다.
     * 하루에 여러 번 바꿔도 보관값은 그대로다(어제 유효했던 선택이 계속 유지된다).
     */
    private const val KEY_PREV_SELECTION_PACKAGES = "prevSelectionPackages"
    private const val KEY_SELECTION_CHANGED_DATE = "selectionChangedDate"

    /**
     * 직전 선택이 **미설정(= 전체 앱 측정)이었는가**. 빈 집합과 뜻이 달라 따로 표시해야 한다.
     *
     * ⚠️ 문자열 표식으로 쓰면 안 된다(코드리뷰 7차). SharedPreferences 는 XML 로 영속화되는데
     *    XML 1.0 은 NUL 을 직렬화하지 못한다. 표식에 NUL 을 넣으면 **같은 editor 에 담긴 새
     *    선택과 변경일까지 통째로 디스크 쓰기가 실패해**, 프로세스 재시작 뒤 사용자가 방금 고른
     *    대상이 사라지고 전체 앱 측정으로 되돌아간다. 별도 boolean 으로 둔다.
     */
    private const val KEY_PREV_SELECTION_NONE = "prevSelectionWasNone"
    // iOS의 '다음날 적용' 대기 선택 자리였다. 안드로이드는 조회 시점 재계산이라 예약이
    // 필요 없어 쓰지 않는다 — 근거는 setSelectionPackages 주석(GROMO-995).
    @Suppress("unused")
    private const val KEY_PENDING_SELECTION_PACKAGES = "pendingSelectionPackages"

    // 집중 중 허용앱 — 측정 대상과 뜻이 정반대라 키를 나눈다(getAllowedPackages 주석).
    private const val KEY_ALLOWED_PACKAGES = "allowedPackages"

    // 피커 목록 아이콘 한 변(px). 행에 그려지는 크기(약 40dp)의 고밀도 대비 여유분.
    private const val ICON_PX = 96

    // 캐릭터 스냅샷 파일명 — iOS가 App Group 컨테이너에 쓰는 focusCharacter.png와 같은 역할.
    // FocusShieldService·ShieldOverlay가 같은 이름으로 읽으므로 바꾸면 셋을 같이 고칠 것.
    const val CHARACTER_FILE = "focusCharacter.png"
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
    AsyncFunction("getTodayUsageBucketMinutes") {
      usageMinutes(0, startOfDay(0), System.currentTimeMillis())
    }

    // 어제 사용시간(분) — 어제 0시~오늘 0시.
    AsyncFunction("getYesterdayUsageBucketMinutes") {
      usageMinutes(-1, startOfDay(-1), startOfDay(0))
    }

    // 앱별 사용시간 — iOS는 DeviceActivityReport 익스텐션이 그려주는 화면을 통째로 받지만(수치는
    // JS로 못 가져온다), 안드로이드는 수치 자체를 넘길 수 있어 화면을 RN이 그린다.
    // dayOffset: 0=오늘(0시~지금), -1=어제(하루 전체). 사용 많은 순 정렬, 사용 0인 앱은 빠진다.
    /**
     * 앱별 사용시간 + 총계를 **한 번의 조회로** 돌려준다(코드리뷰 4차).
     *
     * 예전엔 목록·분 총계·초 총계를 각각 따로 불렀는데, 셋이 각자 시각을 잡고 이벤트를 다시
     * 훑어서 **서로 다른 시점의 결과가 섞였다.** 화면은 그 차이를 '목록에 안 잡히는 시간'으로
     * 읽으므로 1초 차이가 그대로 허위 '그 외' 행이 된다.
     *
     * `otherSeconds` 를 여기서 계산하는 이유도 같다 — 화면에서 빼면 **패키지마다 밀리초를
     * 버린 뒤의 합**과 비교하게 돼서, 앱이 많을수록 버린 초가 쌓여 없는 시간이 생긴다
     * (각 999ms 씩 버린 앱 61개면 1분이 만들어진다). 밀리초를 유지한 채 여기서 뺀다.
     */
    AsyncFunction("getUsageBreakdown") { dayOffset: Int ->
      if (!isUsageAccessGranted()) {
        mapOf(
          "totalSeconds" to 0,
          "otherSeconds" to 0,
          "apps" to emptyList<Map<String, Any>>(),
        )
      } else {
        val begin = startOfDay(dayOffset)
        val end = if (dayOffset >= 0) System.currentTimeMillis() else startOfDay(dayOffset + 1)
        val usageStatsManager =
          context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        // 지난 날짜는 **그때 유효했던** 선택으로 본다 — 오늘 바꾼 기준으로 어제를 다시
        // 계산하면 서버 기록까지 잘못 확정된다(selectionFor KDoc 참고).
        val selection = selectionFor(dayOffset)
        val breakdown =
          UsageSessionCalculator.foregroundBreakdown(usageStatsManager, selection, begin, end)
        // 런처에 뜨는 앱만 목록에 올린다. UsageStats에는 홈 런처(Pixel Launcher)·시스템 UI 같은
        // '앱으로 인식되지 않는 것'도 잡히는데, 그걸 목록에 올리면
        //   1) 홈 화면에 머문 시간이 앱 사용처럼 보이고
        //   2) 표시 이름을 못 읽어 `com.google.android.apps.nexuslauncher` 같은 줄이 남는다.
        // 사용자가 "내가 쓴 앱"으로 세는 건 런처에서 열 수 있는 앱이다(측정 대상 피커와 같은 기준).
        val launchable = launchablePackages()
        val listed = breakdown.byPackage.filterKeys { it in launchable }
        mapOf(
          "totalSeconds" to (breakdown.totalMillis / 1000L).toInt(),
          // 밀리초를 유지한 채 뺀 뒤 초로 버린다 — 화면에서 빼면 버린 밀리초가 쌓인다.
          "otherSeconds" to
            ((breakdown.totalMillis - listed.values.sum()).coerceAtLeast(0L) / 1000L).toInt(),
          "apps" to
            listed.entries.sortedByDescending { it.value }.map {
              mapOf(
                "packageName" to it.key,
                "label" to appLabel(it.key),
                // 분이 아니라 **초**로 넘긴다 — 1분 미만 사용이 전부 0분으로 뭉개지면 목록
                // 하단이 통째로 "0분"이 된다. 표시 단위 반올림은 화면이 정한다.
                "seconds" to (it.value / 1000L).toInt(),
              )
            },
        )
      }
    }

    // ── 측정 대상 앱 선택 (M2, GROMO-995) ────────────────────────────────────────
    //
    // iOS FamilyActivityPicker는 앱을 opaque 토큰으로만 넘겨 JS가 이름조차 못 읽는다. 안드로이드는
    // 패키지명이 그대로 보이므로 피커를 네이티브 모달로 띄울 이유가 없다 — 목록만 넘기고 화면은
    // RN이 그린다(검색·다중선택 UX를 앱 디자인 그대로 쓸 수 있다).

    // 런처에 뜨는 설치 앱 목록. 자기 자신(gromo)은 뺀다 — 측정 대상으로 고를 일이 없고,
    // 목록 맨 위에 자기가 뜨면 "이 앱을 감시한다"로 읽힌다.
    // 아이콘은 여기서 주지 않는다(§ getAppIcon) — 100개 넘는 앱의 비트맵을 한 번에 직렬화하면
    // 목록 첫 표시가 통째로 느려진다. 목록은 즉시 뜨고 아이콘만 뒤따라 채우게 나눴다.
    AsyncFunction("getInstalledApps") {
      launchablePackages()
        .asSequence()
        // 자기 자신은 뺀다 — 측정 대상으로 고를 일이 없고, 목록 맨 위에 자기가 뜨면
        // "이 앱을 감시한다"로 읽힌다. (앱별 사용시간 목록에는 반대로 포함한다 — 실제 사용이다.)
        .filter { it != context.packageName }
        .map { pkg -> mapOf("packageName" to pkg, "label" to appLabel(pkg)) }
        // 정렬은 표시 이름 기준 — 패키지명 순으로 주면 사용자에겐 무작위로 보인다.
        .sortedBy { it["label"]?.lowercase() }
        .toList()
    }

    // 앱 아이콘 1개를 base64 PNG로. 목록이 뜬 뒤 보이는 행만 요청하는 용도라 개별 호출이다.
    // 실패(패키지 삭제 등)는 예외가 아니라 null — 아이콘 하나 때문에 목록이 깨지면 안 된다.
    AsyncFunction("getAppIcon") { packageName: String ->
      runCatching { encodeIcon(context.packageManager.getApplicationIcon(packageName)) }
        .getOrNull()
    }

    // 현재 측정 대상 패키지 목록. 빈 배열 = 미설정 = 전체 앱 측정(§8 기본값과 같은 계약).
    AsyncFunction("getSelectionPackages") {
      // 타입 인자를 명시한다 — 람다의 반환 타입을 추론하는 중이라 emptyList() 쪽 K/T를 못 정한다.
      prefs.getStringSet(KEY_SELECTION_PACKAGES, null)?.sorted() ?: emptyList<String>()
    }

    // 측정 대상 저장. 빈 배열이면 키를 지워 '전체 앱 측정'으로 되돌린다 — 빈 집합을 저장하면
    // 계산기가 '아무 앱도 해당 없음'으로 읽어 사용시간이 0이 된다(같은 빈 값의 두 해석).
    //
    // ⚠️ iOS의 '다음날 적용'(pending 2단계) 대응물을 두지 않는다. iOS는 threshold 예약으로
    //    측정하므로 대상을 중간에 바꾸면 그날 수치가 옛 대상과 섞인다. 안드로이드는 조회 시점에
    //    원시 이벤트를 필터링해 재계산하므로, 바꾸는 즉시 오늘분도 새 기준으로 일관되게 다시
    //    계산된다 — 예약할 이유가 없고, 예약하면 오히려 "오늘은 옛 기준"이라는 없는 상태가 생긴다.
    AsyncFunction("setSelectionPackages") { packages: List<String> ->
      val editor = prefs.edit()
      // 오늘 처음 바꾸는 것이면 직전 선택을 보관한다 — 지난 날짜 조회가 그걸 쓴다(위 주석).
      val today = localDateKey()
      if (prefs.getString(KEY_SELECTION_CHANGED_DATE, null) != today) {
        val current = prefs.getStringSet(KEY_SELECTION_PACKAGES, null)
        editor.putStringSet(KEY_PREV_SELECTION_PACKAGES, current ?: emptySet())
        editor.putBoolean(KEY_PREV_SELECTION_NONE, current == null)
        editor.putString(KEY_SELECTION_CHANGED_DATE, today)
      }
      if (packages.isEmpty()) {
        editor.remove(KEY_SELECTION_PACKAGES)
      } else {
        editor.putStringSet(KEY_SELECTION_PACKAGES, packages.toSet())
      }
      editor.apply()
    }

    // ── 집중 실드 (GROMO-996) ────────────────────────────────────────────────────
    // iOS는 OS가 차단을 대신해 주지만(ManagedSettingsStore), 안드로이드는 우리가 직접
    // 폴링+가림막으로 흉내낸다. 구조·한계는 FocusShieldService 주석 참고.

    /** '다른 앱 위에 표시' 권한 보유 여부 — 이게 없으면 실드가 아예 불가능하다. */
    AsyncFunction("canDrawOverlay") {
      canDrawOverlays(context)
    }

    /** 권한 설정 화면 열기. 시스템 팝업이 없는 특수 권한이라 설정으로 보내는 수밖에 없다. */
    AsyncFunction("requestOverlayPermission") {
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

    /**
     * 실드 시작. 반환값은 **실제로 차단이 걸렸는지**다(iOS 계약과 동일).
     *
     * 권한이 없으면 false — 호출부(FocusSessionScreen)는 이 값으로 이탈 정책을 가른다.
     * 여기서 true를 돌려주면 차단도 안 되는데 이탈 판정만 느슨해져 부정 사용이 열린다.
     */
    AsyncFunction("startFocusShield") { subjectName: String ->
      // 두 권한이 **모두** 있어야 실제로 차단된다(코드리뷰 반영).
      //   - 오버레이: 가림막을 올릴 수 있는가
      //   - 사용 정보 접근: 지금 앞에 있는 앱이 무엇인지 읽을 수 있는가
      // 오버레이만 있고 사용 정보 접근이 꺼져 있으면 FocusShieldService.foregroundPackage()가
      // 늘 null 이라 아무것도 못 덮는데, 여기서 true 를 주면 이탈 판정만 느슨해진다 = 부정 사용.
      if (!canDrawOverlays(context) || !isUsageAccessGranted()) {
        false
      } else {
        // 방금 시작한 서비스가 아직 표식을 남기기 전이므로 여기서 먼저 찍어 둔다 —
        // 시작 직후 앱이 백그라운드에 갔다 오면 표식이 없어 '죽었다'로 오판한다.
        prefs.edit()
          .putLong(FocusShieldService.KEY_SHIELD_HEARTBEAT, System.currentTimeMillis())
          .apply()
        val allowed = prefs.getStringSet(KEY_ALLOWED_PACKAGES, null)?.toTypedArray() ?: emptyArray()
        val intent = Intent(context, FocusShieldService::class.java).apply {
          action = FocusShieldService.ACTION_START
          putExtra(FocusShieldService.EXTRA_SUBJECT, subjectName)
          putExtra(FocusShieldService.EXTRA_ALLOWED, allowed)
        }
        // 세션 시작은 항상 사용자가 앱 안에서 누르는 순간이라 백그라운드 FGS 시작 제약에
        // 걸리지 않는다(Android 12+ 제약은 백그라운드에서 띄울 때만 적용).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
        true
      }
    }

    /**
     * 실드 서비스가 **아직 살아서 돌고 있는가**(코드리뷰 반영).
     *
     * startFocusShield 가 true 를 준 뒤에도 제조사 배터리 최적화가 백그라운드에서 서비스를
     * 죽일 수 있다. 그러면 앱은 여전히 '차단 중'이라고 믿어, 차단 없이 다른 앱을 쓴 시간이
     * 집중으로 적립된다. 화면은 포그라운드 복귀마다 이 값을 다시 확인해 어긋나면 비실드
     * 이탈 정책으로 되돌린다.
     *
     * 판정은 폴링이 남기는 표식의 신선도로 한다. 권한이 중간에 회수된 경우도 같이 잡는다 —
     * 그때는 서비스가 차단 상태를 스스로 내리고 표식도 더는 갱신하지 않는다.
     *
     * ⚠️ AsyncFunction 이 아니라 **동기 Function** 이다. 호출부(FocusSessionScreen 의 AppState
     *    복귀 처리)가 shieldedRef 를 동기로 읽어 이탈 크레딧을 계산하는데, 그 사이에 await 를
     *    끼우면 크레딧 판정 전체를 비동기로 뒤집어야 한다 — 리플레이·스냅샷 배선이 얽혀 있어
     *    위험 대비 이득이 없다. 여기서 하는 일은 SharedPreferences 한 번 읽기라 동기로 충분하다.
     */
    Function("isFocusShieldAlive") {
      val last = prefs.getLong(FocusShieldService.KEY_SHIELD_HEARTBEAT, 0L)
      last != 0L &&
        System.currentTimeMillis() - last <= FocusShieldService.HEARTBEAT_STALE_MS &&
        canDrawOverlays(context) &&
        isUsageAccessGranted()
    }

    /** 실드 해제 — 멱등. 세션이 이미 끝났는데 또 불려도 무해해야 한다(화면이 여러 경로로 부른다). */
    AsyncFunction("stopFocusShield") {
      val intent = Intent(context, FocusShieldService::class.java).apply {
        action = FocusShieldService.ACTION_STOP
      }
      try {
        context.startService(intent)
      } catch (_: Exception) {
        // 서비스가 이미 죽어 있으면 시작 자체가 실패할 수 있다 — 목표(정지)는 이미 달성이다.
      }
      // 표식을 지운다 — 남겨 두면 다음 세션 시작 직후의 생존 확인이 **이전 세션의 표식**을
      // 보고 살아 있다고 답할 수 있다.
      prefs.edit().remove(FocusShieldService.KEY_SHIELD_HEARTBEAT).apply()
    }

    // ── 잠금화면 타이머(iOS Live Activity 대응) ──────────────────────────────────
    // iOS는 Live Activity가 실드와 **별개**로 돈다. 안드로이드는 상시 알림이 그 자리를 대신하는데
    // 알림의 주인이 실드 서비스라, 여기서도 같은 서비스에 정보만 얹는다.
    // 차단 권한이 없어 실드가 못 돌 때도 타이머는 의미가 있으므로 서비스는 뜬다(차단만 꺼진 채).

    /** 캐릭터 스냅샷 저장 — 알림 큰 아이콘·가림막 아이콘이 읽는다(iOS는 App Group 파일). */
    AsyncFunction("saveCharacterSnapshot") { base64: String ->
      runCatching {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        File(context.filesDir, CHARACTER_FILE).writeBytes(bytes)
        true
      }.getOrDefault(false)
    }

    /** 세션 정보(과목·다른 과목 누적)를 알림에 반영. otherSubjectsJson은 iOS와 같은 형태. */
    AsyncFunction("startFocusActivity") { subjectName: String, otherSubjectsJson: String ->
      val intent = Intent(context, FocusShieldService::class.java).apply {
        action = FocusShieldService.ACTION_ACTIVITY
        putExtra(FocusShieldService.EXTRA_SUBJECT, subjectName)
        putExtra(FocusShieldService.EXTRA_OTHERS, otherSubjectsJson)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      true
    }

    /**
     * 타이머 정보만 종료 — **차단은 유지된다**(iOS와 같은 계약).
     *
     * 화면이 실드까지 내릴 땐 stopFocusShield를 따로 부른다. 여기서 서비스를 통째로 내리면
     * 과목 변경처럼 이펙트가 다시 도는 경우에 차단이 조용히 풀린다.
     */
    AsyncFunction("endFocusActivity") {
      val intent = Intent(context, FocusShieldService::class.java).apply {
        action = FocusShieldService.ACTION_ACTIVITY_END
      }
      runCatching { context.startService(intent) }
      Unit
    }

    // ── 집중 중 허용앱 (GROMO-1603) ──────────────────────────────────────────────
    // 목록을 고르고 저장하는 것까지가 여기 범위다. **실제 차단(집중 실드)은 아직 없다**
    // (티켓 996) — 저장된 값은 실드가 붙는 순간 예외 목록으로 쓰인다.
    //
    // 측정 대상(KEY_SELECTION_PACKAGES)과 키를 나눈 이유: 두 목록은 뜻이 정반대다.
    // 측정 대상은 "재는 앱", 허용앱은 "집중 중에도 열어둘 앱"이라 같은 값을 공유하면 안 된다.
    // 빈 값의 뜻도 다르다 — 측정은 '비었으면 전체', 허용은 '비었으면 없음'이다.

    AsyncFunction("getAllowedPackages") {
      prefs.getStringSet(KEY_ALLOWED_PACKAGES, null)?.sorted() ?: emptyList<String>()
    }

    AsyncFunction("setAllowedPackages") { packages: List<String> ->
      val editor = prefs.edit()
      if (packages.isEmpty()) {
        editor.remove(KEY_ALLOWED_PACKAGES)
      } else {
        editor.putStringSet(KEY_ALLOWED_PACKAGES, packages.toSet())
      }
      editor.apply()
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
  // 측정 대상 피커와 앱별 사용시간이 **같은 기준**을 쓰게 한 곳에 둔다: 한쪽만 바뀌면
  // "고를 수 없는 앱이 사용시간에 뜨거나", 반대로 "쓴 앱이 목록에 없는" 어긋남이 생긴다.
  //
  // ⚠️ Android 11+ 패키지 가시성 — 이 조회가 결과를 돌려주려면 **앱 매니페스트의 queries 블록에
  //    MAIN/LAUNCHER 인텐트가 선언돼 있어야 한다.** 없으면 queryIntentActivities 가 거의 빈
  //    목록을 돌려주고, 아래 필터가 사용 기록을 통째로 걷어내 "쓴 앱이 하나도 없다"가 된다
  //    (코드리뷰 반영 — 그 상태로 올라갈 뻔했다). 피커도 같은 함수를 쓰므로 **고를 앱 목록까지
  //    함께 빈다.**
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
  private fun usageMinutes(dayOffset: Int, begin: Long, end: Long): Int =
    (usageSeconds(dayOffset, begin, end) / 60)

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
  private fun usageSeconds(dayOffset: Int, begin: Long, end: Long): Int {
    if (!isUsageAccessGranted()) return 0
    val usageStatsManager =
      context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    // 미설정 = 전체 앱 측정(빈 집합도 동일 취급 — §8 기본).
    // 지난 날짜는 **그때 유효했던** 선택을 쓴다(selectionFor KDoc 참고) — 오늘 바꾼 기준으로
    // 어제를 다시 계산하면, 밀려 있던 전날 동기화가 잘못된 값으로 서버에 확정된다.
    val selection = selectionFor(dayOffset)
    val millis = UsageSessionCalculator.foregroundMillis(usageStatsManager, selection, begin, end)
    return (millis / 1_000L).toInt()
  }

  /**
   * 해당 날짜에 **유효했던** 측정 대상. null 이면 전체 앱 측정(§8 기본).
   *
   * 오늘(dayOffset >= 0)은 현재 선택이 맞다 — 사용자가 방금 정한 기준으로 오늘분이 다시
   * 계산되는 건 의도된 동작이다. 지난 날짜는 오늘 바꾸기 직전의 선택을 쓴다.
   */
  private fun selectionFor(dayOffset: Int): Set<String>? {
    val current = prefs.getStringSet(KEY_SELECTION_PACKAGES, null)
    if (dayOffset >= 0) return current
    // 오늘 바꾼 적이 없으면 현재 선택이 그때도 유효했다.
    if (prefs.getString(KEY_SELECTION_CHANGED_DATE, null) != localDateKey()) return current
    // 그때가 미설정이었으면 null(전체 앱 측정) — 빈 집합과 뜻이 다르다.
    if (prefs.getBoolean(KEY_PREV_SELECTION_NONE, false)) return null
    return prefs.getStringSet(KEY_PREV_SELECTION_PACKAGES, null) ?: current
  }

  /** 로컬 날짜 키(yyyy-MM-dd) — 선택 변경일 비교용. */
  private fun localDateKey(): String {
    val c = Calendar.getInstance()
    return "%04d-%02d-%02d".format(
      c.get(Calendar.YEAR),
      c.get(Calendar.MONTH) + 1,
      c.get(Calendar.DAY_OF_MONTH),
    )
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
