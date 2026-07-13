/**
 * 통계 도메인 — 홈/친구 화면의 집중·스크린타임 집계 조회.
 *
 * <p>이 패키지 문서는 통계 <b>파이프라인의 현재 동작(as-is)</b>을 한곳에 고정한다(GROMO-779). 날짜 기준·
 * 단위·목표 판정·집계 소스가 도메인마다 달라 산재해 있으므로, 아래 표로 현황을 명시하고 어긋난 지점을 후속
 * 티켓(803/804/805 — 번호만; 이 패키지가 직접 구현하지 않음)이 각각 해소한다.
 *
 * <h2>쓰기(write) 흐름 — 집계 적재</h2>
 * <ul>
 *   <li><b>집중</b>: 세션 완료(POST {@code /api/v1/focus-session} 통째 저장 · PATCH 라이브 종료) →
 *       {@code FocusService.recordCompletion} 이 공통 귀속:
 *       <ul>
 *         <li>{@code DailyFocusStat} upsert — (user, date) 비관적 락 후 초 단위 += 누적(GROMO-642).
 *             버킷 날짜 = {@code statDate(endedAt)} = endedAt 의 <b>UTC</b> 로컬 날짜(현재 기준).</li>
 *         <li>스트릭 — {@code UserStreakService.updateOnSessionComplete(user, statDate)} (같은 트랜잭션).</li>
 *         <li>리그 — ACTIVE 아레나 멤버면 주간 누적 집중 초 반영(GROMO-646/665).</li>
 *       </ul>
 *       자동 종료 orphan 세션({@code sweepOrphanSessions})은 통계·스트릭에 반영하지 않으며 상태가 ACTIVE 로
 *       남는다(→ by-category leak, ticket 804).</li>
 *   <li><b>스크린타임</b>: 앱이 매일 전송 → {@code ScreenTimeService.saveScreenTime} 이
 *       {@code DailyScreenTimeStat} 적재. 버킷 날짜 = country_code 존 로컬 날짜(GROMO-561),
 *       목표 달성 플래그는 <b>클라 신뢰</b>(요청값 저장).</li>
 * </ul>
 *
 * <h2>조회(read) 흐름 — 6개 엔드포인트</h2>
 * <p>{@code StatsController}(6종) → {@code StatsService} → 집계 소스. 열람 권한(친구/PUBLIC)은
 * {@code StatViewPolicy}, 기간 경계는 {@code StatsPeriodResolver}, 단위 환산은 {@code stats.support.StatsUnits}
 * 로 분리(GROMO-779).
 * <ul>
 *   <li>{@code GET /stats/heatmap} — DailyFocusStat + DailyScreenTimeStat 를 날짜로 머지(사전집계).</li>
 *   <li>{@code GET /stats/streak} — UserStreak 조회.</li>
 *   <li>{@code GET /stats/today} — DailyFocusStat/DailyScreenTimeStat + 현재 목표로 재계산(사전집계).</li>
 *   <li>{@code GET /stats/focus} — DailyFocusStat 초합 → 분 환산(사전집계), 직전 구간 delta.</li>
 *   <li>{@code GET /stats/by-category} — FocusSession <b>실시간</b> 집계(endedAt UTC 윈도우, 태그별).</li>
 *   <li>{@code GET /stats/screen-time} — DailyScreenTimeStat 합산(사전집계), 목표 달성 정보.</li>
 * </ul>
 *
 * <h2>기준표(criteria) — 현재 동작</h2>
 * <table border="1">
 *   <caption>도메인/엔드포인트별 날짜 기준·단위·목표 판정·집계 소스 (as-is)</caption>
 *   <tr>
 *     <th>항목</th><th>집중(focus)</th><th>스크린타임(screen)</th><th>조회 파라미터(read)</th>
 *   </tr>
 *   <tr>
 *     <td>날짜 기준</td>
 *     <td>쓰기 버킷 = endedAt <b>UTC</b>〔현재〕 → ticket 803</td>
 *     <td>쓰기 버킷 = country_code 존(GROMO-561)</td>
 *     <td>조회 {@code date} = 클라 로컬(GROMO-643)</td>
 *   </tr>
 *   <tr>
 *     <td>단위·내림</td>
 *     <td>저장 초 → 응답 분(합산 후 1회 floor {@code /60}, GROMO-642)</td>
 *     <td>저장·응답 모두 분</td>
 *     <td>진행도(%) = round, 클램프 없음</td>
 *   </tr>
 *   <tr>
 *     <td>목표 판정</td>
 *     <td>쓰기 시 서버 단방향 flag(false→true 1회) · today 는 현재 목표로 재계산</td>
 *     <td>쓰기 시 <b>클라 신뢰</b> flag · today 는 서버 재계산({@code actual <= goal})</td>
 *     <td>week/month = 저장 flag 집계 · today/day = 재계산 → ticket 805</td>
 *   </tr>
 *   <tr>
 *     <td>집계 소스</td>
 *     <td>heatmap/today/focus = 사전집계(DailyFocusStat) · by-category = <b>실시간</b>(FocusSession) → ticket 804</td>
 *     <td>모두 사전집계(DailyScreenTimeStat)</td>
 *     <td>—</td>
 *   </tr>
 * </table>
 *
 * <h2>후속 티켓이 해소할 불일치(번호만)</h2>
 * <ul>
 *   <li><b>803</b> — 집중 쓰기 날짜 기준을 UTC → country_code 존으로 통일(스크린타임과 정합).</li>
 *   <li><b>804</b> — by-category 실시간 집계가 orphan(ACTIVE+endedAt) 세션을 포함하는 소스 정합.</li>
 *   <li><b>805</b> — 목표 달성 판정 통일(스크린타임 클라 신뢰 제거 + 누락일 정책).</li>
 * </ul>
 */
package com.oneorthree.phone.stats;
