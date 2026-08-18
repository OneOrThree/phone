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
//  3. 스플릿 스크린 — 서로 다른 앱이 동시에 RESUMED면 각자 구간을 독립 누적하는 '합산' 정의를
//     쓴다(iOS 스크린타임 앱과 같은 계열 — 동시 사용 구간은 앱 수만큼 계산됨). 단 같은 앱의
//     다중 액티비티(멀티 인스턴스·PIP)가 겹치는 구간은 패키지별 union으로 한 번만 센다(코드리뷰 반영).
//  4. 이벤트 보존기간 — 원본 이벤트는 수일 수준만 보관(기기별 상이). 구간에 앱 라이프사이클
//     이벤트가 하나도 없으면 queryUsageStats(INTERVAL_DAILY) 근사 폴백으로 대체한다.
//  5. 재부팅 — DEVICE_SHUTDOWN에서 열린 구간을 마감한다. 재부팅 결측(이벤트 공백)으로 값이
//     줄어드는 케이스는 JS 쪽 '기존값 유지' 로직(max(보존값, 마지막 동기화값))에 맡긴다.
//
// 수용 한계: LOOKBACK(24h)보다 먼저 시작해 조회 구간 끝까지 이벤트를 하나도 안 남긴 세션
// (24시간 이상 화면 꺼짐·앱 전환 없이 연속 포그라운드)은 신호가 전혀 없어 재구성에서 빠진다.
// 현실적으론 화면 꺼짐(SCREEN_NON_INTERACTIVE)이 그 전에 끼어 거의 발생하지 않는다. 대안
// (재구성값을 항상 근사 폴백과 max 비교)은 INTERVAL_DAILY 버킷 경계 흔들림으로 과대 집계
// (리그 랭킹에서 유저에게 유리) 위험이 있어 채택하지 않았다(코드리뷰 반영).
internal object UsageSessionCalculator {

  // 자정 걸친 구간 소급용 조회 여유 — 구간 시작 전에 RESUMED된 채 이어지는 사용을 잡는다.
  // 24시간이면 구간 시작 전 하루 전체를 덮어, 종료 이벤트조차 없이 계속 열려 있는 장시간
  // 세션(스플릿 스크린 한쪽 등)의 시작 RESUMED도 놓치지 않는다(코드리뷰 반영. 이벤트
  // 보존기간은 수일 수준이라 24시간 소급은 안전).
  private const val LOOKBACK_MS = 24L * 60 * 60 * 1000

  /**
   * 재구성 결과 — 패키지별 사용시간(ms)과, 그 값을 얼마나 믿을 수 있는지 판단할 두 신호.
   *
   * 합계(`foregroundMillis`)와 앱별 내역(`foregroundMillisByPackage`)이 **같은 스캔·같은 union
   * 병합**을 쓰게 하려고 결과를 이 형태로 돌린다. 두 경로가 각자 병합을 구현하면 "합계는
   * 1시간인데 앱별을 더하면 55분" 같은 어긋남이 생긴다.
   */
  private class ScanResult(
    val byPackage: Map<String, Long>,
    val sawLifecycleEventInRange: Boolean,
    val sawUnmatchedTerminalInRange: Boolean,
  )

  // [begin, end) 구간의 포그라운드 사용시간(ms) 합계.
  // selection이 null/빈 집합이면 전체 앱을 측정한다(§8 selection 키 구조).
  fun foregroundMillis(
    usageStatsManager: UsageStatsManager,
    selection: Set<String>?,
    begin: Long,
    end: Long,
  ): Long {
    if (end <= begin) return 0L
    val scan = scan(usageStatsManager, selection, begin, end)
    val totalMs = scan.byPackage.values.sum()

    // 미매칭 종료를 본 구간 — 재구성 합계는 부분합(잃은 세션 존재 확정)이므로 근사 폴백과
    // 비교해 큰 쪽을 쓴다. 폴백은 버킷 경계 흔들림으로 오히려 적게 나올 수도 있어 max가 안전.
    if (scan.sawUnmatchedTerminalInRange) {
      return maxOf(totalMs, dailyStatsFallbackMillis(usageStatsManager, selection, begin, end))
    }
    // 엣지 4 — 구간 안에 앱 라이프사이클 이벤트가 아예 없으면 재구성 불가(보존기간 초과
    // 소급 조회·구간 전에 시작된 장시간 세션)로 보고 근사 폴백.
    // (기기를 안 써서 이벤트가 없는 날도 폴백을 타지만 그 경우 폴백도 0이라 결과는 같다.)
    if (!scan.sawLifecycleEventInRange && totalMs == 0L) {
      return dailyStatsFallbackMillis(usageStatsManager, selection, begin, end)
    }
    return totalMs
  }

  /**
   * [begin, end) 구간의 **앱별** 포그라운드 사용시간(ms). 사용이 0인 앱은 담기지 않는다.
   *
   * 합계와의 관계: 폴백을 타지 않는 정상 경로에서는 이 맵의 합 == [foregroundMillis].
   * 폴백 경로(보존기간 초과·미매칭 종료)에서는 근사값이라 합이 정확히 일치하지 않을 수 있다 —
   * 화면은 합계를 [foregroundMillis]로 따로 받아 쓰고, 이 맵은 **비중 표시용**으로 본다.
   */
  fun foregroundMillisByPackage(
    usageStatsManager: UsageStatsManager,
    selection: Set<String>?,
    begin: Long,
    end: Long,
  ): Map<String, Long> {
    if (end <= begin) return emptyMap()
    val scan = scan(usageStatsManager, selection, begin, end)
    // 합계 쪽과 같은 판정 — 재구성이 불완전하면 앱별도 근사 폴백으로 대체한다. 여기서 폴백을
    // 안 쓰면 "총 사용시간은 2시간인데 앱별 목록은 텅 빔"이 된다.
    if (scan.byPackage.isEmpty() && !scan.sawLifecycleEventInRange) {
      return dailyStatsFallbackByPackage(usageStatsManager, selection, begin, end)
    }
    return scan.byPackage
  }

  private fun scan(
    usageStatsManager: UsageStatsManager,
    selection: Set<String>?,
    begin: Long,
    end: Long,
  ): ScanResult {
    val events = usageStatsManager.queryEvents(begin - LOOKBACK_MS, end)

    // 열린 구간은 '패키지/액티비티' 단위로 추적한다 — 패키지 단위 맵은 같은 앱의 화면 전환
    // (A PAUSED → B RESUMED → A STOPPED)에서 A의 STOPPED가 B의 열린 구간을 닫아버려
    // 이후 사용분을 잃는다. 같은 앱의 액티비티 전환은 PAUSED 후 RESUMED라 이중 계산도 없다.
    val openedAt = HashMap<String, Long>() // "패키지/클래스" → RESUMED 시각
    // 이번 스캔에서 한 번이라도 RESUMED를 본 키 — 미매칭 종료(아래) 판별용. close 뒤에 오는
    // STOPPED(정상 시퀀스)를 '시작을 못 본 세션'과 구분한다.
    val everOpened = HashSet<String>()
    // 마감된 구간은 바로 합산하지 않고 패키지별 [start, end) 목록으로 모아 마지막에 union 후
    // 합산한다 — 같은 패키지의 다중 액티비티(멀티 인스턴스·PIP)가 동시에 열려 있으면 겹치는
    // 벽시계 구간이 액티비티 수만큼 중복 합산되기 때문(코드리뷰 반영). 서로 다른 패키지는
    // 각자 합산되는 스플릿 스크린 정의(엣지 3) 그대로다.
    val closedByPkg = HashMap<String, MutableList<LongArray>>()
    var sawLifecycleEventInRange = false
    // 미매칭 종료 이벤트 — 룩백(24h)보다 먼저 시작된 세션이 구간 안에서 끝난 경우, RESUMED가
    // 조회 범위 밖이라 close가 더할 구간이 없어 그 세션의 오늘분이 통째로 빠진다. 이때는
    // 커버리지 불완전으로 보고 근사 폴백과 비교한다(코드리뷰 반영).
    var sawUnmatchedTerminalInRange = false
    val event = UsageEvents.Event()

    // 구간 마감 — [begin, end)로 클리핑해(자정 걸친 구간의 날짜별 분할) 패키지별 목록에 적재.
    // 키는 "패키지/클래스"고 패키지명에 '/'가 없으므로 substringBefore로 패키지를 복원한다.
    fun close(key: String, at: Long) {
      val started = openedAt.remove(key) ?: return
      val clippedStart = maxOf(started, begin)
      val clippedEnd = minOf(at, end)
      if (clippedEnd > clippedStart) {
        closedByPkg
          .getOrPut(key.substringBefore('/')) { mutableListOf() }
          .add(longArrayOf(clippedStart, clippedEnd))
      }
    }

    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      // 폴백 판정 — 세션 재구성에 실제 쓰는 앱 라이프사이클 이벤트(RESUMED/PAUSED/STOPPED)가
      // 구간 안에 있을 때만 '보존기간이 이 구간을 덮는다'로 본다. USER_INTERACTION·설정 변경 등
      // 무관 이벤트만 있는 구간(예: 구간 전에 시작돼 이어지는 장시간 세션)은 재구성이 불가능해
      // 근사 폴백이 살아야 한다(코드리뷰 반영). SCREEN_NON_INTERACTIVE 등 기기 전역 이벤트는
      // 앱 사용 없이도 발생하므로 커버리지 증거로 치지 않는다.
      val isLifecycleEvent =
        event.eventType == UsageEvents.Event.ACTIVITY_RESUMED ||
          event.eventType == UsageEvents.Event.ACTIVITY_PAUSED ||
          event.eventType == UsageEvents.Event.ACTIVITY_STOPPED
      if (isLifecycleEvent && event.timeStamp in begin until end) sawLifecycleEventInRange = true
      when (event.eventType) {
        // ACTIVITY_RESUMED(=구 MOVE_TO_FOREGROUND, 값 1) — API 29 미만 기기의 구 이벤트도 같은 값.
        UsageEvents.Event.ACTIVITY_RESUMED -> {
          val pkg = event.packageName ?: continue
          if (!selection.isNullOrEmpty() && pkg !in selection) continue
          // 덮어쓰기 — 닫힘 이벤트 결측 후 재-RESUMED된 경우 과대 계상보다 보수적 계산을 택한다.
          val key = "$pkg/${event.className}"
          openedAt[key] = event.timeStamp
          everOpened.add(key)
        }
        // ACTIVITY_PAUSED(=구 MOVE_TO_BACKGROUND, 값 2) 뒤에 ACTIVITY_STOPPED(23)가 이어져도
        // remove 기반이라 두 번째는 자연히 무시된다.
        UsageEvents.Event.ACTIVITY_PAUSED,
        UsageEvents.Event.ACTIVITY_STOPPED,
        -> {
          val pkg = event.packageName
          val key = "$pkg/${event.className}"
          if (
            pkg != null &&
            key !in openedAt &&
            key !in everOpened &&
            (selection.isNullOrEmpty() || pkg in selection) &&
            event.timeStamp in begin until end
          ) {
            sawUnmatchedTerminalInRange = true
          }
          close(key, event.timeStamp)
        }
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

    // 패키지별 구간 union 합산 — 시작 시각 정렬 후, 다음 구간의 시작이 현재 병합 구간의 끝
    // 이하면(겹침·인접) 끝만 늘려 병합하고, 넘어서면(분리) 병합 구간을 확정·합산한다.
    // 검산: 중첩 [10,100)+[20,50)→90 · 인접 [10,20)+[20,30)→20 · 분리 [10,20)+[30,40)→10+10.
    val byPackage = HashMap<String, Long>(closedByPkg.size)
    for ((pkg, intervals) in closedByPkg) {
      intervals.sortBy { it[0] }
      var pkgMs = 0L
      var mergedStart = intervals[0][0]
      var mergedEnd = intervals[0][1]
      for (i in 1 until intervals.size) {
        val next = intervals[i]
        if (next[0] <= mergedEnd) {
          if (next[1] > mergedEnd) mergedEnd = next[1]
        } else {
          pkgMs += mergedEnd - mergedStart
          mergedStart = next[0]
          mergedEnd = next[1]
        }
      }
      pkgMs += mergedEnd - mergedStart
      // 0ms 앱은 담지 않는다 — 앱별 목록에 "0분" 줄이 늘어서면 실제로 쓴 앱을 가린다.
      if (pkgMs > 0L) byPackage[pkg] = pkgMs
    }

    return ScanResult(byPackage, sawLifecycleEventInRange, sawUnmatchedTerminalInRange)
  }

  // queryUsageStats(INTERVAL_DAILY) 근사 폴백 — 대상 구간과 겹치는 일 버킷의 앱별
  // totalTimeInForeground 합계. 버킷 경계가 흔들릴 수 있어 '근사'로만 쓴다(§3).
  private fun dailyStatsFallbackMillis(
    usageStatsManager: UsageStatsManager,
    selection: Set<String>?,
    begin: Long,
    end: Long,
  ): Long = dailyStatsFallbackByPackage(usageStatsManager, selection, begin, end).values.sum()

  // 폴백의 앱별 형태 — 합계 폴백이 이걸 더해 쓴다(같은 필터·같은 버킷 판정을 공유하려고 한 곳에 둔다).
  private fun dailyStatsFallbackByPackage(
    usageStatsManager: UsageStatsManager,
    selection: Set<String>?,
    begin: Long,
    end: Long,
  ): Map<String, Long> {
    val stats = usageStatsManager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, begin, end - 1)
      ?: return emptyMap()
    val byPackage = HashMap<String, Long>()
    for (stat in stats) {
      if (!selection.isNullOrEmpty() && stat.packageName !in selection) continue
      // 구간과 겹치지 않는 버킷(경계 흔들림으로 딸려온 이웃 날짜) 제외.
      if (stat.lastTimeStamp <= begin || stat.firstTimeStamp >= end) continue
      if (stat.totalTimeInForeground <= 0L) continue
      // 같은 패키지의 버킷이 여럿 걸칠 수 있어 누적한다(덮어쓰면 마지막 버킷만 남는다).
      byPackage[stat.packageName] =
        (byPackage[stat.packageName] ?: 0L) + stat.totalTimeInForeground
    }
    return byPackage
  }
}
