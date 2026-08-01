package com.oneorthree.gromo.screentime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.provider.Telephony
import android.telecom.TelecomManager
import android.text.format.DateUtils
import android.view.View
import android.view.WindowManager
import android.widget.RemoteViews
import org.json.JSONArray

// 집중 세션 포그라운드 서비스(GROMO-996, 03-스크린타임-구현 §5·§6) — 두 역할을 겸한다:
//  1. 실드(ROLE_SHIELD): 1~2초 간격 queryEvents 폴링으로 현재 포그라운드 앱을 감지해,
//     허용앱 외 앱이면 차단 오버레이(FocusBlockContentView)를 최상단에 띄운다. 안드로이드엔
//     iOS ManagedSettings 같은 시스템 차단 API가 없어 직접 지키는 방식이다.
//     접근성 서비스는 쓰지 않는다(Play '장애 지원 외 목적' 심사 리스크 — §5).
//  2. 타이머(ROLE_TIMER): ongoing 알림 + setUsesChronometer로 상단바·잠금화면에 경과
//     시간이 실시간으로 올라가는 타이머를 띄운다 — iOS Live Activity 대응(§6).
// FGS는 상시 알림이 필수라 두 역할이 알림 하나를 자연스럽게 공유한다. 역할은 각각
// 켜고 끌 수 있고(실드 없는 세션 = 타이머만), 둘 다 꺼지면 서비스가 스스로 종료한다.
//
// 수용 한계(§5·§6 — iOS와의 품질 차이 전부):
//  - 차단 화면까지 폴링 간격만큼(1~2초) 지연 — iOS는 시스템이 즉시 차단.
//  - 홈 런처·전화 등 시스템 UI는 차단하지 않는다(iOS도 시스템 앱은 예외라 실질 차이 작음).
//  - 유저가 권한을 끄거나 앱을 강제종료하면 무력화 — JS 세션 이탈 감지(15초 룰)가 커버.
//  - 안드14+에선 FGS 알림을 스와이프로 지울 수 있다 — deleteIntent 즉시 재게시 + 주기
//    재게시로 완화할 뿐 완전 방지는 불가.
class FocusSessionService : Service() {
  companion object {
    // 실행 중 인스턴스 — 모듈이 서비스에 명령을 전달하는 통로. 프로세스가 죽으면 서비스도
    // 함께 죽으므로(START_NOT_STICKY) '인스턴스 없음 = 서비스 없음'이 성립한다.
    @Volatile private var instance: FocusSessionService? = null

    // 기동 중 취소 가드(코드리뷰 반영) — startForegroundService 직후 onCreate 전에 stop이 오면
    // instance가 null이라 no-op이 되고, 큐에 남은 시작이 그대로 진행돼 실드가 영구 잔존한다.
    // 시작/취소 세대를 기록해 onStartCommand가 '취소된 기동'을 확인하면 즉시 내린다.
    @Volatile private var startedGeneration = 0

    @Volatile private var cancelledGeneration = 0

    // 실드 상실 통지(코드리뷰 반영) — 세션 중 권한 회수 등으로 서비스가 실드를 내리면 모듈이
    // 이 콜백으로 JS(onFocusShieldLost 이벤트)에 전파한다. 모듈 생성/파괴 시 배선/해제.
    @Volatile internal var shieldLostListener: (() -> Unit)? = null

    private const val CHANNEL_ID = "focus_session"
    private const val NOTIFICATION_ID = 996

    // 알림 스와이프 삭제(안드14+) 시 재게시를 트리거하는 브로드캐스트 액션.
    private const val ACTION_RENOTIFY = "com.oneorthree.gromo.screentime.FOCUS_RENOTIFY"

    private const val EXTRA_ROLE = "role"
    private const val EXTRA_SUBJECT = "subjectName"
    private const val EXTRA_OTHER_SUBJECTS = "otherSubjectsJson"
    private const val ROLE_SHIELD = "shield"
    private const val ROLE_TIMER = "timer"

    // 확장 알림에 보여줄 다른 과목 상한 — iOS Live Activity(prefix(2))와 동일(GROMO-997).
    private const val MAX_OTHER_SUBJECTS = 2

    // 실드 폴링 간격 — §5 수용 한계(차단까지 1~2초 지연)가 이 값에서 나온다.
    private const val SHIELD_POLL_INTERVAL_MS = 1_500L
    // 타이머 전용일 때의 틱 간격 — 차단 감지가 없어 알림 재게시만 하면 된다.
    private const val TIMER_TICK_INTERVAL_MS = 30_000L
    // 알림 주기 재게시 간격(안드14+ 스와이프 완화의 보조 수단).
    private const val RENOTIFY_INTERVAL_MS = 30_000L
    // 폴백 차단 액티비티 연속 실행 방지 — 실행 직후 전환 애니메이션 중 중복 실행을 막는다.
    private const val BLOCK_RELAUNCH_DEBOUNCE_MS = 2_000L
    // 첫 폴링에서 현재 포그라운드 앱을 시드하기 위한 과거 조회 폭.
    private const val FIRST_POLL_LOOKBACK_MS = 60_000L

    // gromo 인디고(T.accent #5E6AD2) — 알림 강조색.
    private const val ACCENT_COLOR = 0xFF5E6AD2.toInt()

    // '브라우저 허용' 토글이 켜졌을 때 항상 허용하는 주요 브라우저 패키지(§4 —
    // iOS '사파리·웹 허용'의 안드로이드 대응). 기본 브라우저는 런타임에 추가로 식별한다.
    private val BROWSER_PACKAGES = setOf(
      "com.android.chrome", // Chrome
      "com.sec.android.app.sbrowser", // 삼성 인터넷
      "com.naver.whale", // 네이버 웨일
      "org.mozilla.firefox", // Firefox
      "com.microsoft.emmx", // Edge
      "com.opera.browser", // Opera
      "com.brave.browser", // Brave
    )

    // 실드 켜기 — 서비스가 없으면 FGS로 시작, 있으면 실행 중 인스턴스에 역할만 추가.
    fun startShield(context: Context, subjectName: String): Boolean =
      dispatchStart(context, ROLE_SHIELD, subjectName, null)

    // 타이머 켜기 — 실드와 독립(실드 없는 세션도 타이머는 뜬다).
    // otherSubjectsJson: 현재 과목 외 과목들의 누적 시간 — 확장 알림에 표시(GROMO-997).
    fun startTimer(context: Context, subjectName: String, otherSubjectsJson: String): Boolean =
      dispatchStart(context, ROLE_TIMER, subjectName, otherSubjectsJson)

    // 역할 끄기 — 서비스가 있으면 역할만 내린다(멱등 — 고아 세션 정리 등 어디서 불려도 안전).
    fun stopShield() = requestStop(ROLE_SHIELD)

    fun stopTimer() = requestStop(ROLE_TIMER)

    private fun requestStop(role: String) {
      val running = instance
      if (running != null) {
        running.postStop(role)
      } else {
        // 서비스 없음 — 아직 onCreate 전(기동 중)일 수 있으므로 진행 중 세대를 취소로 마감해,
        // 뒤늦게 뜬 서비스가 onStartCommand에서 스스로 내리게 한다(코드리뷰 반영).
        cancelledGeneration = startedGeneration
      }
    }

    // 타이머 일시정지/재개(코드리뷰 반영) — 화면의 수동 일시정지와 알림 크로노미터를 동기화한다.
    // 서비스 없으면 no-op(멱등).
    fun pauseTimer() = instance?.postTimerPaused(true) ?: Unit

    fun resumeTimer() = instance?.postTimerPaused(false) ?: Unit

    // 타이머 재동기화(코드리뷰 반영) — JS(화면)가 아는 집중 경과초·일시정지 상태로 크로노미터
    // 기준을 다시 맞춘다. pause/resume 짝을 못 맞추는 경로(백그라운드 리플레이로 지난 휴식
    // 경계, 타이머 시작 전 일시정지, 권한 왕복으로 지연된 시작)를 최종 상태 한 번으로 복구한다.
    // 서비스 없으면 no-op(멱등).
    fun syncTimer(elapsedSeconds: Long, paused: Boolean) =
      instance?.postTimerSync(elapsedSeconds, paused) ?: Unit

    // 실드 동작 여부 — 차단 화면이 자기 생존 판단(onResume)에, 모듈이 타이머 시작 판단에 쓴다.
    fun isShieldActive(): Boolean = instance?.shieldActive == true

    private fun dispatchStart(
      context: Context,
      role: String,
      subjectName: String,
      otherSubjectsJson: String?,
    ): Boolean {
      val running = instance
      if (running != null) {
        running.postStart(role, subjectName, otherSubjectsJson)
        return true
      }
      val intent = Intent(context, FocusSessionService::class.java)
        .putExtra(EXTRA_ROLE, role)
        .putExtra(EXTRA_SUBJECT, subjectName)
        .putExtra(EXTRA_OTHER_SUBJECTS, otherSubjectsJson)
      return try {
        // 기동 세대 갱신 — 이 시작 이후에 온 stop만 이 기동을 취소할 수 있다(코드리뷰 반영).
        startedGeneration += 1
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
        true
      } catch (_: Exception) {
        // 백그라운드 FGS 시작 제약(안드12+) 등 — 세션 진행엔 영향 없이 실패만 알린다.
        false
      }
    }
  }

  // 역할 상태 — 변경은 pollHandler 스레드에서만, 읽기는 여러 스레드(@Volatile).
  @Volatile var shieldActive = false
    private set

  @Volatile private var timerActive = false

  @Volatile private var subjectName = "집중"

  // 타이머 시작 시각(벽시계) — setWhen + setUsesChronometer 기준점.
  @Volatile private var timerStartedAt = 0L

  // 확장 알림에 표시할 다른 과목 목록(GROMO-997) — 세션 중 불변이라 정적 표시로도 정확
  // (iOS Live Activity와 동일 전제). 타이머 시작 때 파싱해 두고 종료 때 비운다.
  @Volatile private var otherSubjects: List<OtherSubject> = emptyList()

  // 타이머 일시정지 시각(0 = 진행 중, 코드리뷰 반영) — 일시정지 중엔 크로노미터 대신 고정
  // 경과를 표시하고, 재개 시 일시정지 구간만큼 timerStartedAt을 미뤄 화면 타이머와 다시 맞춘다.
  @Volatile private var timerPausedAt = 0L

  @Volatile private var lastNotifyAt = 0L

  private lateinit var pollThread: HandlerThread
  private lateinit var pollHandler: Handler

  // 폴링 상태(pollHandler 스레드 전용) — 마지막으로 처리한 이벤트 시각과 현재 포그라운드 앱.
  private var lastEventTs = 0L
  private var currentForeground: String? = null

  // 차단 오버레이(코드리뷰 반영, 안드15 대응) — 뷰 참조·추가/제거는 메인 스레드 전용이고,
  // visible 플래그만 폴링 스레드가 중복 post 방지용으로 읽는다.
  private val mainHandler = Handler(Looper.getMainLooper())
  private var blockOverlayView: View? = null

  @Volatile private var blockOverlayVisible = false

  // 오버레이 실패 시 폴백(차단 액티비티)의 연속 실행 방지 — 메인 스레드 전용.
  private var lastFallbackLaunchAt = 0L

  private val notificationManager: NotificationManager
    get() = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private val prefs
    get() = getSharedPreferences(ScreenTimeModule.PREFS_NAME, Context.MODE_PRIVATE)

  // 차단 예외로 항상 허용하는 시스템 성격 패키지 — iOS .all() 실드의 시스템 앱 예외 대응(§5).
  // 홈 런처(기기 사용 자체를 막지 않기), 전화·문자(안전), 설정·시스템 UI(권한 회수 경로를
  // 막으면 정책 리스크). 세션 중 기본 앱이 바뀌는 일은 없다시피 해 서비스 생존 동안 캐시한다.
  private val implicitAllowedPackages: Set<String> by lazy {
    val set = mutableSetOf(packageName)
    val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    packageManager.queryIntentActivities(home, 0).forEach { set.add(it.activityInfo.packageName) }
    (getSystemService(Context.TELECOM_SERVICE) as? TelecomManager)
      ?.defaultDialerPackage?.let { set.add(it) }
    Telephony.Sms.getDefaultSmsPackage(this)?.let { set.add(it) }
    set.add("com.android.settings")
    set.add("com.android.systemui")
    set
  }

  // 브라우저 허용 토글용 패키지 — 정적 목록 + 기기의 기본 브라우저.
  private val browserAllowedPackages: Set<String> by lazy {
    val set = BROWSER_PACKAGES.toMutableSet()
    val view = Intent(Intent.ACTION_VIEW, Uri.parse("https://oneorthree.world"))
    packageManager.resolveActivity(view, PackageManager.MATCH_DEFAULT_ONLY)
      ?.activityInfo?.packageName?.let { set.add(it) }
    set
  }

  // 알림 스와이프 삭제(deleteIntent) 수신 → 즉시 재게시(안드14+ 완화 — 완전 방지는 불가).
  private val renotifyReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      renotify()
    }
  }

  // 틱 루프 — 실드 중엔 폴링 간격(1.5초), 타이머 전용이면 재게시 간격(30초)으로 돈다.
  private val tickRunnable = object : Runnable {
    override fun run() {
      if (shieldActive) {
        // 세션 중 권한 재검증(코드리뷰 반영) — 집행 수단이 사라졌는데 조용히 재시도만 반복하면
        // JS가 '실드 중'으로 믿고 자리 비운 시간을 집중으로 인정한다. 즉시 내리고 전파한다.
        if (canEnforceShield()) pollAndBlock() else downgradeShield()
      }
      if (SystemClock.elapsedRealtime() - lastNotifyAt >= RENOTIFY_INTERVAL_MS) renotify()
      pollHandler.postDelayed(
        this,
        if (shieldActive) SHIELD_POLL_INTERVAL_MS else TIMER_TICK_INTERVAL_MS,
      )
    }
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
    createChannel()
    pollThread = HandlerThread("gromoFocusSession").also { it.start() }
    pollHandler = Handler(pollThread.looper)
    val filter = IntentFilter(ACTION_RENOTIFY)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(renotifyReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(renotifyReceiver, filter)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // startForegroundService 계약 — 즉시 startForeground(안드14+는 FGS 타입 명시 필수).
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // 기동 중 취소 확인(코드리뷰 반영) — startForegroundService와 onCreate 사이에 stop이 온
    // 기동이면 역할을 켜지 않고, FGS 계약(startForeground)만 지킨 채 즉시 내린다.
    if (cancelledGeneration >= startedGeneration) {
      stopForegroundCompat()
      stopSelf()
      return START_NOT_STICKY
    }
    val role = intent?.getStringExtra(EXTRA_ROLE)
    val subject = intent?.getStringExtra(EXTRA_SUBJECT)
    if (role != null && subject != null) {
      postStart(role, subject, intent.getStringExtra(EXTRA_OTHER_SUBJECTS))
    }
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  // 유저가 최근 앱 목록에서 gromo를 밀어 없앤 경우 — JS 세션도 함께 죽었으므로 서비스만
  // 남아 '유령 집중 중' 알림이 되지 않게 정리한다(다음 실행 시 OrphanFocusSettler가 정산).
  override fun onTaskRemoved(rootIntent: Intent?) {
    super.onTaskRemoved(rootIntent)
    postStop(ROLE_SHIELD)
    postStop(ROLE_TIMER)
  }

  override fun onDestroy() {
    instance = null
    FocusBlockActivity.closeIfShowing()
    hideBlockOverlay() // 서비스 종료 시 오버레이 잔존(leak) 금지 — 어떤 종료 경로든 확실히 제거
    try {
      unregisterReceiver(renotifyReceiver)
    } catch (_: Exception) {
      // 이미 해제됐거나 등록 실패 — 종료 흐름을 막지 않는다.
    }
    pollThread.quitSafely()
    super.onDestroy()
  }

  private fun postStart(role: String, subject: String, otherSubjectsJson: String?) {
    pollHandler.post { applyStart(role, subject, otherSubjectsJson) }
  }

  fun postStop(role: String) {
    pollHandler.post { applyStop(role) }
  }

  private fun applyStart(role: String, subject: String, otherSubjectsJson: String?) {
    subjectName = subject
    when (role) {
      ROLE_SHIELD -> {
        shieldActive = true
        // 폴링 커서를 룩백으로 시드(코드리뷰 반영) — 커서를 '지금'으로 리셋하면
        // startForegroundService~applyStart 사이(기동 큐 대기)에 연 비허용앱의 ACTIVITY_RESUMED를
        // 첫 폴링이 영영 못 봐, 그 앱에 머무는 동안 실드가 부재한다. 룩백 구간을 시간순으로
        // 재생하면 마지막 RESUMED = 실제 현재 포그라운드로 수렴하므로, 세션 시작 전의 과거 앱
        // (그 뒤 gromo RESUMED가 덮는다)을 잘못 차단하지 않고, 이미 처리한 구간과 겹쳐도 같은
        // 결론이라 중복 처리는 무해하다(멱등).
        lastEventTs = System.currentTimeMillis() - FIRST_POLL_LOOKBACK_MS
        currentForeground = null
      }
      ROLE_TIMER -> {
        timerActive = true
        timerStartedAt = System.currentTimeMillis()
        otherSubjects = parseOtherSubjects(otherSubjectsJson)
        timerPausedAt = 0L
      }
    }
    renotify()
    restartTick()
  }

  private fun applyStop(role: String) {
    when (role) {
      ROLE_SHIELD -> {
        shieldActive = false
        FocusBlockActivity.closeIfShowing()
        hideBlockOverlay()
      }
      ROLE_TIMER -> {
        timerActive = false
        otherSubjects = emptyList()
      }
    }
    if (!shieldActive && !timerActive) {
      stopForegroundCompat()
      stopSelf()
    } else {
      renotify()
      restartTick()
    }
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  private fun postTimerPaused(paused: Boolean) {
    pollHandler.post { applyTimerPaused(paused) }
  }

  // 일시정지/재개 반영(코드리뷰 반영) — 멱등. 재개 시 일시정지 구간만큼 시작 시각(base)을 미뤄
  // 크로노미터가 화면 경과와 다시 일치하게 한다.
  private fun applyTimerPaused(paused: Boolean) {
    if (!timerActive) return
    if (paused) {
      if (timerPausedAt != 0L) return
      timerPausedAt = System.currentTimeMillis()
    } else {
      if (timerPausedAt == 0L) return
      timerStartedAt += System.currentTimeMillis() - timerPausedAt
      timerPausedAt = 0L
    }
    renotify()
  }

  private fun postTimerSync(elapsedSeconds: Long, paused: Boolean) {
    pollHandler.post { applyTimerSync(elapsedSeconds, paused) }
  }

  // 재동기화 반영(코드리뷰 반영) — pause/resume 이력을 재연하는 대신 base를 now−경과로 재설정
  // 한다. 리플레이가 몇 번의 휴식 경계를 지났든 최종 경과·일시정지 상태만 맞으면 정확하다.
  // paused면 buildNotification의 고정 경과 표시가 그대로 elapsedSeconds가 된다.
  private fun applyTimerSync(elapsedSeconds: Long, paused: Boolean) {
    if (!timerActive) return
    val now = System.currentTimeMillis()
    timerStartedAt = now - elapsedSeconds * 1000L
    timerPausedAt = if (paused) now else 0L
    renotify()
  }

  // 역할이 바뀌면 틱 간격도 바뀌므로 대기 중인 틱을 버리고 즉시 한 번 돈다.
  private fun restartTick() {
    pollHandler.removeCallbacks(tickRunnable)
    pollHandler.post(tickRunnable)
  }

  // ── 실드 폴링(§5) ──

  // 직전 폴링 이후의 이벤트만 읽어 현재 포그라운드 앱을 추적하고, 비허용앱이면 차단 화면을
  // 띄운다. 측정(UsageSessionCalculator)과 달리 구간 합산이 아니라 '지금 뭐가 떠 있나'만
  // 필요해서 마지막 ACTIVITY_RESUMED 패키지 추적으로 충분하다.
  private fun pollAndBlock() {
    val now = System.currentTimeMillis()
    val begin = if (lastEventTs > 0) lastEventTs + 1 else now - FIRST_POLL_LOOKBACK_MS
    val usageStatsManager =
      getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val events = usageStatsManager.queryEvents(begin, now)
    val event = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      if (event.timeStamp > lastEventTs) lastEventTs = event.timeStamp
      when (event.eventType) {
        // ACTIVITY_RESUMED(=구 MOVE_TO_FOREGROUND, 값 1) — API 29 미만 기기의 구 이벤트도 같은 값.
        UsageEvents.Event.ACTIVITY_RESUMED -> currentForeground = event.packageName
        // 화면 꺼짐 — 포그라운드 없음으로 리셋(꺼진 화면 위에 차단을 띄우지 않기 위함).
        UsageEvents.Event.SCREEN_NON_INTERACTIVE -> currentForeground = null
      }
    }

    // 차단 판정 — 비허용앱이 떠 있으면 오버레이를 표시/유지하고, 허용앱·gromo 복귀나 화면
    // 꺼짐이면 내린다. 오버레이는 액티비티와 달리 포그라운드 앱을 바꾸지 않으므로(차단된 앱이
    // 오버레이 아래에 그대로 떠 있다) 폴링이 표시 상태를 직접 관리한다(코드리뷰 반영).
    val foreground = currentForeground
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    val shouldBlock = foreground != null &&
      foreground != packageName &&
      // 이벤트 결측 대비 이중 확인 — 화면이 꺼져 있으면 차단할 것도 없다.
      powerManager.isInteractive &&
      !isAllowed(foreground)
    if (shouldBlock) showBlockOverlay() else hideBlockOverlay()
  }

  // 허용 여부 — 유저 허용앱(prefs)은 폴링마다 다시 읽어 세션 중 변경(허용앱 편집·브라우저
  // 토글)이 1~2초 안에 반영된다(iOS setFocusAllowSafariWeb 라이브 반영 대응).
  // 허용앱 미설정(null)이면 예외 없이 전부 차단 — iOS startFocusShield와 동일한 기본.
  private fun isAllowed(pkg: String): Boolean {
    if (pkg in implicitAllowedPackages) return true
    val allowed = prefs.getStringSet(ScreenTimeModule.KEY_FOCUS_ALLOWED_PACKAGES, null)
    if (allowed != null && pkg in allowed) return true
    val allowBrowsers = prefs.getBoolean(ScreenTimeModule.KEY_FOCUS_ALLOW_BROWSERS, false)
    return allowBrowsers && pkg in browserAllowedPackages
  }

  // ── 차단 오버레이(코드리뷰 반영 — 03 문서 §5) ──
  // 안드15(API 35)에선 SYSTEM_ALERT_WINDOW 권한만으로는 서비스發 startActivity가 거부된다
  // ('보이는 오버레이 창'이 있어야 예외 적용 — 예외 없이 조용히 무시돼 catch로도 못 잡는다).
  // 그래서 차단 화면 자체를 WindowManager 풀스크린 오버레이로 띄운다. 레이아웃은 폴백
  // 액티비티(FocusBlockActivity)와 공유한다(FocusBlockContentView).

  private val windowManager: WindowManager
    get() = getSystemService(Context.WINDOW_SERVICE) as WindowManager

  private fun showBlockOverlay() {
    if (blockOverlayVisible) return // 이미 표시 중 — 매 폴링의 중복 post 방지
    mainHandler.post {
      if (blockOverlayView != null || !shieldActive) return@post
      val view = FocusBlockContentView.build(this) { returnToAppFromOverlay() }
      try {
        windowManager.addView(view, overlayLayoutParams())
        blockOverlayView = view
        blockOverlayVisible = true
      } catch (_: Exception) {
        // addView 거부(권한 회수 등) — 구식 경로(차단 액티비티)로 폴백. 권한이 실제로
        // 사라진 경우라면 다음 틱의 재검증(canEnforceShield)이 실드를 내린다.
        launchBlockActivityFallback()
      }
    }
  }

  private fun hideBlockOverlay() {
    mainHandler.post {
      val view = blockOverlayView ?: return@post
      blockOverlayView = null
      blockOverlayVisible = false
      try {
        windowManager.removeView(view)
      } catch (_: Exception) {
        // 이미 제거됐거나 창이 무효 — 종료 흐름을 막지 않는다.
      }
    }
  }

  private fun overlayLayoutParams(): WindowManager.LayoutParams {
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
    return WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      type,
      // 버튼 탭은 받되(터치 가능) 키 포커스는 뺏지 않는다 — 풀스크린이라 뒤 앱은 어차피 가려진다.
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.OPAQUE,
    )
  }

  // 오버레이의 'gromo로 돌아가기' — 우리 오버레이가 보이는 동안의 startActivity는 SAW 예외로
  // 허용된다(안드15 포함). 실행 후 오버레이를 내려 gromo 화면을 가리지 않게 한다.
  private fun returnToAppFromOverlay() {
    try {
      packageManager.getLaunchIntentForPackage(packageName)
        ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ?.let { startActivity(it) }
    } catch (_: Exception) {
      // 실행 거부 — 오버레이까지 내리면 차단이 풀리므로 유지한 채 둔다.
      return
    }
    hideBlockOverlay()
  }

  // 폴백: 차단 액티비티 실행(메인 스레드 전용) — 오버레이 addView가 거부된 경우만 시도한다.
  // 안드10~14에선 SYSTEM_ALERT_WINDOW 보유가 백그라운드 액티비티 시작의 예외 조건이라 동작할
  // 수 있다. 이마저 실패하면 실드를 내리고 전파한다(조용한 무한 재시도 금지 — 코드리뷰 반영).
  private fun launchBlockActivityFallback() {
    val now = SystemClock.elapsedRealtime()
    if (now - lastFallbackLaunchAt < BLOCK_RELAUNCH_DEBOUNCE_MS) return
    lastFallbackLaunchAt = now
    val intent = Intent(this, FocusBlockActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      startActivity(intent)
    } catch (_: Exception) {
      // 실행 제약 — 차단을 집행할 수단이 전무하다. 실드 없는 세션 정책(15초 룰)으로 강등.
      pollHandler.post { downgradeShield() }
    }
  }

  // 실드 강등(코드리뷰 반영, pollHandler 스레드 전용) — 집행 불능(권한 회수·차단 수단 전부
  // 실패) 시 실드 역할을 내리고 JS로 전파한다. 화면(FocusSessionScreen)이 이벤트를 받아
  // '실드 없는 세션'(15초 이탈 정책)으로 강등한다. 타이머 역할이 살아 있으면 서비스는 유지된다.
  private fun downgradeShield() {
    if (!shieldActive) return
    applyStop(ROLE_SHIELD)
    shieldLostListener?.invoke()
  }

  // 실드 집행 가능 여부 — 오버레이(차단 화면 표시)와 Usage Access(포그라운드 감지) 둘 다 필요.
  private fun canEnforceShield(): Boolean =
    Settings.canDrawOverlays(this) && ScreenTimeModule.isUsageAccessGranted(this)

  // ── 타이머 알림(§6) ──

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(CHANNEL_ID, "집중 세션", NotificationManager.IMPORTANCE_LOW)
    channel.description = "집중 세션의 경과 시간과 앱 잠금 상태를 보여줘요"
    channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    channel.setShowBadge(false)
    notificationManager.createNotificationChannel(channel)
  }

  private fun renotify() {
    lastNotifyAt = SystemClock.elapsedRealtime()
    notificationManager.notify(NOTIFICATION_ID, buildNotification())
  }

  // 상시 알림 — 타이머 역할이 켜져 있으면 chronometer(초가 실시간으로 올라가는 시스템 타이머,
  // 앱이 갱신하지 않아도 OS가 그린다 — iOS Live Activity의 timerInterval 대응)로 과목명·경과
  // 시간을 표시한다. 실드 전용(타이머 시작 전 잠깐)이면 정적 문구만.
  private fun buildNotification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
    }
    builder
      .setSmallIcon(R.drawable.ic_focus_notification)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setCategory(Notification.CATEGORY_STOPWATCH)
      .setColor(ACCENT_COLOR)
      .setDeleteIntent(renotifyPendingIntent())
    launchAppPendingIntent()?.let { builder.setContentIntent(it) }
    if (timerActive) {
      if (timerPausedAt > 0L) {
        // 일시정지 중(코드리뷰 반영) — 크로노미터는 세워 둘 수 없으므로 고정 경과 표시로
        // 대체한다. 재개 시 applyTimerPaused가 base를 재조정해 다시 크로노미터로 돌아온다.
        // 확장 과목 뷰(GROMO-997)도 크로노미터 기반이라 일시정지 중엔 표준 알림만 쓴다.
        val elapsedSeconds = ((timerPausedAt - timerStartedAt) / 1000L).coerceAtLeast(0L)
        builder
          .setContentTitle("$subjectName 집중을 잠깐 멈췄어요")
          .setContentText("지금까지 ${DateUtils.formatElapsedTime(elapsedSeconds)} 집중했어요")
          .setShowWhen(false)
      } else {
        builder
          .setContentTitle("$subjectName 집중 중이에요")
          .setWhen(timerStartedAt)
          .setShowWhen(true)
          .setUsesChronometer(true)
        if (shieldActive) builder.setContentText("허용한 앱 외에는 잠깐 잠겨 있어요")
        applyExpandedSubjectsView(builder)
      }
    } else {
      builder
        .setContentTitle("집중 세션을 지키고 있어요")
        .setContentText("허용한 앱 외에는 잠깐 잠겨 있어요")
    }
    return builder.build()
  }

  // 다른 과목 목록 확장 뷰(GROMO-997, §6) — iOS Live Activity의 otherSubjects 대응.
  // collapsed는 표준 템플릿의 chronometer를 그대로 유지하려고 setCustomBigContentView만 지정
  // (DecoratedCustomViewStyle이 앱 아이콘·이름 헤더를 표준대로 그린다). 확장 뷰의 경과 시간은
  // RemoteViews Chronometer로 동일하게 실시간이다. RemoteViews는 시스템 UI가 인플레이트하는
  // 제약이 있어 보장 뷰만 쓴 단순 레이아웃이고, 구성 실패는 삼켜 표준 알림으로 폴백한다.
  private fun applyExpandedSubjectsView(builder: Notification.Builder) {
    val subjects = otherSubjects
    if (subjects.isEmpty()) return
    try {
      val views = RemoteViews(packageName, R.layout.gromo_focus_notification_expanded)
      views.setTextViewText(R.id.gromo_focus_title, "$subjectName 집중 중이에요")
      // Chronometer base는 elapsedRealtime 기준 — 벽시계 시작 시각을 변환한다.
      val base = SystemClock.elapsedRealtime() - (System.currentTimeMillis() - timerStartedAt)
      views.setChronometer(R.id.gromo_focus_chronometer, base, null, true)
      views.setViewVisibility(R.id.gromo_focus_locked, if (shieldActive) View.VISIBLE else View.GONE)
      if (shieldActive) {
        views.setTextViewText(R.id.gromo_focus_locked, "허용한 앱 외에는 잠깐 잠겨 있어요")
      }
      val rowIds = intArrayOf(R.id.gromo_focus_row1, R.id.gromo_focus_row2)
      val dotIds = intArrayOf(R.id.gromo_focus_row1_dot, R.id.gromo_focus_row2_dot)
      val nameIds = intArrayOf(R.id.gromo_focus_row1_name, R.id.gromo_focus_row2_name)
      val timeIds = intArrayOf(R.id.gromo_focus_row1_time, R.id.gromo_focus_row2_time)
      for (i in rowIds.indices) {
        val subject = subjects.getOrNull(i)
        if (subject == null) {
          views.setViewVisibility(rowIds[i], View.GONE)
          continue
        }
        views.setViewVisibility(rowIds[i], View.VISIBLE)
        views.setTextViewText(dotIds[i], "●")
        views.setTextColor(dotIds[i], subject.color)
        views.setTextViewText(nameIds[i], subject.name)
        views.setTextViewText(timeIds[i], hmsString(subject.seconds))
      }
      builder
        .setStyle(Notification.DecoratedCustomViewStyle())
        .setCustomBigContentView(views)
    } catch (_: Exception) {
      // 커스텀 뷰 구성 실패 — 표준 알림 그대로(다른 과목 목록만 빠진다).
    }
  }

  // 잠금화면 타이머의 다른 과목 목록 파싱 — [{ name, seconds, color }] JSON(계약은
  // startFocusActivity 참고). 손상·형식 불일치는 빈 목록(표준 알림)으로 강등한다.
  private fun parseOtherSubjects(json: String?): List<OtherSubject> {
    if (json.isNullOrBlank()) return emptyList()
    return try {
      val array = JSONArray(json)
      (0 until minOf(array.length(), MAX_OTHER_SUBJECTS)).mapNotNull { i ->
        val item = array.optJSONObject(i) ?: return@mapNotNull null
        val name = item.optString("name")
        if (name.isEmpty()) return@mapNotNull null
        OtherSubject(name, item.optInt("seconds"), parseSubjectColor(item.optString("color")))
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  // "#RRGGBB" → 색상. 파싱 실패 시 앱 포인트색 — iOS Live Activity colorFromHex와 동일 폴백.
  private fun parseSubjectColor(hex: String): Int = try {
    Color.parseColor(hex)
  } catch (_: Exception) {
    ACCENT_COLOR
  }

  // 누적 시간 표기 — iOS Live Activity hmsString("%02d:%02d:%02d")과 동일.
  private fun hmsString(seconds: Int): String {
    val s = maxOf(0, seconds)
    return String.format(java.util.Locale.US, "%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
  }

  // 확장 알림 한 행 — 과목 색 점 + 이름 + 누적 초.
  private data class OtherSubject(val name: String, val seconds: Int, val color: Int)

  // 알림 탭 → gromo(세션 화면) 복귀.
  private fun launchAppPendingIntent(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    return PendingIntent.getActivity(
      this,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun renotifyPendingIntent(): PendingIntent {
    val intent = Intent(ACTION_RENOTIFY).setPackage(packageName)
    return PendingIntent.getBroadcast(
      this,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
