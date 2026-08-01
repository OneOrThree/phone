package com.oneorthree.gromo.screentime

import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

// 사용시간 목표의 날짜별 스냅샷 + 초과 판정(GROMO-997, 03-스크린타임-구현 §7).
// 어제 판정(getYesterdayResult)과 목표 초과 체크 워커(GoalExceededCheckWorker)가 함께 쓴다.
//
// 스냅샷: setGoalSeconds가 목표를 저장할 때마다 '오늘' 날짜 항목으로 함께 기록한다. 판정은
// 대상 날짜 이하의 가장 최근 항목("그날 등록돼 있던 목표")을 쓴다 — 목표를 매일 바꾸지 않아도
// 최근 항목이 이월되어 유효하고, 오늘 목표를 바꿔도 어제는 어제 기준으로 본다. iOS도 등록
// 시점 값 기준이었으므로 동작이 일치한다(§7).
//
// 관용 규칙: 달성 = 목표 '이내'(<=, 서버 분 단위 판정과 동일). 초과 판정선을 목표값 그대로
// 잡으면 정확히 목표에서 멈춘 유저까지 fail로 판정되므로, '목표 + 60초'를 판정선으로 해
// 분 단위 기준 '목표를 넘긴' 경우에만 fail이 되게 한다 — iOS threshold 등록식
// `Int(goalSecondsValue) + 60`(GROMO-633 리뷰)을 그대로 옮긴 규칙.
internal object ScreenTimeGoals {
  // 초과 판정 관용(초) — 위 주석의 iOS 규칙과 동일.
  const val EXCEED_TOLERANCE_SECONDS = 60

  // 스냅샷 보관 상한(항목 수) — 판정 대상은 어제까지라 최근 항목 몇 개면 충분하다.
  // 최근 순으로 남기므로 '가장 최근 항목의 이월'은 잘라도 깨지지 않는다.
  private const val MAX_SNAPSHOT_ENTRIES = 30

  // 로컬 'YYYY-MM-DD'. offsetDays: 0=오늘, -1=어제. (문자열 비교가 곧 날짜 비교가 되는 형식.)
  fun dateString(offsetDays: Int): String {
    val calendar = Calendar.getInstance()
    calendar.add(Calendar.DAY_OF_YEAR, offsetDays)
    return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(calendar.time)
  }

  // 로컬 자정 기준 하루 시작 시각(ms). offsetDays: 0=오늘, -1=어제. DST 보정은 Calendar가 처리.
  fun startOfDayMillis(offsetDays: Int): Long {
    val calendar = Calendar.getInstance()
    calendar.add(Calendar.DAY_OF_YEAR, offsetDays)
    calendar.set(Calendar.HOUR_OF_DAY, 0)
    calendar.set(Calendar.MINUTE, 0)
    calendar.set(Calendar.SECOND, 0)
    calendar.set(Calendar.MILLISECOND, 0)
    return calendar.timeInMillis
  }

  // 목표 저장 — 현재값(KEY_GOAL_SECONDS)과 오늘 날짜 스냅샷을 함께 기록한다.
  // 같은 날 여러 번 바꾸면 마지막 값이 그날의 목표(iOS도 등록 교체 시 동일).
  fun recordSnapshot(prefs: SharedPreferences, seconds: Int) {
    val snapshots = readSnapshots(prefs)
    snapshots[dateString(0)] = seconds
    val json = JSONObject()
    snapshots.entries
      .sortedByDescending { it.key }
      .take(MAX_SNAPSHOT_ENTRIES)
      .forEach { json.put(it.key, it.value) }
    prefs.edit()
      .putInt(ScreenTimeModule.KEY_GOAL_SECONDS, seconds)
      .putString(ScreenTimeModule.KEY_GOAL_SECONDS_BY_DATE, json.toString())
      .apply()
  }

  // 대상 날짜에 유효했던 목표(초) — 날짜 이하 가장 최근 스냅샷.
  // 스냅샷이 없거나(구 바이너리 시절·판정 대상일 이전에 목표 등록 이력 없음) 값이 0 이하
  // (목표 해제)면 null = 판정 불가 — iOS의 '어제 결과 없음(nil)'과 같은 취급.
  fun goalSecondsOn(prefs: SharedPreferences, date: String): Int? =
    readSnapshots(prefs).entries
      .filter { it.key <= date }
      .maxByOrNull { it.key }
      ?.value
      ?.takeIf { it > 0 }

  // 초과 여부 — 사용시간이 '목표 + 관용(60초)' 판정선에 도달(>=)했는가.
  fun isExceeded(usageMillis: Long, goalSeconds: Int): Boolean =
    usageMillis >= (goalSeconds + EXCEED_TOLERANCE_SECONDS) * 1_000L

  // [begin, end) 구간 사용시간(ms) — 활성 측정 대상(selection) 필터로 M1과 동일한 세션 재구성
  // 계산(UsageSessionCalculator). 권한 확인은 호출부 책임.
  fun usageMillis(context: Context, prefs: SharedPreferences, begin: Long, end: Long): Long {
    val usageStatsManager =
      context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val selection = prefs.getStringSet(ScreenTimeModule.KEY_SELECTION_PACKAGES, null)
    return UsageSessionCalculator.foregroundMillis(usageStatsManager, selection, begin, end)
  }

  private fun readSnapshots(prefs: SharedPreferences): MutableMap<String, Int> {
    val raw = prefs.getString(ScreenTimeModule.KEY_GOAL_SECONDS_BY_DATE, null)
      ?: return mutableMapOf()
    return try {
      val json = JSONObject(raw)
      val map = mutableMapOf<String, Int>()
      json.keys().forEach { key -> map[key] = json.getInt(key) }
      map
    } catch (_: Exception) {
      mutableMapOf() // 손상 기록 — 버리고 새로 쌓는다(판정은 그동안 null = 판정 불가)
    }
  }
}
