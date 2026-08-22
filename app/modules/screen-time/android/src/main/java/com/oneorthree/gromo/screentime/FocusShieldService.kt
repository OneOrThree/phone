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
  /** 차단을 실제로 도는가. 타이머만 필요한 호출(ACTION_ACTIVITY)로는 켜지지 않는다. */
  private var blocking = false
  /** 다른 과목 누적 — 확장 알림에만 쓴다(iOS 잠금화면 칩과 같은 정보). */
  private var others: List<Other> = emptyList()
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
        others = parseOthers(intent.getStringExtra(EXTRA_OTHERS))
        if (startedAt == 0L) startedAt = System.currentTimeMillis()
        startForeground(NOTIFICATION_ID, buildNotification())
        return START_NOT_STICKY
      }
      else -> {
        subject = intent?.getStringExtra(EXTRA_SUBJECT) ?: "집중"
        allowed = intent?.getStringArrayExtra(EXTRA_ALLOWED)?.toSet() ?: emptySet()
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

    // 전면 앱을 못 읽는 상태 — 가림막을 **걷는다**(코드리뷰 반영). 그냥 return 하면 이미 떠
    // 있던 가림막이 그대로 남는데, 이후로도 전면 앱을 못 읽으니 우리 앱으로 돌아와도 안 걷힌다
    // (= 기기를 못 쓰게 만든다). 차단을 잠깐 놓치는 쪽이 훨씬 안전하다.
    val front = foregroundPackage()
    if (front == null) {
      hideOverlay()
      // 권한 자체가 사라진 경우는 일시적 공백이 아니라 확정 실패다. 폴링을 계속 돌려 봐야
      // 아무것도 못 하므로 차단 상태를 내린다 — 화면은 startFocusShield 결과와 이 표식으로
      // '이번 세션은 차단이 안 걸린다'를 알게 된다.
      if (!usageAccessGranted()) {
        blocking = false
        startForeground(NOTIFICATION_ID, buildNotification())
      }
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
    if (packageName == defaultDialerPackage()) return false
    return packageName in cachedLaunchablePackages()
  }

  /** 기본 전화 앱 패키지 — 못 읽으면 null(제외 대상 없음). */
  private fun defaultDialerPackage(): String? = runCatching {
    (getSystemService(TELECOM_SERVICE) as android.telecom.TelecomManager).defaultDialerPackage
  }.getOrNull()

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
   * 지금 앞에 있는 앱의 패키지명.
   *
   * `queryUsageStats`의 `lastTimeUsed` 최댓값을 쓰는 흔한 방법은 버킷 경계가 흔들려 방금 닫은
   * 앱을 앞 앱으로 잘못 짚는다. RESUMED 이벤트 중 **가장 최근 것**을 쓰면 전환 순서가 그대로 남는다.
   */
  private fun foregroundPackage(): String? {
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
    if (overlay?.isShowing == true) return
    val view = overlay ?: ShieldOverlay(this).also { overlay = it }
    view.show(subject)
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
      .setContentText("집중하는 중이에요!")
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
      character?.let { setImageViewBitmap(R.id.notif_character, it) }
      bindTimer(R.id.notif_timer)
    }

  /** 펼친 본문 — 위에 더해 다른 과목 칩 최대 2개. iOS 잠금화면 배너와 같은 정보량. */
  private fun expandedView(character: Bitmap?): RemoteViews =
    RemoteViews(packageName, R.layout.notification_focus_expanded).apply {
      setTextViewText(R.id.notif_subject, subject)
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
   */
  private fun RemoteViews.bindTimer(viewId: Int) {
    val base = SystemClock.elapsedRealtime() - (System.currentTimeMillis() - startedAt)
    setChronometer(viewId, base, null, true)
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
