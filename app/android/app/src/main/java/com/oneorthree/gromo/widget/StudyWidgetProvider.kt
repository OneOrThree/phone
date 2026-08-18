package com.oneorthree.gromo.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import com.oneorthree.gromo.MainActivity
import com.oneorthree.gromo.R
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import org.json.JSONArray

// 홈 화면 위젯(GROMO-1006) — 오늘 공부시간 상위 2과목 표시.
// iOS 잠금화면 위젯(930, Live Activity)의 안드로이드 대응. 데이터는 RN(FocusSessionScreen)이
// StudyWidgetModule을 통해 SharedPreferences에 저장한 스냅샷을 읽는다.
// 과목 누적시간은 로컬 자정에 리셋되므로, 스냅샷 날짜가 오늘이 아니면 빈 상태로 그린다.
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
      // 자정 경계 — 스냅샷 날짜가 어제가 됐으므로 다시 그리면 빈 상태로 돌아간다.
      // updateAll이 다음 자정 재예약까지 수행한다.
      updateAll(context)
    }
  }

  companion object {
    const val PREFS_NAME = "gromo_study_widget"
    // [{"name","seconds","color"}] — iOS Live Activity의 otherSubjects와 같은 형태
    const val KEY_SUBJECTS_JSON = "top_subjects_json"
    // 스냅샷이 기록된 로컬 날짜(yyyy-MM-dd) — 오늘 여부 판정용
    const val KEY_DATE = "snapshot_date"
    // 자정 경계 갱신용 자체 액션(코드리뷰 반영) — 1시간 주기 갱신은 자정에 정렬돼 있지 않고
    // OS가 지연시킬 수도 있어, 자정 전에 렌더된 RemoteViews가 새날에도 어제 과목을 계속 보여준다.
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

    // 다음 로컬 자정에 위젯 갱신 브로드캐스트를 예약한다.
    // SCHEDULE_EXACT_ALARM(플레이 민감 권한)은 쓰지 않는다 — inexact AlarmManager.set()이면 충분하고
    // 몇 분 지연은 수용한다(날짜 넘김 표시 보정 용도). RTC(비웨이크업)라 잠든 기기를 깨우지 않고,
    // 기기가 깨어날 때 밀린 알람이 전달돼 그때 갱신된다.
    // 같은 PendingIntent(요청코드 0)를 재사용하므로 여러 경로에서 겹쳐 예약해도 알람은 항상 1개.
    // 타임존·시간 변경(ACTION_TIMEZONE_CHANGED 등) 전용 리시버는 두지 않았다 — 1시간 주기
    // 갱신(onUpdate)이 매번 재예약하므로 늦어도 다음 주기에 새 자정 기준으로 보정된다(판단 기록).
    fun scheduleMidnightUpdate(context: Context) {
      val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val next = Calendar.getInstance().apply {
        add(Calendar.DAY_OF_YEAR, 1)
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        // 자정 직후 몇 초 여유 — 발화 시점의 로컬 날짜 판정이 확실히 새날이 되게
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

    // 로컬 날짜 문자열 — minSdk가 java.time 미보장 구간이라 SimpleDateFormat 사용
    fun localDateString(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    private data class SubjectEntry(val name: String, val seconds: Int, val color: String)

    private fun buildRemoteViews(context: Context): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_study)

      // 위젯 탭 → 앱 열기
      val launchIntent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      val pending = PendingIntent.getActivity(
        context,
        0,
        launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      views.setOnClickPendingIntent(R.id.widget_root, pending)

      val subjects = loadTodaySubjects(context)
      if (subjects.isEmpty()) {
        views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
        views.setViewVisibility(R.id.widget_rows, View.GONE)
      } else {
        views.setViewVisibility(R.id.widget_empty, View.GONE)
        views.setViewVisibility(R.id.widget_rows, View.VISIBLE)
        bindRow(views, subjects.getOrNull(0), R.id.widget_row1, R.id.widget_dot1, R.id.widget_name1, R.id.widget_time1)
        bindRow(views, subjects.getOrNull(1), R.id.widget_row2, R.id.widget_dot2, R.id.widget_name2, R.id.widget_time2)
      }
      return views
    }

    // 저장된 스냅샷 중 '오늘' 것만 읽는다. 없음·과거 날짜·파싱 실패·전부 0초면 빈 목록.
    // TS 래퍼가 이미 내림차순 상위 2개만 저장하지만, 방어적으로 여기서도 정렬·절단한다.
    private fun loadTodaySubjects(context: Context): List<SubjectEntry> {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val json = prefs.getString(KEY_SUBJECTS_JSON, null) ?: return emptyList()
      if (prefs.getString(KEY_DATE, null) != localDateString()) return emptyList()
      return try {
        val arr = JSONArray(json)
        (0 until arr.length())
          .mapNotNull { i ->
            val obj = arr.optJSONObject(i) ?: return@mapNotNull null
            val seconds = obj.optInt("seconds", 0)
            if (seconds <= 0) return@mapNotNull null
            SubjectEntry(obj.optString("name"), seconds, obj.optString("color"))
          }
          .sortedByDescending { it.seconds }
          .take(2)
      } catch (e: Exception) {
        emptyList()
      }
    }

    private fun bindRow(
      views: RemoteViews,
      entry: SubjectEntry?,
      rowId: Int,
      dotId: Int,
      nameId: Int,
      timeId: Int,
    ) {
      if (entry == null) {
        views.setViewVisibility(rowId, View.GONE)
        return
      }
      views.setViewVisibility(rowId, View.VISIBLE)
      views.setTextViewText(nameId, entry.name)
      views.setTextViewText(timeId, hms(entry.seconds))
      // 과목 대표색 점 — ImageView.setColorFilter(int)는 RemoteViews에서 호출 가능
      views.setInt(dotId, "setColorFilter", parseColor(entry.color))
    }

    // 초 → "00:00:00" — iOS 잠금화면 위젯(hmsString)과 같은 포맷
    private fun hms(seconds: Int): String {
      val s = maxOf(0, seconds)
      return String.format(Locale.US, "%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
    }

    // "#RRGGBB" → 색 (파싱 실패 시 앱 포인트색 인디고 — iOS colorFromHex 폴백과 동일)
    private fun parseColor(hex: String): Int =
      try {
        Color.parseColor(hex)
      } catch (e: Exception) {
        0xFF5E6AD2.toInt()
      }
  }
}
