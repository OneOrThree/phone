package com.oneorthree.gromo.screentime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

// 목표 초과 실시간 알림(GROMO-997, 03-스크린타임-구현 §7 'WorkManager 옵션') — 15분 주기
// (WorkManager 최소 간격)로 오늘 사용시간을 조회해 목표를 넘었으면 알림을 하루 1회 띄운다.
// 판정선은 어제 판정과 동일한 '목표 + 60초'(ScreenTimeGoals — 정확히 목표에서 멈춘 유저 보호).
//
// iOS엔 대응하는 유저 노출 알림이 없다 — 구 threshold 모니터(gromo.daily)도 내부 초과
// 플래그만 기록했고 그마저 GROMO-942로 폐지됐다. 안드로이드는 조회형이라 저비용으로 가능해
// 추가하는 개선이며, 문구는 앱 로컬 알림 톤(해요체·이모지 없음)을 따른다.
//
// 조용한 no-op 조건: 오늘 이미 알림 · 권한 없음 · 목표 미설정 · 판정선 미도달 · 알림 꺼짐.
// WorkManager 주기는 Doze·제조사 절전에 밀릴 수 있어 알림이 '초과 직후'가 아니라 '초과 후
// 다음 실행'에 뜬다 — 배터리 최적화 예외 안내(설정 화면)와 같이 가는 이유.
class GoalExceededCheckWorker(appContext: Context, params: WorkerParameters) :
  Worker(appContext, params) {
  companion object {
    private const val WORK_NAME = "gromoGoalExceededCheck"
    private const val CHANNEL_ID = "screen_time_goal"
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
    val usageMillis = ScreenTimeGoals.usageMillis(
      context,
      prefs,
      ScreenTimeGoals.startOfDayMillis(0),
      System.currentTimeMillis(),
    )
    if (!ScreenTimeGoals.isExceeded(usageMillis, goalSeconds)) return Result.success()
    val notificationManager =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // 알림이 꺼져 있으면 마킹 없이 스킵 — 같은 날 알림을 다시 켜면 다음 주기에 알린다.
    if (!notificationManager.areNotificationsEnabled()) return Result.success()
    // 채널만 꺼진 경우도 동일하게 마킹 없이 스킵(안드8+, 코드리뷰 반영) — 앱 알림이 켜져
    // 있어도 이 채널이 꺼져 있으면 notify가 조용히 무시되는데, 그날 '보냄'으로 기록하면
    // 채널을 다시 켜도 그날은 알림을 받을 수 없다.
    val channel = ensureChannel(notificationManager)
    if (channel != null && channel.importance == NotificationManager.IMPORTANCE_NONE) {
      return Result.success()
    }
    postNotification(context, notificationManager, goalSeconds)
    prefs.edit().putString(ScreenTimeModule.KEY_GOAL_EXCEEDED_NOTIFIED_DATE, today).apply()
    return Result.success()
  }

  // 채널 생성(멱등)·실제 상태 조회(안드8+) — createNotificationChannel은 유저가 바꾼 중요도를
  // 덮지 않으므로, 생성 후 다시 읽어야 '채널만 꺼짐(IMPORTANCE_NONE)'을 알 수 있다.
  // 안드8 미만은 채널 개념이 없어 null.
  private fun ensureChannel(notificationManager: NotificationManager): NotificationChannel? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    val channel =
      NotificationChannel(CHANNEL_ID, "사용시간 목표", NotificationManager.IMPORTANCE_DEFAULT)
    channel.description = "목표 사용시간을 넘으면 알려줘요"
    notificationManager.createNotificationChannel(channel)
    return notificationManager.getNotificationChannel(CHANNEL_ID)
  }

  private fun postNotification(
    context: Context,
    notificationManager: NotificationManager,
    goalSeconds: Int,
  ) {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // 채널은 doWork의 ensureChannel이 이미 생성·확인했다.
      Notification.Builder(context, CHANNEL_ID)
    } else {
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
