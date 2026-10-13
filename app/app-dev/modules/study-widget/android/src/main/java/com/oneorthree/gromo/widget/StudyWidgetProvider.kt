package com.oneorthree.gromo.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

// 홈 화면 위젯 — 1.x(GROMO-1006) StudyWidgetProvider를 2.0으로 이식했다.
//
// ⚠️ 클래스 FQCN(com.oneorthree.gromo.widget.StudyWidgetProvider)을 바꾸지 말 것.
//    2.0은 같은 패키지로 1.x를 제자리 업데이트한다. 런처는 배치된 위젯을 이 컴포넌트 이름으로
//    기억하므로, 이름이 바뀌면 사용자가 이미 둔 위젯이 업데이트 직후 깨진다.
//
// 서버 홈 스냅샷의 계정·KST 날짜·총 집중시간을 사용한다.
// 이전 과목별 저장 키는 구 바이너리 호환을 위해 유지하지만 새 위젯은 home_snapshot_v2만 그린다.
// 계정 없음·날짜 만료는 미확인(—)으로 표시하며 다음 앱 동기화에서 갱신한다.
class StudyWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    for (id in appWidgetIds) {
      appWidgetManager.updateAppWidget(id, buildRemoteViews(context))
    }
    // 주기 갱신 때마다 자정 알람도 재예약 — 재부팅으로 알람이 비워져도 다음 주기에 복구된다
    scheduleMidnightUpdate(context)
  }

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    scheduleMidnightUpdate(context)
  }

  override fun onDisabled(context: Context) {
    super.onDisabled(context)
    // 마지막 위젯이 제거되면 자정 알람도 정리
    cancelMidnightUpdate(context)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action == ACTION_MIDNIGHT_UPDATE) {
      // KST 자정 경계 — 스냅샷 날짜가 어제가 됐으므로 다시 그리면 빈 상태로 돌아간다.
      updateAll(context)
    }
  }

  companion object {
    // 1.x와 같은 저장소·키(호환) — 바꾸면 업데이트 직후 위젯이 1.x 스냅샷을 못 읽는다
    const val PREFS_NAME = "gromo_study_widget"
    // [{"name","seconds","color"}] — 1.x·iOS Live Activity otherSubjects와 같은 형태
    const val KEY_SUBJECTS_JSON = "top_subjects_json"
    // 스냅샷의 KST 날짜(yyyy-MM-dd) — 오늘 여부 판정용. 1.x 는 기기 로컬 날짜를 같은 포맷으로 썼다
    // (한국 기기에서는 KST 와 같다) — 포맷이 같아 업데이트 직후 1.x 스냅샷도 그대로 비교된다.
    const val KEY_DATE = "snapshot_date"
    // 2.0 추가 — 오늘 총 집중(초). 서버 홈 스냅샷은 총합만 있고 과목별 기록이 없을 수 있다.
    const val KEY_TOTAL_SECONDS = "total_seconds"
    // 1.x와 같은 액션 문자열 — 업데이트 전에 예약된 자정 알람도 그대로 받는다
    const val ACTION_MIDNIGHT_UPDATE = "com.oneorthree.gromo.widget.ACTION_MIDNIGHT_UPDATE"

    // 모듈이 스냅샷 저장 직후 호출 — 배치된 모든 위젯 인스턴스를 즉시 다시 그린다.
    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, StudyWidgetProvider::class.java))
      if (ids.isEmpty()) return
      for (id in ids) {
        manager.updateAppWidget(id, buildRemoteViews(context))
      }
      // 데이터 쓰기 갱신 경로에서도 자정 알람을 재예약해 항상 살아 있게 유지
      scheduleMidnightUpdate(context)
    }

    // 다음 KST 자정에 위젯 갱신 브로드캐스트를 예약한다(오늘 판정과 같은 기준 — 1.x 는 로컬 자정).
    // 예약 시각은 절대 시각(epoch ms)이라, KST 달력으로 계산하면 기기 시간대와 무관하게 KST 자정이다.
    // SCHEDULE_EXACT_ALARM(플레이 민감 권한)은 쓰지 않는다 — inexact set()으로 몇 분 지연은 수용한다.
    // RTC(비웨이크업)라 잠든 기기를 깨우지 않고, 기기가 깨어날 때 밀린 알람이 전달된다.
    // 같은 PendingIntent(요청코드 0)를 재사용하므로 여러 경로에서 겹쳐 예약해도 알람은 항상 1개.
    fun scheduleMidnightUpdate(context: Context) {
      val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val next = Calendar.getInstance(KST).apply {
        add(Calendar.DAY_OF_YEAR, 1)
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        // 자정 직후 몇 초 여유 — 발화 시점의 KST 날짜 판정이 확실히 새날이 되게
        set(Calendar.SECOND, 5)
        set(Calendar.MILLISECOND, 0)
      }
      alarm.set(AlarmManager.RTC, next.timeInMillis, midnightPendingIntent(context))
    }

    fun cancelMidnightUpdate(context: Context) {
      val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      alarm.cancel(midnightPendingIntent(context))
    }

    private fun midnightPendingIntent(context: Context): PendingIntent =
      PendingIntent.getBroadcast(
        context,
        0,
        Intent(context, StudyWidgetProvider::class.java).apply { action = ACTION_MIDNIGHT_UPDATE },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    private val KST: TimeZone = TimeZone.getTimeZone("Asia/Seoul")
    private val DATE_PATTERN = Regex("\\d{4}-\\d{2}-\\d{2}")

    // KST 날짜 문자열 — 1.x와 같은 포맷(저장된 1.x 스냅샷 날짜와 비교 가능해야 한다).
    // SimpleDateFormat 은 스레드 안전하지 않으므로 호출마다 만든다.
    fun kstDateString(): String =
      SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = KST }.format(Date())

    // JS 가 넘긴 날짜가 스냅샷 날짜 포맷(yyyy-MM-dd)인지
    fun isDateString(value: String): Boolean = DATE_PATTERN.matches(value)

    private fun buildRemoteViews(context: Context): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_study)

      // 위젯 탭 → 앱 열기. 라이브러리 모듈이라 앱의 MainActivity를 직접 참조하지 않고
      // 런처 인텐트로 연다(1.x와 같은 동작 — 앱의 LAUNCHER 액티비티가 열린다).
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
        launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        launch.data = android.net.Uri.parse("com.oneorthree.focuscat://widget")
        val pending = PendingIntent.getActivity(
          context,
          0,
          launch,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        views.setOnClickPendingIntent(R.id.widget_root, pending)
      }

      val snapshot = runCatching {
        val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString("home_snapshot_v2", null)
        raw?.let { org.json.JSONObject(it) }
      }.getOrNull()
      val valid = snapshot != null && snapshot.optString("day") == kstDateString() && snapshot.optString("owner").isNotBlank()
      views.setViewVisibility(R.id.widget_rows, View.GONE)
      views.setViewVisibility(R.id.widget_empty, View.GONE)
      views.setViewVisibility(R.id.widget_total, View.VISIBLE)
      views.setTextViewText(R.id.widget_total, if (valid) hms(snapshot!!.optInt("totalSeconds", 0)) else "—")
      val color = snapshot?.optString("catColor")?.takeIf { it in setOf("black", "white", "cream", "ginger", "gray", "calico") } ?: "black"
      val pose = listOf("idle", "loaf", "reading", "tilt")[Calendar.getInstance(KST).get(Calendar.HOUR_OF_DAY) % 4]
      val drawable = context.resources.getIdentifier("cat_${color}_${pose}", "drawable", context.packageName)
      if (drawable != 0) views.setImageViewResource(R.id.widget_cat, drawable)
      return views
    }

    // 초 → "00:00:00" — iOS 잠금화면 위젯(hmsString)과 같은 포맷
    private fun hms(seconds: Int): String {
      val s = maxOf(0, seconds)
      return String.format(Locale.US, "%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
    }

  }
}
