package com.oneorthree.gromo.screentime

import android.app.*
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.*
import android.provider.Settings
import android.widget.RemoteViews
import org.json.JSONObject
import java.util.concurrent.Executors

/** PR #686의 앱 감지·시스템 예외·오버레이를 2.0 서버 세션 수명에 연결한다. */
class FocusShieldService : Service() {
  companion object {
    const val ACTION_RESTORE = "com.oneorthree.focuscat.FOCUS_RESTORE"
    const val ACTION_SYNC = "com.oneorthree.focuscat.FOCUS_SYNC"
    const val EXTRA_STATE = "state"
    const val PREFS_NAME = "gromo_screen_time"
    private const val CHANNEL_ID = "gromo_focus_shield"
    private const val NOTIFICATION_ID = 4201
    fun clearNotification(context: Context) {
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIFICATION_ID)
    }
    private const val CHARACTER_MAX_PX = 192
    private const val ALPHA_THRESHOLD = 8
    @Volatile var instance: FocusShieldService? = null
      private set
  }
  private val handler = Handler(Looper.getMainLooper())
  private var overlay: ShieldOverlay? = null
  private var running = false
  private var phase = "focus"
  private var subject = "집중"
  private var color = "black"
  private var allowed = emptySet<String>()
  private var launchableCache: Set<String>? = null
  private var exemptCache: Set<String>? = null
  private var lastForeground: String? = null
  private var foregroundTracker = ForegroundAppTracker()
  private val foregroundWorker = Executors.newSingleThreadExecutor()
  private var lookupPending = false
  private var lookupFailures = 0
  private var wasLocked = false
  private var anchorElapsed = 0L
  private var expiresAt = 0L
  private var failures = 0
  @Volatile var blocking = false
    private set

  override fun onBind(intent: Intent?): IBinder? = null
  override fun onCreate() { super.onCreate(); instance = this }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val applied = runCatching {
      when (intent?.action) {
        ACTION_SYNC -> applySnapshot(intent.getStringExtra(EXTRA_STATE) ?: "{}")
        ACTION_RESTORE -> applyLatest()
        else -> false
      }
    }.getOrElse { stopShield(); false }
    FocusSessionState.resolve(intent?.getStringExtra("requestId"), applied)
    if (!running) stopSelf()
    return START_NOT_STICKY
  }
  fun restoreLatest() {
    handler.post { runCatching { applyLatest() }.onFailure { stopShield() } }
  }
  private fun applySnapshot(payload: String): Boolean {
    if (!FocusSessionState(this).accept(JSONObject(payload), false)) return false
    return applyLatest()
  }
  private fun applyLatest(): Boolean {
    val state = FocusSessionState(this).snapshot() ?: run { stopShield(); return false }
    phase = state.getString("phase")
    if (phase == "ended") { stopShield(); return true }
    val deadline = state.getLong("validUntilMs")
    val time = System.currentTimeMillis()
    if (!(phase == "focus" && deadline == 0L) && deadline <= time) { stopShield(); return false }
    subject = if (phase == "rest") "잠시 쉬는 중" else state.optString("subject", "집중")
    color = state.optString("catColor", "black").takeIf { it in setOf("black", "white", "gray", "cream", "ginger", "calico") } ?: "black"
    getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putString("catColor", color).apply()
    blocking = phase == "focus" && usageAccessGranted() && Settings.canDrawOverlays(this)
    if (!blocking) hideOverlay()
    anchorElapsed = SystemClock.elapsedRealtime() - (time - state.getLong("anchorMs")).coerceAtLeast(0)
    expiresAt = if (phase == "focus" && deadline == 0L) Long.MAX_VALUE
      else SystemClock.elapsedRealtime() + (deadline - time).coerceAtLeast(0L)
    failures = 0
    startForeground(NOTIFICATION_ID, buildNotification())
    if (!running) { running = true; handler.post(poll) }
    return phase != "focus" || blocking
  }
  private val poll = object : Runnable {
    override fun run() {
      if (!running) return
      if (SystemClock.elapsedRealtime() >= expiresAt) { stopShield(); return }
      try {
        tick()
      } catch (_: Exception) {
        if (++failures >= 5) {
          blocking = false
          hideOverlay()
          startForeground(NOTIFICATION_ID, buildNotification())
        }
      }
      if (running) handler.postDelayed(this, 1000L)
    }
  }
  private fun tick() {
    if (!blocking) return
    if (!usageAccessGranted() || !Settings.canDrawOverlays(this)) {
      blocking = false
      hideOverlay()
      startForeground(NOTIFICATION_ID, buildNotification())
      return
    }
    val power = getSystemService(POWER_SERVICE) as PowerManager
    val keyguard = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
    if (!power.isInteractive || keyguard.isKeyguardLocked) {
      hideOverlay()
      lastForeground = null
      wasLocked = true
      return
    }
    if (wasLocked) { foregroundTracker = ForegroundAppTracker(); wasLocked = false }
    allowed = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getStringSet("allowedPackages", emptySet())!!.toSet()
    refreshForegroundPackage()
    val front = lastForeground ?: return
    if (shouldBlock(front)) {
      val shield = overlay ?: ShieldOverlay(this).also { overlay = it }
      check(shield.show(subject)) { "OVERLAY_UNAVAILABLE" }
    } else hideOverlay()
    failures = 0
  }
  private fun hideOverlay() { overlay?.hide(); overlay = null }
  private fun stopShield() {
    running = false
    blocking = false
    handler.removeCallbacks(poll)
    hideOverlay()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }
  override fun onDestroy() { instance = null; stopShield(); foregroundWorker.shutdownNow(); super.onDestroy() }

  private fun refreshForegroundPackage() {
    if (lookupPending) return
    lookupPending = true
    val tracker = foregroundTracker
    // 복구 시 긴 이력은 메인 스레드를 막지 않고 한 번만 읽는다.
    foregroundWorker.execute {
      val result = runCatching {
        val manager = getSystemService(USAGE_STATS_SERVICE) as UsageStatsManager
        tracker.read(System.currentTimeMillis(), SystemClock.elapsedRealtime()) { from, until ->
          val events = checkNotNull(manager.queryEvents(from, until))
          val event = UsageEvents.Event()
          var latest: String? = null
          while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED) latest = event.packageName
          }
          latest
        }
      }
      handler.post {
        lookupPending = false
        if (!running || foregroundTracker !== tracker || wasLocked) return@post
        if (result.isSuccess) {
          lookupFailures = 0
          result.getOrNull()?.let { lastForeground = it }
        } else if (++lookupFailures >= 5) {
          blocking = false
          hideOverlay()
          startForeground(NOTIFICATION_ID, buildNotification())
        }
      }
    }
  }
  private fun usageAccessGranted(): Boolean {
    val appOps = getSystemService(APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), packageName)
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

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
    val out = HashSet<String>()
    runCatching {
      (getSystemService(TELECOM_SERVICE) as android.telecom.TelecomManager).defaultDialerPackage
    }.getOrNull()?.let { out.add(it) }
    // 알람 앱 — **처리 가능한 앱을 전부** 넣는다(코드리뷰 5차). resolveActivity 는 하나만
    // 돌려줘서, 시계 앱이 여러 개면 선택기가 잡히거나 사용자가 실제로 알람을 걸어 둔 다른
    // 앱이 빠진다. 그 앱의 전체 화면 알람은 그대로 덮여 끄지도 미루지도 못한다.
    out.addAll(handlerPackages(Intent(android.provider.AlarmClock.ACTION_SHOW_ALARMS)))
    // 홈 런처 — 홈 버튼이 **탈출 경로**다(코드리뷰 5차). 서드파티 런처는 설정·앱 서랍
    // Activity 를 MAIN/LAUNCHER 로도 노출해서 차단 목록에 들어오는데, 그러면 홈 화면까지
    // 덮여 기기를 못 쓰고 가림막에서 빠져나갈 길도 사라진다.
    out.addAll(handlerPackages(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)))
    // 권한 철회·알림 설정으로 들어가는 시스템 설정도 항상 열 수 있어야 한다.
    out.addAll(handlerPackages(Intent(Settings.ACTION_SETTINGS)))
    exemptCache = out
    return out
  }

  /** 이 인텐트를 처리할 수 있는 **모든** 패키지. 못 읽으면 빈 집합. */
  private fun handlerPackages(intent: Intent): Set<String> = runCatching {
    val resolved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.queryIntentActivities(
        intent,
        android.content.pm.PackageManager.ResolveInfoFlags.of(0L),
      )
    } else {
      @Suppress("DEPRECATION")
      packageManager.queryIntentActivities(intent, 0)
    }
    resolved.mapTo(HashSet()) { it.activityInfo.packageName }
  }.getOrDefault(emptySet())

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

  private fun buildNotification(): Notification {
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    val channel = NotificationChannel(CHANNEL_ID, "집중·휴식 상태", NotificationManager.IMPORTANCE_LOW)
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      data = Uri.parse("com.oneorthree.focuscat://activity")
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val pending = launch?.let { PendingIntent.getActivity(this, 4201, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    val caption = if (phase == "rest") "휴식 중이에요" else if (blocking) "허용 앱 외에는 차단 중이에요" else "앱 차단 권한을 확인해 주세요"
    val views = RemoteViews(packageName, R.layout.notification_focus).apply {
      setTextViewText(R.id.notif_subject, subject)
      setTextViewText(R.id.notif_caption, caption)
      setChronometerCountDown(R.id.notif_timer, false)
      setChronometer(R.id.notif_timer, anchorElapsed, null, true)
      val resource = resources.getIdentifier("cat_${color}_focus", "drawable", packageName)
      if (resource != 0) {
        val bitmap = android.graphics.BitmapFactory.decodeResource(resources, resource)
        if (bitmap != null) setImageViewBitmap(R.id.notif_character, downscale(trimTransparent(bitmap)))
      }
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID)
      else { @Suppress("DEPRECATION") Notification.Builder(this) }
    return builder.setSmallIcon(R.drawable.ic_focus_notification)
      .setContentTitle(subject).setContentText(caption).setOngoing(true).setOnlyAlertOnce(true)
      .setColor(Color.parseColor(FocusPalette.ACCENT)).setCategory(Notification.CATEGORY_STOPWATCH)
      .setVisibility(Notification.VISIBILITY_PUBLIC).setStyle(Notification.DecoratedCustomViewStyle())
      .setCustomContentView(views).also { builder -> pending?.let { builder.setContentIntent(it) } }.build()
  }

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

}
