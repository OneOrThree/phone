package com.oneorthree.gromo.screentime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.Calendar
import java.util.concurrent.TimeUnit

// 목표 초과 실시간 알림(GROMO-997, 03-스크린타임-구현 §7 'WorkManager 옵션') — 15분 주기
// (WorkManager 최소 간격)로 오늘 사용시간을 조회해 목표를 넘었으면 알림을 하루 1회 띄운다.
// 판정선은 어제 판정과 동일한 '목표 + 60초'(ScreenTimeGoals — 정확히 목표에서 멈춘 유저 보호).
//
// iOS엔 대응하는 유저 노출 알림이 없다 — 구 threshold 모니터(gromo.daily)도 내부 초과
// 플래그만 기록했고 그마저 GROMO-942로 폐지됐다. 안드로이드는 조회형이라 저비용으로 가능해
// 추가하는 개선이며, 문구는 앱 로컬 알림 톤(해요체·이모지 없음)을 따른다.
//
// 조용한 no-op 조건: 오늘 이미 알림 · 사용정보 권한 없음 · 목표 미설정 · 판정선 미도달 ·
// 알림 불가(인앱 '알림 받기' 옵트아웃 · OS 알림/채널 꺼짐 · 심야 방해 금지 시간대).
// 알림 가용성은 사용시간 조회(24h 이벤트 스캔) '전'에 확인해, 못 띄우는 상태면 스캔 없이
// 조기 리턴한다 — 알림 불가한데 매 15분 풀스캔하는 배터리 낭비를 없앤다(코드리뷰 반영).
// WorkManager 주기는 Doze·제조사 절전에 밀릴 수 있어 알림이 '초과 직후'가 아니라 '초과 후
// 다음 실행'에 뜬다 — 배터리 최적화 예외 안내(설정 화면)와 같이 가는 이유.
class GoalExceededCheckWorker(appContext: Context, params: WorkerParameters) :
  Worker(appContext, params) {
  companion object {
    private const val WORK_NAME = "gromoGoalExceededCheck"
    private const val CHANNEL_ID = "screen_time_goal"
    // 무음 채널(코드리뷰 반영) — 안드8+는 소리가 채널 속성이라 개별 알림에서 끌 수 없다. 인앱
    // '소리'를 끄면 IMPORTANCE_LOW(소리 없음, FocusSessionService와 동일 패턴) 채널로 게시한다.
    private const val CHANNEL_ID_SILENT = "screen_time_goal_silent"
    private const val NOTIFICATION_ID = 997

    // gromo 인디고(T.accent #5E6AD2) — FocusSessionService 알림과 동일한 강조색.
    private const val ACCENT_COLOR = 0xFF5E6AD2.toInt()

    // 주기 등록(멱등) — setGoalSeconds가 목표 저장 때마다 부른다. KEEP이라 이미 걸려 있으면
    // 그대로 두고(워커가 매 실행 prefs에서 최신 목표를 읽어 재등록이 필요 없다), WorkManager가
    // 재부팅 후에도 스스로 복원한다. 15분은 PeriodicWorkRequest의 플랫폼 최소 주기.
    fun ensureScheduled(context: Context) {
      val request =
        PeriodicWorkRequestBuilder<GoalExceededCheckWorker>(15, TimeUnit.MINUTES).build()
      WorkManager.getInstance(context)
        .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    // 목표 해제(0) 시 주기 취소 — 남겨둬도 목표 없음 no-op이지만 기기를 깨울 이유가 없다.
    // 이미 게시된 초과 알림도 함께 제거(코드리뷰 반영) — 로그아웃·계정 전환 teardown이 부르는
    // 경로라, 지우지 않으면 이전 계정의 알림이 로그인 화면·다음 계정에서도 셰이드에 남는다.
    fun cancel(context: Context) {
      WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
      val notificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      notificationManager.cancel(NOTIFICATION_ID)
    }
  }

  override fun doWork(): Result {
    val context = applicationContext
    val prefs = context.getSharedPreferences(ScreenTimeModule.PREFS_NAME, Context.MODE_PRIVATE)
    val today = ScreenTimeGoals.dateString(0)
    // 하루 1회 중복 방지 — 자정이 지나면 날짜가 달라져 자연히 다시 활성화된다.
    if (prefs.getString(ScreenTimeModule.KEY_GOAL_EXCEEDED_NOTIFIED_DATE, null) == today) {
      return Result.success()
    }
    if (!UsageAccess.isGranted(context)) return Result.success()
    val goalSeconds = ScreenTimeGoals.goalSecondsOn(prefs, today) ?: return Result.success()

    // ── 알림 가용성 게이트(코드리뷰 반영) — 사용시간 조회(usageMillis, 24h 이벤트 스캔) '전'에
    // 확인한다. 알림을 못 띄우는 상태면 스캔 없이 조기 리턴해 배터리 낭비를 없앤다(P2). 어느
    // 경우든 '오늘 보냄' 마킹을 남기지 않는다 — 상태가 풀리면(설정 재활성·심야 종료) 그날 안에
    // 다음 주기가 다시 알린다. 마킹하면 그날은 영영 못 받는다.
    val notificationManager =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // 인앱 '알림 받기' 옵트아웃(P1) — OS 알림은 켜져 있어도 유저가 앱 안에서 끈 경우.
    if (!prefs.getBoolean(ScreenTimeModule.KEY_NOTIF_ENABLED, true)) return Result.success()
    // OS 알림 꺼짐.
    if (!notificationManager.areNotificationsEnabled()) return Result.success()
    // 인앱 '소리(알림음)' 토글(P1) — 미설정 기본은 소리 켜짐. 안드8+는 소리가 채널 속성이라
    // 소리/무음 채널을 나눠 쓰므로, 아래 '채널 꺼짐' 검사도 실제로 게시할 채널을 대상으로 한다.
    val soundEnabled = prefs.getBoolean(ScreenTimeModule.KEY_NOTIF_SOUND_ENABLED, true)
    // 채널만 꺼진 경우(안드8+) — 앱 알림이 켜져 있어도 게시할 채널이 꺼져 있으면 notify가 조용히
    // 무시된다. 생성 후 다시 읽어 IMPORTANCE_NONE이면 스킵.
    val channel = ensureChannel(notificationManager, soundEnabled)
    if (channel != null && channel.importance == NotificationManager.IMPORTANCE_NONE) {
      return Result.success()
    }
    // 인앱 '심야 방해 금지' 시간대(P1) — '지금은 불가, 나중에 가능'이라 마킹 없이 스킵한다.
    if (isInQuietHours(prefs)) return Result.success()

    // 위 게이트를 모두 통과 — 이제서야 사용시간을 조회한다(위 배터리 게이트 주석 참고).
    val usageMillis = ScreenTimeGoals.usageMillis(
      context,
      prefs,
      ScreenTimeGoals.startOfDayMillis(0),
      System.currentTimeMillis(),
    )
    if (!ScreenTimeGoals.isExceeded(usageMillis, goalSeconds)) return Result.success()

    postNotification(context, notificationManager, goalSeconds, soundEnabled)
    prefs.edit().putString(ScreenTimeModule.KEY_GOAL_EXCEEDED_NOTIFIED_DATE, today).apply()
    return Result.success()
  }

  // 인앱 '심야 방해 금지' 시간대인지(코드리뷰 반영) — 자정 걸침(예: 22:00~08:00) 포함. quiet가
  // 꺼져 있거나('심야 방해 금지' off) 시각 문자열이 어긋나면 방해 금지 아님(false).
  private fun isInQuietHours(prefs: SharedPreferences): Boolean {
    if (!prefs.getBoolean(ScreenTimeModule.KEY_NOTIF_QUIET_ENABLED, false)) return false
    val start = parseMinutes(prefs.getString(ScreenTimeModule.KEY_NOTIF_QUIET_START, null))
      ?: return false
    val end = parseMinutes(prefs.getString(ScreenTimeModule.KEY_NOTIF_QUIET_END, null))
      ?: return false
    if (start == end) return false // 길이 0 구간 = 방해 금지 시간대 없음
    val calendar = Calendar.getInstance()
    val now = calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
    return if (start < end) {
      now >= start && now < end // 같은 날 안의 구간(예: 09:00~18:00)
    } else {
      now >= start || now < end // 자정 걸침(예: 22:00~08:00) — 시작 이후이거나 종료 이전
    }
  }

  // 'HH:mm' → 자정 기준 분(0..1439). 형식·범위가 어긋나면 null(방해 금지 판정을 건너뛴다).
  private fun parseMinutes(time: String?): Int? {
    if (time == null) return null
    val parts = time.split(":")
    if (parts.size != 2) return null
    val hour = parts[0].toIntOrNull() ?: return null
    val minute = parts[1].toIntOrNull() ?: return null
    if (hour !in 0..23 || minute !in 0..59) return null
    return hour * 60 + minute
  }

  // 채널 생성(멱등)·실제 상태 조회(안드8+) — createNotificationChannel은 유저가 바꾼 중요도를
  // 덮지 않으므로, 생성 후 다시 읽어야 '채널만 꺼짐(IMPORTANCE_NONE)'을 알 수 있다.
  // 인앱 '소리'에 따라 소리 채널(IMPORTANCE_DEFAULT)/무음 채널(IMPORTANCE_LOW)을 나눠 만들고,
  // 실제로 게시할 채널을 반환한다. 안드8 미만은 채널 개념이 없어 null.
  private fun ensureChannel(
    notificationManager: NotificationManager,
    soundEnabled: Boolean,
  ): NotificationChannel? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    val channelId = if (soundEnabled) CHANNEL_ID else CHANNEL_ID_SILENT
    val importance =
      if (soundEnabled) NotificationManager.IMPORTANCE_DEFAULT else NotificationManager.IMPORTANCE_LOW
    val name = if (soundEnabled) "사용시간 목표" else "사용시간 목표 (무음)"
    val channel = NotificationChannel(channelId, name, importance)
    channel.description = "목표 사용시간을 넘으면 알려줘요"
    notificationManager.createNotificationChannel(channel)
    return notificationManager.getNotificationChannel(channelId)
  }

  private fun postNotification(
    context: Context,
    notificationManager: NotificationManager,
    goalSeconds: Int,
    soundEnabled: Boolean,
  ) {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // 채널은 doWork의 ensureChannel이 이미 생성·확인했다. 인앱 '소리' 설정에 따라 소리/무음
      // 채널로 게시한다(안드8+는 소리가 채널 속성이라 개별 알림에서 못 끈다).
      Notification.Builder(context, if (soundEnabled) CHANNEL_ID else CHANNEL_ID_SILENT)
    } else {
      // 안드8 미만은 소리가 빌더 속성이지만 현재도 설정하지 않아 기본 무음이라, 인앱 '소리'
      // 설정과 무관하게 무음을 유지한다(기존 동작 보존 — 대상 사용자층이 사실상 없다).
      @Suppress("DEPRECATION")
      Notification.Builder(context).setPriority(Notification.PRIORITY_DEFAULT)
    }
    builder
      .setSmallIcon(R.drawable.ic_focus_notification)
      .setColor(ACCENT_COLOR)
      .setContentTitle("핸드폰 사용이 목표를 넘었어요")
      .setContentText("오늘 목표 ${goalLabel(goalSeconds)}을 넘게 사용했어요. 잠깐 쉬어 가요!")
      .setAutoCancel(true)
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
      builder.setContentIntent(
        PendingIntent.getActivity(
          context,
          0,
          launch,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        ),
      )
    }
    notificationManager.notify(NOTIFICATION_ID, builder.build())
  }

  // 목표 라벨 — '3시간'·'2시간 30분'·'50분'. '시간'·'분' 모두 받침이 있어 조사 '을' 고정이 성립.
  private fun goalLabel(goalSeconds: Int): String {
    val minutes = goalSeconds / 60
    val hours = minutes / 60
    val remainder = minutes % 60
    return when {
      hours > 0 && remainder > 0 -> "${hours}시간 ${remainder}분"
      hours > 0 -> "${hours}시간"
      else -> "${remainder}분"
    }
  }
}
