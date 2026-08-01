package com.oneorthree.gromo.screentime

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager

// queryEvents 원본 이벤트 스트림을 페어링해 포그라운드 사용시간을 재구성한다(03-스크린타임-구현 §3).
// queryUsageStats(INTERVAL_DAILY)는 버킷 경계가 기기 사정(재부팅 등)에 흔들려 부정확하므로
// 보존기간 초과 소급 폴백으로만 쓴다.
//
// 엣지 처리 5종(§3 표):
//  1. 화면 꺼짐  — SCREEN_NON_INTERACTIVE에서 열린 구간 전부 마감(안 하면 잠든 밤새 카운트).
//  2. 자정 걸친 구간 — 조회 구간 앞에 LOOKBACK 여유를 두고 이벤트를 읽되, 누적은 [begin, end)로
//     클리핑해 날짜별로 쪼갠다(전날 밤에 RESUMED된 채 이어지는 사용도 오늘분만 계산).
//  3. 스플릿 스크린 — 두 앱이 동시에 RESUMED면 각자 구간을 독립 누적하는 '합산' 정의를 쓴다
//     (iOS 스크린타임 앱과 같은 계열 — 동시 사용 구간은 앱 수만큼 계산됨).
//  4. 이벤트 보존기간 — 원본 이벤트는 수일 수준만 보관(기기별 상이). 구간에 이벤트가 하나도
//     없으면 queryUsageStats(INTERVAL_DAILY) 근사 폴백으로 대체한다.
//  5. 재부팅 — DEVICE_SHUTDOWN에서 열린 구간을 마감한다. 재부팅 결측(이벤트 공백)으로 값이
//     줄어드는 케이스는 JS 쪽 '기존값 유지' 로직(max(보존값, 마지막 동기화값))에 맡긴다.
internal object UsageSessionCalculator {

  // 자정 걸친 구간 소급용 조회 여유 — 구간 시작 전에 RESUMED된 채 이어지는 사용을 잡는다.
  // 12시간이면 단일 앱을 이벤트 없이 연속 사용하는 현실적 최대치를 넉넉히 덮는다.
  private const val LOOKBACK_MS = 12L * 60 * 60 * 1000

  // [begin, end) 구간의 포그라운드 사용시간(ms) 합계.
  // selection이 null/빈 집합이면 전체 앱을 측정한다(M2 피커 전 기본 — §8 selection 키 구조).
  fun foregroundMillis(
    usageStatsManager: UsageStatsManager,
    selection: Set<String>?,
    begin: Long,
    end: Long,
  ): Long {
    if (end <= begin) return 0L
    val events = usageStatsManager.queryEvents(begin - LOOKBACK_MS, end)

    // 열린 구간은 '패키지/액티비티' 단위로 추적한다 — 패키지 단위 맵은 같은 앱의 화면 전환
    // (A PAUSED → B RESUMED → A STOPPED)에서 A의 STOPPED가 B의 열린 구간을 닫아버려
    // 이후 사용분을 잃는다. 같은 앱의 액티비티 전환은 PAUSED 후 RESUMED라 이중 계산도 없다.
    val openedAt = HashMap<String, Long>() // "패키지/클래스" → RESUMED 시각
    var totalMs = 0L
    var sawEventInRange = false
    val event = UsageEvents.Event()

    // 구간 마감 — [begin, end)와 겹치는 부분만 누적(자정 걸친 구간의 날짜별 분할이 여기서 끝난다).
    fun close(key: String, at: Long) {
      val started = openedAt.remove(key) ?: return
      val overlap = minOf(at, end) - maxOf(started, begin)
      if (overlap > 0) totalMs += overlap
    }

    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      if (event.timeStamp in begin until end) sawEventInRange = true
      when (event.eventType) {
        // ACTIVITY_RESUMED(=구 MOVE_TO_FOREGROUND, 값 1) — API 29 미만 기기의 구 이벤트도 같은 값.
        UsageEvents.Event.ACTIVITY_RESUMED -> {
          val pkg = event.packageName ?: continue
          if (!selection.isNullOrEmpty() && pkg !in selection) continue
          // 덮어쓰기 — 닫힘 이벤트 결측 후 재-RESUMED된 경우 과대 계상보다 보수적 계산을 택한다.
          openedAt["$pkg/${event.className}"] = event.timeStamp
        }
        // ACTIVITY_PAUSED(=구 MOVE_TO_BACKGROUND, 값 2) 뒤에 ACTIVITY_STOPPED(23)가 이어져도
        // remove 기반이라 두 번째는 자연히 무시된다.
        UsageEvents.Event.ACTIVITY_PAUSED,
        UsageEvents.Event.ACTIVITY_STOPPED,
        -> close("${event.packageName}/${event.className}", event.timeStamp)
        // 화면 꺼짐·기기 종료 — 열린 구간 전부 마감(엣지 1·5).
        UsageEvents.Event.SCREEN_NON_INTERACTIVE,
        UsageEvents.Event.DEVICE_SHUTDOWN,
        -> {
          val at = event.timeStamp
          openedAt.keys.toList().forEach { close(it, at) }
        }
      }
    }
    // 아직 열려 있는 구간(지금 쓰는 중)은 end 시각으로 마감(§3 의사코드).
    openedAt.keys.toList().forEach { close(it, end) }

    // 엣지 4 — 구간 안에 이벤트가 아예 없으면 보존기간을 벗어난 소급 조회로 보고 근사 폴백.
    // (기기를 안 써서 이벤트가 없는 날도 폴백을 타지만 그 경우 폴백도 0이라 결과는 같다.)
    if (!sawEventInRange && totalMs == 0L) {
      return dailyStatsFallbackMillis(usageStatsManager, selection, begin, end)
    }
    return totalMs
  }

  // queryUsageStats(INTERVAL_DAILY) 근사 폴백 — 대상 구간과 겹치는 일 버킷의 앱별
  // totalTimeInForeground 합계. 버킷 경계가 흔들릴 수 있어 '근사'로만 쓴다(§3).
  private fun dailyStatsFallbackMillis(
    usageStatsManager: UsageStatsManager,
    selection: Set<String>?,
    begin: Long,
    end: Long,
  ): Long {
    val stats = usageStatsManager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, begin, end - 1)
      ?: return 0L
    var totalMs = 0L
    for (stat in stats) {
      if (!selection.isNullOrEmpty() && stat.packageName !in selection) continue
      // 구간과 겹치지 않는 버킷(경계 흔들림으로 딸려온 이웃 날짜) 제외.
      if (stat.lastTimeStamp <= begin || stat.firstTimeStamp >= end) continue
      totalMs += stat.totalTimeInForeground
    }
    return totalMs
  }
}
