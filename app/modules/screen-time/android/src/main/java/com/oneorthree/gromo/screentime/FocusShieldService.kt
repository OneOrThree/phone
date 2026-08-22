package com.oneorthree.gromo.screentime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.graphics.Color
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.widget.RemoteViews

/**
 * 집중 실드 — 세션 중 허용앱 외를 가림막으로 덮는다(GROMO-996).
 *
 * ## iOS와 구조가 다른 이유
 * iOS는 `ManagedSettingsStore.shield`로 **OS에 차단을 위임**한다(앱이 죽어도 OS가 막아준다).
 * 안드로이드엔 대응 API가 없다 — 서드파티 앱이 다른 앱을 막을 공개 수단은 두 가지뿐이고,
 * 접근성 서비스는 Play가 장애인 지원 외 용도를 엄격 심사해 거절·삭제 위험이 크다.
 * 그래서 **UsageStats로 앞에 뜬 앱을 폴링하고, 차단 대상이면 오버레이 창으로 덮는** 방식을 쓴다.
 *
 * ## 왜 오버레이 창(Activity 아님)인가
 * 백그라운드에서 Activity를 띄우는 건 Android 10+에서 막혀 있다(예외 조건이 기기·상황마다
 * 다르게 동작한다). `TYPE_APPLICATION_OVERLAY` 창은 '다른 앱 위에 표시' 권한만 있으면
 * 백그라운드 제약 없이 즉시 올릴 수 있어 예측 가능하다.
 *
 * ## 한계 (정직하게 문서화)
 * - **최대 ~1초 노출**: 차단 앱을 연 직후 폴링 주기만큼 그 앱이 보인다. iOS는 0초다.
 * - **강제 종료 불가**: 남의 앱을 죽일 수 없다. 가림막을 덮고 우리 앱으로 돌아오게 유도만 한다.
 * - **서비스가 죽으면 차단도 멈춘다**: 포그라운드 서비스로 우선순위를 올리지만, 제조사
 *   배터리 최적화(삼성 등)가 여전히 죽일 수 있다 — 실기기 검증이 필요한 지점.
 * - **시스템 설정 앱은 못 덮는다**: 안드로이드가 탭재킹(권한 화면 위조) 방지로 설정 화면 위
 *   오버레이를 숨긴다. 우리 코드 문제가 아니라 OS 보안 정책이며, 우회할 방법도 없다(우회하면
 *   그게 악성 앱이다). 2026-08-18 에뮬레이터 실측: 시계·연락처·카메라는 덮이고 설정만 안 덮인다.
 *   → 사용자가 설정으로 도망갈 구멍이 하나 열려 있다는 뜻이다. 정책적으로 감수한다.
 */
class FocusShieldService : Service() {

  companion object {
    const val ACTION_START = "com.oneorthree.gromo.screentime.SHIELD_START"
    const val ACTION_STOP = "com.oneorthree.gromo.screentime.SHIELD_STOP"
    /** 잠금화면 타이머 정보 갱신 — 차단은 건드리지 않는다(iOS Live Activity 대응). */
    const val ACTION_ACTIVITY = "com.oneorthree.gromo.screentime.SHIELD_ACTIVITY"
    /** 타이머 정보만 종료. **차단은 끄지 않는다** — 아래 주석 참고. */
    const val ACTION_ACTIVITY_END = "com.oneorthree.gromo.screentime.SHIELD_ACTIVITY_END"
    const val EXTRA_SUBJECT = "subject"
    const val EXTRA_ALLOWED = "allowed"
    const val EXTRA_OTHERS = "others"
    /** 타이머 상태 JSON(iOS FocusActivityState 와 같은 모양) — 없으면 카운트업으로 본다. */
    const val EXTRA_STATE = "state"

    private const val CHANNEL_ID = "gromo_focus_shield"
    private const val NOTIFICATION_ID = 4201

    /**
     * 실드 생존 표식(코드리뷰 반영). 폴링이 돌 때마다 여기에 현재 시각을 남긴다.
     *
     * 제조사 배터리 최적화(삼성 등)가 백그라운드에서 이 서비스를 죽여도 앱은 그 사실을 모른다.
     * 그러면 `shieldedRef` 가 계속 true 로 남아, **차단 없이 다른 앱을 쓴 시간이 집중으로
     * 적립된다.** 앱이 포그라운드로 돌아올 때 이 표식의 신선도로 생존을 확인한다.
     *
     * PREFS_NAME 은 ScreenTimeModule 과 같은 저장소를 가리킨다 — 값이 갈리면 표식을 못 읽어
     * 항상 '죽었다'로 판정된다.
     */
    const val PREFS_NAME = "gromo_screen_time"
    const val KEY_SHIELD_HEARTBEAT = "shieldHeartbeat"

    /**
     * 표식이 이보다 오래되면 죽은 것으로 본다.
     *
     * 폴링 주기(1초)의 5배 — Doze·앱 대기 버킷으로 핸들러가 잠깐 밀리는 것까지는 살아 있는
     * 것으로 봐야 오탐이 없다. 반대로 너무 길게 잡으면 죽은 걸 살아 있다고 읽어 부정 사용이
     * 열리므로, '밀림'은 흡수하되 '죽음'은 놓치지 않는 선으로 잡았다.
     */
    const val HEARTBEAT_STALE_MS = 5000L

    /**
     * 앞 앱 확인 주기(ms).
     *
     * 1초는 '차단 앱이 보이는 시간'과 배터리의 절충점이다. 더 짧게 잡아도 UsageStats 이벤트가
     * 그보다 촘촘히 갱신되지 않아 체감이 거의 안 바뀌고, 깨어나는 횟수만 늘어난다.
     */
    private const val POLL_INTERVAL_MS = 1000L

    /** 이벤트 조회 창 — 폴링 주기보다 넉넉히 잡아야 주기 사이에 끼인 전환을 놓치지 않는다. */
    private const val EVENT_WINDOW_MS = 10_000L

    /** 권한 회수 확인 주기(틱). 폴링 1초 × 5 = 5초마다 AppOps 를 본다. */
    private const val PERMISSION_CHECK_TICKS = 5

    /**
     * 가림막 표시 연속 실패 한도. 이만큼 실패하면 차단 상태를 내린다.
     *
     * 1~2회는 권한이 방금 회수됐거나 창 전환 중일 수 있어 재시도 가치가 있지만, 5초(5틱)
     * 내내 못 올리면 재시도로 풀릴 문제가 아니다.
     */
    private const val OVERLAY_FAILURE_LIMIT = 5

    /** 알림 강조색 — src/constants/theme.ts 의 accent(#5E6AD2)와 같은 값. */
    private const val ACCENT_COLOR = 0xFF5E6AD2.toInt()

    /** 캐릭터 스냅샷 최대 변(px) — 표시 상한 96dp의 2배. 위 characterBitmap KDoc 참고. */
    private const val CHARACTER_MAX_PX = 192

    /** 이보다 옅은 픽셀은 여백으로 친다(트림 기준). */
    private const val ALPHA_THRESHOLD = 8
  }

  private val handler = Handler(Looper.getMainLooper())
  private var overlay: ShieldOverlay? = null
  private var subject: String = "집중"
  private var allowed: Set<String> = emptySet()
  private var running = false
  /** 런처 앱 목록 캐시 — 서비스 수명 동안 유지한다(세션 중 앱 설치·삭제는 드물다). */
  private var launchableCache: Set<String>? = null
  /**
   * 마지막으로 확인한 전면 앱(코드리뷰 반영).
   *
   * RESUMED 이벤트는 **전환**을 표시한다. 조회 창(10초)에 이벤트가 없다는 건 '모르겠다'가
   * 아니라 **'그동안 바뀐 게 없다'** 는 뜻이다. 이걸 null 로 읽고 가림막을 걷으면, 차단 앱에
   * 10초만 머물러도 가림막이 사라지고 그 뒤로 계속 열린 채로 쓸 수 있다 — heartbeat 는 계속
   * 갱신되니 앱은 실드가 살아 있다고 믿어 그 시간을 전부 집중으로 적립한다.
   */
  private var lastForeground: String? = null
  /** 덮으면 안 되는 시스템 패키지 캐시(전화·시계). */
  private var exemptCache: Set<String>? = null
  /** 가림막을 연속으로 못 올린 횟수 — 한도를 넘으면 차단이 성립하지 않는 기기로 본다. */
  private var overlayFailures = 0
  /** 권한 확인 주기 카운터 — 매 틱마다 AppOps 를 두드리지 않으려고 센다. */
  private var ticksSincePermissionCheck = 0
  /** 차단을 실제로 도는가. 타이머만 필요한 호출(ACTION_ACTIVITY)로는 켜지지 않는다. */
  private var blocking = false
  /** 다른 과목 누적 — 확장 알림에만 쓴다(iOS 잠금화면 칩과 같은 정보). */
  private var others: List<Other> = emptyList()
  /**
   * 잠금화면 타이머 상태(코드리뷰 반영).
   *
   * 예전엔 과목명과 다른 과목만 받고 **state 를 통째로 버렸다.** 그래서 Chronometer 가 늘
   * 최초 startedAt 기준으로 카운트업했다 — 일시정지 중에도 시간이 늘고, 카운트다운·휴식
   * 페이즈에도 엉뚱한 경과 시간이 잠금화면에 찍혔다.
   */
  private var paused = false
  /** 남은 시간(초). null 이면 카운트업 모드. */
  private var remainingSeconds: Int? = null
  /** 뽀모도로 페이즈("focus" | "break") — 알림 문구를 가른다. */
  private var phase = "focus"
  /**
   * JS 가 보고한 경과(초) — **일시정지 시간이 빠진** 진짜 경과다.
   *
   * 일시정지 화면에 찍을 값이자, 재개 후 카운트업의 기준이기도 하다. 최초 startedAt 부터의
   * 벽시계를 쓰면 멈춰 있던 시간이 합산돼 재개 순간 숫자가 앞으로 뛴다(코드리뷰 3차).
   */
  private var elapsedSeconds = 0
  // 알림 크로노미터 기준 시각 — 세션이 이어지는 동안 유지해야 시간이 튀지 않는다.
  private var startedAt = 0L

  private val poll = object : Runnable {
    override fun run() {
      if (!running) return
      try {
        tick()
      } catch (_: Exception) {
        // 폴링 한 번의 실패로 세션 전체를 끝내지 않는다 — 다음 주기에 다시 시도한다.
      }
      handler.postDelayed(this, POLL_INTERVAL_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopShield()
        return START_NOT_STICKY
      }
      ACTION_ACTIVITY_END -> {
        // ⚠️ 여기서 stopShield()를 부르면 안 된다. iOS에서 endFocusActivity는 Live Activity만
        // 끝내고 실드는 stopFocusShield가 따로 내린다. 그런데 JS의 Live Activity 이펙트는
        // 의존성(subjectName·subjectId)이 바뀔 때마다 정리 함수가 돌아 endFocusActivity를
        // 부른다 — 여기서 서비스를 통째로 내리면 **과목만 바꿔도 차단이 조용히 풀린다.**
        // (2026-08-18 실측: 세션은 도는데 서비스가 사라져 상태바 아이콘도 없었다.)
        others = emptyList()
        if (!blocking) {
          // 차단 없이 타이머만 돌던 세션이면 서비스가 더 있을 이유가 없다.
          stopShield()
        } else {
          startForeground(NOTIFICATION_ID, buildNotification())
        }
        return START_NOT_STICKY
      }
      ACTION_ACTIVITY -> {
        // 타이머 정보만 갱신 — 차단 상태는 그대로 둔다.
        intent.getStringExtra(EXTRA_SUBJECT)?.let { subject = it }
        // 상태만 갱신하는 호출(updateFocusActivity)은 과목·다른 과목을 안 보낸다 — 그때
        // 덮어쓰면 잠금화면에서 칩이 사라진다. 온 것만 반영한다.
        intent.getStringExtra(EXTRA_OTHERS)?.let { others = parseOthers(it) }
        intent.getStringExtra(EXTRA_STATE)?.let { applyTimerState(it) }
        if (startedAt == 0L) startedAt = System.currentTimeMillis()
        startForeground(NOTIFICATION_ID, buildNotification())
        return START_NOT_STICKY
      }
      else -> {
        subject = intent?.getStringExtra(EXTRA_SUBJECT) ?: "집중"
        allowed = intent?.getStringArrayExtra(EXTRA_ALLOWED)?.toSet() ?: emptySet()
        applyTimerState(intent?.getStringExtra(EXTRA_STATE))
        blocking = true
        // 과목을 바꾸면 start가 다시 오는데, 그때 기준 시각을 리셋하면 잠금화면 타이머가 0으로
        // 되돌아간다. 이미 돌고 있으면 처음 시작 시각을 그대로 쓴다.
        if (startedAt == 0L) startedAt = System.currentTimeMillis()
        startForeground(NOTIFICATION_ID, buildNotification())
        if (!running) {
          running = true
          handler.post(poll)
        }
      }
    }
    // START_STICKY로 되살리지 않는다 — 세션이 이미 끝났는데 서비스만 부활하면 아무 세션도
    // 없는 상태에서 남의 앱을 덮는다. 되살리기는 앱이 세션 상태를 보고 명시적으로 한다.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    stopShield()
    super.onDestroy()
  }

  private fun stopShield() {
    running = false
    blocking = false
    launchableCache = null
    exemptCache = null
    overlayFailures = 0
    paused = false
    phase = "focus"
    remainingSeconds = null
    elapsedSeconds = 0
    lastForeground = null
    ticksSincePermissionCheck = 0
    others = emptyList()
    startedAt = 0L
    handler.removeCallbacks(poll)
    overlay?.hide()
    overlay = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  /** 한 주기: 앞 앱을 읽어 차단 대상이면 덮고, 아니면 걷는다. */
  private fun tick() {
    // 차단 권한이 없어 타이머만 도는 세션 — 폴링은 돌지만 덮지 않는다.
    if (!blocking) return

    // 살아 있다는 표식. 앱이 복귀할 때 이 값으로 '백그라운드에서 서비스가 죽었는지'를 가른다
    // (코드리뷰 반영) — 제조사 배터리 최적화가 조용히 죽이면 차단 없이 쓴 시간이 집중으로
    // 적립돼 버린다. 표식이 낡아 있으면 앱이 비실드 이탈 정책으로 되돌린다.
    heartbeat()

    // 전환 이벤트가 없으면 **직전 값을 유지한다**(코드리뷰 반영) — 자세한 이유는
    // lastForeground 필드 주석 참고. 여기서 null 로 떨어뜨리면 10초 이상 머무는 순간
    // 차단이 조용히 풀린다.
    latestResumedPackage()?.let { lastForeground = it }

    // 권한이 중간에 회수됐는지는 주기적으로만 확인한다 — 매 틱 AppOps 를 두드릴 필요는 없다.
    if (++ticksSincePermissionCheck >= PERMISSION_CHECK_TICKS) {
      ticksSincePermissionCheck = 0
      if (!usageAccessGranted()) {
        // 권한이 사라지면 전면 앱을 영영 못 읽는다 — 일시적 공백이 아니라 확정 실패다.
        // 가림막을 걷고 차단 상태를 내린다(그 뒤로 heartbeat 도 이 분기를 못 지나 낡는다).
        hideOverlay()
        blocking = false
        startForeground(NOTIFICATION_ID, buildNotification())
        return
      }
    }

    // 아직 한 번도 전면 앱을 못 본 상태(콜드 스타트 직후) — 덮을 근거가 없으니 걷어 둔다.
    val front = lastForeground
    if (front == null) {
      hideOverlay()
      return
    }
    if (shouldBlock(front)) showOverlay() else hideOverlay()
  }

  /** 폴링이 돌고 있다는 표식 — 앱이 복귀 시 서비스 생존을 확인하는 근거. */
  private fun heartbeat() {
    getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
      .edit()
      .putLong(KEY_SHIELD_HEARTBEAT, System.currentTimeMillis())
      .apply()
  }

  /** 사용 정보 접근이 아직 살아 있는가 — 실드는 이 권한이 없으면 전면 앱을 못 읽는다. */
  private fun usageAccessGranted(): Boolean = runCatching {
    val appOps = getSystemService(APP_OPS_SERVICE) as android.app.AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(
        android.app.AppOpsManager.OPSTR_GET_USAGE_STATS,
        android.os.Process.myUid(),
        packageName,
      )
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(
        android.app.AppOpsManager.OPSTR_GET_USAGE_STATS,
        android.os.Process.myUid(),
        packageName,
      )
    }
    mode == android.app.AppOpsManager.MODE_ALLOWED
  }.getOrDefault(false)

  /**
   * 차단 대상인가.
   *
   * 우리 앱과 허용앱은 당연히 통과. 런처·시스템 UI도 통과시킨다 — 홈 화면을 덮으면 사용자가
   * 기기를 아예 못 쓰고, 가림막 위에서 빠져나갈 길도 막힌다.
   */
  private fun shouldBlock(packageName: String): Boolean {
    if (packageName == this.packageName) return false
    if (packageName in allowed) return false
    // 전화는 덮지 않는다(코드리뷰 반영). 기본 전화 앱은 런처 아이콘이 있어 아래 필터를 그냥
    // 통과하는데, **수신 전화 화면(InCallActivity)도 같은 패키지로 보고된다.** 허용앱에 안
    // 넣어 뒀으면 전화가 올 때 가림막이 통화 화면을 덮어 **전화를 못 받는다.**
    // 이 앱을 자유롭게 쓸 수 있게 되는 건 감수한다 — 전화를 못 받는 쪽이 훨씬 나쁘다
    // (설정 앱 구멍을 감수한 D1과 같은 판단).
    if (packageName in systemExemptPackages()) return false
    return packageName in cachedLaunchablePackages()
  }

  /**
   * 런처 앱이지만 **덮으면 안 되는** 패키지들 — 캐시한다.
   *
   * 둘 다 "런처 아이콘이 있는 평범한 앱"인데, 그 앱이 띄우는 **전체 화면 시스템 UI 가 같은
   * 패키지명으로 보고된다**. 패키지 단위로만 보는 우리 필터로는 그 둘을 못 가른다.
   *
   *   - 기본 전화 앱: 수신 전화 화면(InCallActivity) — 덮으면 **전화를 못 받는다**
   *   - 기본 시계 앱: 알람 전체 화면 — 덮으면 **알람을 끄거나 미룰 수 없고 소리가 계속 난다**
   *     (코드리뷰 반영 — 전화와 정확히 같은 구조의 문제다)
   *
   * 이 앱들을 집중 중에 자유롭게 쓸 수 있게 되는 건 감수한다. 전화를 못 받거나 알람을 못 끄는
   * 쪽이 훨씬 나쁘다(설정 앱 구멍을 감수한 D1 과 같은 판단).
   */
  private fun systemExemptPackages(): Set<String> {
    exemptCache?.let { return it }
    val out = HashSet<String>(2)
    runCatching {
      (getSystemService(TELECOM_SERVICE) as android.telecom.TelecomManager).defaultDialerPackage
    }.getOrNull()?.let { out.add(it) }
    // 기본 시계 앱 — 알람 목록 인텐트를 처리하는 앱으로 찾는다. 알람 UI 를 직접 식별하는
    // 공개 API 는 없어서, 그 앱을 통째로 예외로 둔다.
    runCatching {
      val intent = Intent(android.provider.AlarmClock.ACTION_SHOW_ALARMS)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        packageManager.resolveActivity(
          intent,
          android.content.pm.PackageManager.ResolveInfoFlags.of(0L),
        )
      } else {
        @Suppress("DEPRECATION")
        packageManager.resolveActivity(intent, 0)
      }
    }.getOrNull()?.activityInfo?.packageName?.let { out.add(it) }
    exemptCache = out
    return out
  }

  /**
   * 런처 앱 목록 — **캐시한다**(코드리뷰 반영).
   *
   * 차단 앱이 앞에 있는 동안 shouldBlock 이 1초마다 불리는데, 매번 queryIntentActivities 로
   * 설치 앱 전체를 훑으면 그 비용이 서비스 메인 스레드에서 세션 내내 반복된다. 앱 설치·삭제는
   * 세션 중에 드물어 캐시가 안전하고, 어긋나도 다음 세션에서 바로잡힌다.
   */
  private fun cachedLaunchablePackages(): Set<String> {
    launchableCache?.let { return it }
    return launchablePackages().also { launchableCache = it }
  }

  /** 런처에서 열 수 있는 앱만 차단 대상 — 시스템 UI·런처 등을 걸러낸다. */
  private fun launchablePackages(): Set<String> {
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val resolved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.queryIntentActivities(
        intent,
        android.content.pm.PackageManager.ResolveInfoFlags.of(0L),
      )
    } else {
      @Suppress("DEPRECATION")
      packageManager.queryIntentActivities(intent, 0)
    }
    return resolved.mapTo(HashSet()) { it.activityInfo.packageName }
  }

  /**
   * 조회 창 안에서 **가장 최근에 전면으로 올라온** 앱. 창에 전환이 없으면 null 이다
   * (= '모른다'가 아니라 '바뀐 게 없다' — 호출부가 직전 값을 유지한다).
   *
   * `queryUsageStats`의 `lastTimeUsed` 최댓값을 쓰는 흔한 방법은 버킷 경계가 흔들려 방금 닫은
   * 앱을 앞 앱으로 잘못 짚는다. RESUMED 이벤트 중 **가장 최근 것**을 쓰면 전환 순서가 그대로 남는다.
   */
  private fun latestResumedPackage(): String? {
    val usm = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return null
    val now = System.currentTimeMillis()
    val events = usm.queryEvents(now - EVENT_WINDOW_MS, now)
    val event = UsageEvents.Event()
    var latestPackage: String? = null
    var latestAt = 0L
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED && event.timeStamp >= latestAt) {
        latestAt = event.timeStamp
        latestPackage = event.packageName
      }
    }
    return latestPackage
  }

  private fun showOverlay() {
    if (overlay?.isShowing == true) {
      overlayFailures = 0
      return
    }
    val view = overlay ?: ShieldOverlay(this).also { overlay = it }
    if (view.show(subject)) {
      overlayFailures = 0
    } else if (++overlayFailures >= OVERLAY_FAILURE_LIMIT) {
      // 계속 못 올린다 = 이 기기에선 차단이 성립하지 않는다(코드리뷰 반영). 시작 시점 권한
      // 검사를 통과했어도 제조사 제약으로 addView 가 매번 실패할 수 있다. 그대로 두면
      // **가림막이 한 번도 안 떴는데 heartbeat 는 돌아** 앱이 실드를 믿고 이탈을 적립한다.
      // 차단 상태를 내리면 heartbeat 도 갱신되지 않아 앱이 비실드 정책으로 되돌린다.
      blocking = false
      startForeground(NOTIFICATION_ID, buildNotification())
      return
    }
  }

  private fun hideOverlay() {
    overlay?.hide()
  }

  /**
   * 포그라운드 서비스 알림 — 없애면 시스템이 서비스를 곧 죽인다.
   *
   * ## iOS Live Activity를 그대로 옮긴 자리
   * iOS는 잠금화면에 캐릭터 + 과목명 + "집중하는 중이에요!" + 경과 타이머 + 다른 과목 칩을
   * 띄운다(`ios/Widget/WidgetLiveActivity.swift`). 안드로이드엔 Live Activity가 없어 **상시
   * 알림이 그 자리를 대신한다** — 그래서 배치·문구·간격까지 그쪽에 맞춘다.
   *
   * ## 왜 커스텀 뷰인가 (BigTextStyle이 아니라)
   * 기본 템플릿은 제목·본문 텍스트뿐이라 iOS의 **캐릭터 비율 유지**와 **색점 달린 과목 칩**을
   * 표현할 수 없다. 텍스트로 흉내 내면 `자료해석   0분` 같은 나열이 되어 같은 제품으로 안 읽힌다.
   *
   * ## 왜 setColorized를 쓰지 않는가
   * 알림 전체를 인디고로 칠하면 화려하지만 **iOS와 반대**다. iOS는 GROMO-868에서 잠금화면
   * 배너를 앱과 같은 라이트 톤(paper)으로 정했다(`activityBackgroundTint(laBg)`). 안드로이드
   * 알림 배경은 시스템 소유라 흰색을 강제할 수 없으므로, 통짜로 칠하는 대신 **시스템 배경을
   * 그대로 두고 포인트색은 칩·상태바 아이콘 틴트로만** 쓴다. 결과적으로 양쪽 다 '앱 톤 위에
   * 인디고 포인트'가 된다.
   *
   * `DecoratedCustomViewStyle`은 시스템이 헤더(앱 이름·시각·펼침 화살표)를 그리고 본문만
   * 우리 뷰로 채우는 방식이다. Android 12+는 완전 커스텀 알림을 허용하지 않으므로 이게 정공법이다.
   */
  private fun buildNotification(): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // IMPORTANCE_LOW — 소리·헤드업 없이 상태만 남긴다. 집중을 방해하면 안 된다.
      val channel = NotificationChannel(CHANNEL_ID, "집중 중", NotificationManager.IMPORTANCE_LOW)
      channel.setShowBadge(false)
      channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      manager.createNotificationChannel(channel)
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pending = launch?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val character = characterBitmap() ?: launcherIconBitmap()
    return builder
      // 커스텀 뷰가 가려도 접근성·요약·잠금화면 폴백은 이 텍스트를 읽는다 — 반드시 채운다.
      .setContentTitle(subject)
      .setContentText(statusLine())
      // 상태바 아이콘은 알파 전용 실루엣이어야 한다 — 런처 아이콘을 넘기면 흰 덩어리가 된다.
      .setSmallIcon(R.drawable.ic_focus_notification)
      // 통짜 칠(setColorized) 대신 **아이콘 틴트로만** 포인트색을 쓴다 — 위 KDoc 참고.
      .setColor(ACCENT_COLOR)
      // 스톱워치로 분류 — 잠금화면·요약에서 타이머류로 다뤄진다.
      .setCategory(Notification.CATEGORY_STOPWATCH)
      // 잠금화면에서 내용까지 보여야 '잠금화면 타이머'가 성립한다(기본 PRIVATE면 가려진다).
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setStyle(Notification.DecoratedCustomViewStyle())
      .setCustomContentView(collapsedView(character))
      .setCustomBigContentView(expandedView(character))
      .also { b -> pending?.let { b.setContentIntent(it) } }
      .build()
  }

  /** 접힌 본문 — 캐릭터·과목·타이머까지. iOS 컴팩트 다이나믹 아일랜드와 같은 정보량. */
  private fun collapsedView(character: Bitmap?): RemoteViews =
    RemoteViews(packageName, R.layout.notification_focus).apply {
      setTextViewText(R.id.notif_subject, subject)
      setTextViewText(R.id.notif_caption, statusLine())
      character?.let { setImageViewBitmap(R.id.notif_character, it) }
      bindTimer(R.id.notif_timer)
    }

  /** 펼친 본문 — 위에 더해 다른 과목 칩 최대 2개. iOS 잠금화면 배너와 같은 정보량. */
  private fun expandedView(character: Bitmap?): RemoteViews =
    RemoteViews(packageName, R.layout.notification_focus_expanded).apply {
      setTextViewText(R.id.notif_subject, subject)
      setTextViewText(R.id.notif_caption, statusLine())
      character?.let { setImageViewBitmap(R.id.notif_character, it) }
      bindTimer(R.id.notif_timer)
      // iOS와 같이 상위 2개만. 남는 행은 GONE — 빈 칩 자리를 남기면 레이아웃이 뜬다.
      val rows = listOf(
        Triple(R.id.notif_row0, R.id.notif_dot0, R.id.notif_name0 to R.id.notif_time0),
        Triple(R.id.notif_row1, R.id.notif_dot1, R.id.notif_name1 to R.id.notif_time1),
      )
      rows.forEachIndexed { index, (rowId, dotId, texts) ->
        val other = others.getOrNull(index)
        if (other == null) {
          setViewVisibility(rowId, android.view.View.GONE)
          return@forEachIndexed
        }
        setViewVisibility(rowId, android.view.View.VISIBLE)
        // 점은 흰 원 드로어블이라 과목색을 런타임에 입힌다(RemoteViews가 허용하는 몇 안 되는 경로).
        setInt(dotId, "setColorFilter", other.color)
        setTextViewText(texts.first, other.name)
        setTextViewText(texts.second, hms(other.seconds))
      }
    }

  /**
   * Chronometer 기준 시각 바인딩.
   *
   * ⚠️ Chronometer의 base는 `System.currentTimeMillis()`가 아니라 **`elapsedRealtime()` 시간축**이다.
   * 세션 시작 벽시계 시각을 그대로 넣으면 1970년부터 센 값이 찍힌다.
   *
   * format=null → "MM:SS"(1시간 넘으면 "H:MM:SS"). started=true 면 **시스템이 초당 갱신**하므로
   * 우리가 1초마다 알림을 다시 쏠 필요가 없다(iOS Text(timerInterval:)와 같은 계약).
   *
   * setChronometerCountDown 은 API 24+ 인데 이 앱의 minSdk 가 24라 버전 분기가 필요 없다
   * (`./gradlew :app:properties` 로 확인).
   */
  /**
   * 알림 요약 문구 — iOS `WidgetLiveActivity.statusLine()` 과 **같은 규칙**이다(코드리뷰 4차).
   *
   * 예전엔 "집중하는 중이에요!" 로 하드코딩돼 있어서, 휴식 중이나 일시정지 중에도 잠금화면이
   * **집중 중이라고 안내했다.** 요약 텍스트와 커스텀 뷰 둘 다 같은 값을 쓴다.
   */
  private fun statusLine(): String = when {
    paused -> "잠시 멈췄어요"
    phase == "break" -> "쉬는 중이에요!"
    else -> "집중하는 중이에요!"
  }

  private fun RemoteViews.bindTimer(viewId: Int) {
    val now = SystemClock.elapsedRealtime()
    when {
      // 일시정지 — 멈춘 값을 그대로 둔다. started=false 면 시스템이 갱신하지 않으므로,
      // base 를 '지금 - 경과' 로 잡아 두면 그 시점 텍스트가 경과 시간으로 찍힌 채 멈춘다.
      paused -> {
        setChronometerCountDown(viewId, false)
        // ⚠️ 카운트다운이면 **남은 시간**을 고정한다(코드리뷰 4차). 경과를 찍으면 25분 타이머를
        //    3초 뒤 멈춘 화면이 `24:57` 이 아니라 `00:03` 으로 굳는다.
        //    iOS FocusActivityStatePayload.contentState() 의 `remainingSeconds ?? elapsedSeconds`
        //    와 같은 규칙이다.
        val frozen = remainingSeconds ?: elapsedSeconds
        setChronometer(viewId, now - frozen * 1000L, null, false)
      }
      // 카운트다운·뽀모도로 — 남은 시간을 센다. base 를 미래로 두고 countDown 을 켜면
      // 시스템이 초당 줄여 준다(우리가 1초마다 알림을 다시 쏠 필요가 없다).
      remainingSeconds != null -> {
        setChronometerCountDown(viewId, true)
        setChronometer(viewId, now + remainingSeconds!! * 1000L, null, true)
      }
      else -> {
        // 이전 상태가 카운트다운이었을 수 있어 명시적으로 끈다 — RemoteViews 는 같은 뷰를
        // 재사용하므로 안 끄면 카운트업이어야 할 자리가 계속 줄어든다.
        setChronometerCountDown(viewId, false)
        // ⚠️ 최초 startedAt 부터의 **벽시계**를 쓰면 안 된다(코드리뷰 3차). 일시정지했다
        //    재개하면 멈춰 있던 시간까지 합산돼 재개 순간 숫자가 앞으로 뛴다.
        //    JS 가 보내는 elapsedSeconds 가 정지 시간을 뺀 진짜 경과라 그걸 기준으로 잡는다.
        //    (아직 상태를 못 받았으면 0 이라 startedAt 기준으로 폴백한다 — 예전 동작.)
        val elapsed =
          if (elapsedSeconds > 0) elapsedSeconds * 1000L
          else System.currentTimeMillis() - startedAt
        setChronometer(viewId, now - elapsed, null, true)
      }
    }
  }

  /**
   * 타이머 상태 JSON 반영 — iOS FocusActivityState 와 같은 모양이다.
   *
   * `{"mode":"countdown","phase":"focus","isPaused":false,"elapsedSeconds":90,
   *   "remainingSeconds":510,"revision":3}`
   *
   * 없거나 깨졌으면 카운트업으로 되돌린다 — 모르는 상태를 카운트다운으로 그리는 것보다
   * 안전하다(경과 시간은 최소한 startedAt 기준으로 맞다).
   */
  private fun applyTimerState(json: String?) {
    if (json.isNullOrBlank()) {
      paused = false
      phase = "focus"
      remainingSeconds = null
      return
    }
    runCatching {
      val obj = org.json.JSONObject(json)
      paused = obj.optBoolean("isPaused", false)
      phase = obj.optString("phase", "focus")
      elapsedSeconds = obj.optInt("elapsedSeconds", 0)
      remainingSeconds = if (obj.isNull("remainingSeconds")) null else obj.optInt("remainingSeconds")
    }.onFailure {
      paused = false
      phase = "focus"
      remainingSeconds = null
    }
  }

  /**
   * `[{"name":"자료해석","seconds":3600,"color":"#5E6AD2"}]` → 과목 목록.
   *
   * JSON 라이브러리를 쓰지 않고 org.json으로 끝낸다 — 이 한 곳뿐이라 의존성을 늘릴 이유가 없다.
   * 파싱 실패는 빈 목록: 확장 알림에서 과목 칩만 빠지고 타이머는 그대로 산다.
   */
  private fun parseOthers(json: String?): List<Other> = runCatching {
    if (json.isNullOrBlank()) return emptyList()
    val array = org.json.JSONArray(json)
    (0 until array.length()).mapNotNull { i ->
      val item = array.optJSONObject(i) ?: return@mapNotNull null
      val name = item.optString("name").takeIf { it.isNotBlank() } ?: return@mapNotNull null
      Other(name, item.optInt("seconds", 0), parseColor(item.optString("color")))
    }
  }.getOrDefault(emptyList())

  /** "#RRGGBB" → 색. 실패하면 포인트색 — iOS colorFromHex의 폴백과 같다. */
  private fun parseColor(hex: String?): Int =
    runCatching { Color.parseColor(hex) }.getOrDefault(ACCENT_COLOR)

  /** 다른 과목 한 줄 — iOS GromoFocusAttributes.OtherSubject와 같은 필드. */
  private data class Other(val name: String, val seconds: Int, val color: Int)

  /** 초 → "00:00:00" — iOS 잠금화면 칩의 hmsString과 같은 표기. */
  private fun hms(seconds: Int): String {
    val s = maxOf(0, seconds)
    return String.format("%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
  }

  /**
   * 알림에 쓸 캐릭터 스냅샷. 세션 시작 시 JS가 캡처해 저장한다(saveCharacterSnapshot).
   *
   * iOS 실드·Live Activity가 App Group의 focusCharacter.png를 읽는 것과 같은 자리다.
   * 없으면 null — 호출부가 앱 아이콘으로 폴백한다(iOS도 스냅샷 실패 시 기본 마스코트).
   *
   * ## 두 가지 후처리를 반드시 거친다
   * 1. **투명 여백 트림** — 캡처본은 캐릭터 주위에 빈 픽셀이 넓게 남는다. 그대로 넣으면 정해진
   *    박스 안에서 캐릭터만 쪼그라들어 보인다(iOS도 같은 이유로 trimmingTransparentEdges를 쓴다).
   * 2. **축소** — RemoteViews 비트맵은 **Binder 트랜잭션(≈1MB)에 실려 간다.** 캡처 원본
   *    (수백×수백 ARGB)을 그대로 실으면 알림이 조용히 안 뜬다. 표시 상한(96dp)의 2배까지만 줄인다.
   */
  private fun characterBitmap(): Bitmap? = runCatching {
    val file = java.io.File(filesDir, ScreenTimeModule.CHARACTER_FILE)
    if (!file.exists()) return null
    val decoded = android.graphics.BitmapFactory.decodeFile(file.path) ?: return null
    downscale(trimTransparent(decoded))
  }.getOrNull()

  /**
   * 투명 여백을 잘라 실제 캐릭터 비율을 되찾는다. 알파가 임계값을 넘는 픽셀들의 경계 상자를 쓴다.
   * 전부 투명하면(캡처 실패) 원본을 그대로 돌려준다 — 0×0 비트맵을 만들면 알림이 깨진다.
   */
  private fun trimTransparent(source: Bitmap): Bitmap {
    val w = source.width
    val h = source.height
    if (w <= 0 || h <= 0) return source
    val pixels = IntArray(w * h)
    source.getPixels(pixels, 0, w, 0, 0, w, h)
    var left = w
    var top = h
    var right = -1
    var bottom = -1
    for (y in 0 until h) {
      for (x in 0 until w) {
        // 알파 8 미만은 눈에 안 보이는 잔여물 — 여백으로 친다.
        if ((pixels[y * w + x] ushr 24) < ALPHA_THRESHOLD) continue
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
    if (right < left || bottom < top) return source
    return Bitmap.createBitmap(source, left, top, right - left + 1, bottom - top + 1)
  }

  /** 표시 상한의 2배(=고밀도 화면 기준 픽셀)까지 비율 그대로 줄인다. 이미 작으면 그대로. */
  private fun downscale(source: Bitmap): Bitmap {
    val max = maxOf(source.width, source.height)
    if (max <= CHARACTER_MAX_PX) return source
    val ratio = CHARACTER_MAX_PX.toFloat() / max
    return Bitmap.createScaledBitmap(
      source,
      maxOf(1, (source.width * ratio).toInt()),
      maxOf(1, (source.height * ratio).toInt()),
      true,
    )
  }

  /** 큰 아이콘용 런처 아이콘 비트맵. 어댑티브 아이콘은 Bitmap이 아니라 Drawable이라 직접 그린다. */
  private fun launcherIconBitmap(): Bitmap? = runCatching {
    val drawable = packageManager.getApplicationIcon(packageName)
    val size = (48 * resources.displayMetrics.density).toInt()
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    drawable.setBounds(0, 0, size, size)
    drawable.draw(canvas)
    bitmap
  }.getOrNull()
}
