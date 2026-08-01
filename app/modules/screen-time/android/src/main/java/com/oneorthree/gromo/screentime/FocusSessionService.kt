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
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Telephony
import android.telecom.TelecomManager

// 집중 세션 포그라운드 서비스(GROMO-996, 03-스크린타임-구현 §5·§6) — 두 역할을 겸한다:
//  1. 실드(ROLE_SHIELD): 1~2초 간격 queryEvents 폴링으로 현재 포그라운드 앱을 감지해,
//     허용앱 외 앱이면 차단 화면(FocusBlockActivity)을 최상단에 띄운다. 안드로이드엔
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

    private const val CHANNEL_ID = "focus_session"
    private const val NOTIFICATION_ID = 996

    // 알림 스와이프 삭제(안드14+) 시 재게시를 트리거하는 브로드캐스트 액션.
    private const val ACTION_RENOTIFY = "com.oneorthree.gromo.screentime.FOCUS_RENOTIFY"

    private const val EXTRA_ROLE = "role"
    private const val EXTRA_SUBJECT = "subjectName"
    private const val ROLE_SHIELD = "shield"
    private const val ROLE_TIMER = "timer"

    // 실드 폴링 간격 — §5 수용 한계(차단까지 1~2초 지연)가 이 값에서 나온다.
    private const val SHIELD_POLL_INTERVAL_MS = 1_500L
    // 타이머 전용일 때의 틱 간격 — 차단 감지가 없어 알림 재게시만 하면 된다.
    private const val TIMER_TICK_INTERVAL_MS = 30_000L
    // 알림 주기 재게시 간격(안드14+ 스와이프 완화의 보조 수단).
    private const val RENOTIFY_INTERVAL_MS = 30_000L
    // 차단 화면 연속 실행 방지 — 실행 직후 전환 애니메이션 중 중복 실행을 막는다.
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
      dispatchStart(context, ROLE_SHIELD, subjectName)

    // 타이머 켜기 — 실드와 독립(실드 없는 세션도 타이머는 뜬다).
    fun startTimer(context: Context, subjectName: String): Boolean =
      dispatchStart(context, ROLE_TIMER, subjectName)

    // 역할 끄기 — 서비스가 없으면 no-op(멱등 — 고아 세션 정리 등 어디서 불려도 안전).
    fun stopShield() = instance?.postStop(ROLE_SHIELD) ?: Unit

    fun stopTimer() = instance?.postStop(ROLE_TIMER) ?: Unit

    // 실드 동작 여부 — 차단 화면이 자기 생존 판단(onResume)에, 모듈이 타이머 시작 판단에 쓴다.
    fun isShieldActive(): Boolean = instance?.shieldActive == true

    private fun dispatchStart(context: Context, role: String, subjectName: String): Boolean {
      val running = instance
      if (running != null) {
        running.postStart(role, subjectName)
        return true
      }
      val intent = Intent(context, FocusSessionService::class.java)
        .putExtra(EXTRA_ROLE, role)
        .putExtra(EXTRA_SUBJECT, subjectName)
      return try {
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

  @Volatile private var lastNotifyAt = 0L

  private lateinit var pollThread: HandlerThread
  private lateinit var pollHandler: Handler

  // 폴링 상태(pollHandler 스레드 전용) — 마지막으로 처리한 이벤트 시각과 현재 포그라운드 앱.
  private var lastEventTs = 0L
  private var currentForeground: String? = null
  private var lastBlockLaunchAt = 0L

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
      if (shieldActive) pollAndBlock()
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
    val role = intent?.getStringExtra(EXTRA_ROLE)
    val subject = intent?.getStringExtra(EXTRA_SUBJECT)
    if (role != null && subject != null) postStart(role, subject)
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
    try {
      unregisterReceiver(renotifyReceiver)
    } catch (_: Exception) {
      // 이미 해제됐거나 등록 실패 — 종료 흐름을 막지 않는다.
    }
    pollThread.quitSafely()
    super.onDestroy()
  }

  private fun postStart(role: String, subject: String) {
    pollHandler.post { applyStart(role, subject) }
  }

  fun postStop(role: String) {
    pollHandler.post { applyStop(role) }
  }

  private fun applyStart(role: String, subject: String) {
    subjectName = subject
    when (role) {
      ROLE_SHIELD -> {
        shieldActive = true
        lastBlockLaunchAt = 0L
        // 세션 시작 시점의 포그라운드는 gromo 자신 — 과거 이벤트로 남의 앱을 차단하지 않게
        // 폴링 커서를 지금으로 리셋한다.
        lastEventTs = System.currentTimeMillis()
        currentForeground = null
      }
      ROLE_TIMER -> {
        timerActive = true
        timerStartedAt = System.currentTimeMillis()
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
      }
      ROLE_TIMER -> timerActive = false
    }
    if (!shieldActive && !timerActive) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } else {
        @Suppress("DEPRECATION")
        stopForeground(true)
      }
      stopSelf()
    } else {
      renotify()
      restartTick()
    }
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

    val foreground = currentForeground ?: return
    if (foreground == packageName) return
    // 이벤트 결측 대비 이중 확인 — 화면이 꺼져 있으면 차단할 것도 없다.
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    if (!powerManager.isInteractive) return
    if (isAllowed(foreground)) return
    if (now - lastBlockLaunchAt < BLOCK_RELAUNCH_DEBOUNCE_MS) return
    lastBlockLaunchAt = now
    launchBlockActivity()
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

  // 차단 화면 실행 — 서비스(백그라운드)에서의 액티비티 시작은 안드10+에서 제한되지만,
  // SYSTEM_ALERT_WINDOW(오버레이) 권한 보유가 예외 조건이라 가능하다. 모듈이 실드 시작 전에
  // 오버레이 권한을 확인하므로 여기 도달하면 보통 성공한다 — 세션 중 권한을 끈 경우만 실패.
  private fun launchBlockActivity() {
    val intent = Intent(this, FocusBlockActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      startActivity(intent)
    } catch (_: Exception) {
      // 실행 제약에 걸리면 차단은 포기 — 다음 폴링에서 재시도한다(크래시 없는 강등).
    }
  }

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
      builder
        .setContentTitle("$subjectName 집중 중이에요")
        .setWhen(timerStartedAt)
        .setShowWhen(true)
        .setUsesChronometer(true)
      if (shieldActive) builder.setContentText("허용한 앱 외에는 잠깐 잠겨 있어요")
    } else {
      builder
        .setContentTitle("집중 세션을 지키고 있어요")
        .setContentText("허용한 앱 외에는 잠깐 잠겨 있어요")
    }
    return builder.build()
  }

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
