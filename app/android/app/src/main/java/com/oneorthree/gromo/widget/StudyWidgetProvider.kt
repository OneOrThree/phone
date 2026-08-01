package com.oneorthree.gromo.widget

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
  }

  companion object {
    const val PREFS_NAME = "gromo_study_widget"
    // [{"name","seconds","color"}] — iOS Live Activity의 otherSubjects와 같은 형태
    const val KEY_SUBJECTS_JSON = "top_subjects_json"
    // 스냅샷이 기록된 로컬 날짜(yyyy-MM-dd) — 오늘 여부 판정용
    const val KEY_DATE = "snapshot_date"

    // 모듈이 스냅샷 저장 직후 호출 — 배치된 모든 위젯 인스턴스를 즉시 다시 그린다.
    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, StudyWidgetProvider::class.java))
      for (id in ids) {
        manager.updateAppWidget(id, buildRemoteViews(context))
      }
    }

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
