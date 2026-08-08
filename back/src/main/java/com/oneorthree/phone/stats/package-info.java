/**
 * 통계 도메인 — 홈/친구 화면의 집중·스크린타임 집계 조회.
 *
 * <p>이 패키지 문서는 통계 <b>파이프라인의 현재 동작(as-is)</b>을 한곳에 고정한다(GROMO-779). 날짜 기준·
 * 단위·목표 판정·집계 소스가 도메인마다 달라 산재해 있으므로, 아래 표로 현황을 명시한다. 804·805 는
 * PR3(GROMO-804/805/806)에서 해소됐고(아래 반영), 803(집중 쓰기 날짜 기준 통일)은 아직 후속(번호만)이다.
 *
 * <h2>쓰기(write) 흐름 — 집계 적재</h2>
 * <ul>
 *   <li><b>집중</b>: 세션 완료(POST {@code /api/v1/focus-session} 통째 저장 · PATCH 라이브 종료) →
 *       {@code FocusService.recordCompletion} 이 공통 귀속:
 *       <ul>
 *         <li>{@code DailyFocusStat} upsert — (user, date) 비관적 락 후 초 단위 += 누적(GROMO-642).
 *             버킷 날짜 = country_code 존 로컬 날짜
 *             (GROMO-803 — 스크린타임 561과 동일 기준. countryCode null·미지원은 Asia/Seoul 폴백).
 *             <b>GROMO-1252</b>: 자정을 걸친 세션은 {@code splitByLocalDay} 로 로컬 자정에서 잘라
 *             날짜별로 나눠 가산한다(세션 행·세션 보상 코인은 1건/1회 유지, {@code sessionCount}·
 *             {@code totalDistractionSeconds} 는 시작일에만).</li>
 *         <li>스트릭 — {@code UserStreakService.updateOnSessionComplete(user, statDate)} (같은 트랜잭션).
 *             자정 분할 시 <b>날짜 오름차순</b>으로 호출한다(스트릭이 과거 날짜를 무시하므로 순서가 계약).
 *             인정 기준(10분)은 <b>쪼갠 뒤</b> 날짜별 누적으로 판정한다.</li>
 *         <li>리그 — ACTIVE 아레나 멤버면 주간 누적 집중 초 반영(GROMO-646/665).</li>
 *       </ul>
 *       자동 종료 orphan 세션({@code sweepOrphanSessions})은 통계·스트릭에 반영하지 않으며, GROMO-804 로 상태를
 *       {@code AUTO_CLOSED} 로 표시해 by-category 실시간 집계에서도 제외된다(과거엔 ACTIVE 로 남아 leak).</li>
 *   <li><b>스크린타임</b>: 앱이 매일 전송 → {@code ScreenTimeService.saveScreenTime} 이
 *       {@code DailyScreenTimeStat} 적재. 버킷 날짜 = country_code 존 로컬 날짜(GROMO-561).
 *       목표 달성 플래그(GROMO-805): <b>최종 보고</b>(isFinal=true 또는 과거 날짜)만 <b>클라 신뢰</b>
 *       ({@code screenTimeGoalAchieved} 그대로 저장, 서버 재판정 안 함 — 과거 목표를 서버가 모름)하고 finalized 로 표시한다.
 *       <b>interim(오늘·미마감)</b>은 total 만 갱신하고 flag/finalized 는 미확정(신규 row 기본값 false, 기존 flag 보존).</li>
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
 *   <li>{@code GET /stats/by-category} — FocusSession <b>실시간</b> 집계(endedAt country_code 존 윈도우, 태그별; GROMO-803).</li>
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
 *     <td>쓰기 버킷 = country_code 존 로컬 날짜, 자정 걸치면 날짜별 분할(GROMO-803/1252, 561과 정합)</td>
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
 *     <td>최종 보고만 <b>클라 신뢰</b>(flag 그대로 저장, finalized=true) · interim(오늘)은 total 만 갱신·flag/finalized 미확정(GROMO-805)</td>
 *     <td>week/month = row 없는 날=달성(목표설정 유저, 가입일 클램프) · today/day 및 오늘 interim 은 현재 목표로 재계산</td>
 *   </tr>
 *   <tr>
 *     <td>집계 소스</td>
 *     <td>heatmap/today/focus = 사전집계(DailyFocusStat) · by-category = <b>실시간</b>(FocusSession, orphan 제외 GROMO-804)</td>
 *     <td>모두 사전집계(DailyScreenTimeStat)</td>
 *     <td>—</td>
 *   </tr>
 * </table>
 *
 * <h2>티켓별 정합 상태(번호만)</h2>
 * <ul>
 *   <li><b>803</b> — <b>해소됨</b>: 집중 쓰기 날짜 기준을 UTC → country_code 존으로 통일(스크린타임과 정합).
 *       by-category 조회 윈도우도 같은 존으로 정합. <b>forward-only</b> — 기존 UTC 버킷 row 는 재집계하지 않음.
 *       <b>수용 한계</b>: 미지원 국가·{@code countryCode==null} 은 Asia/Seoul 폴백이라(GROMO-1252)
 *       KR 밖 유저는 자정 경계 오귀속 가능(YAGNI — 서비스가 KR 중심).
 *       여행/국가변경으로 디바이스 존 ≠ country 존인 경우도 country 존 기준으로 귀속(코드 미처리, 문서 수용).
 *       <p><b>forward-only 컷오버 아티팩트(수용)</b> — 아래 두 불일치는 PR 리뷰에서 제기됐으나, 변경이
 *       forward-only 이고 현재 DB 가 리셋 가능한 개발용이라 <b>수용</b>한다(소급 보정 안 함).
 *       <ul>
 *         <li><b>by-category(실시간) vs 사전집계(구 UTC 버킷) 과거 불일치</b>:
 *             {@code /stats/by-category} 는 {@code FocusSession} 을 실시간 집계하므로 배포 후 과거 기간을
 *             조회하면 새 존 윈도우로 재버킷된다. 반면 {@code DailyFocusStat}(사전집계)의 구 row 는 UTC 버킷
 *             그대로라, 배포 이전 경계 세션에 한해 {@code /stats/focus}·{@code /today}·{@code /heatmap} 과
 *             {@code /stats/by-category} 가 같은 날짜에 서로 다른 합계를 낼 수 있다(일시적, forward-only 수용).</li>
 *         <li><b>스트릭 컷오버 아티팩트</b>: 배포 전 {@code user_streaks.lastSessionDate} 는 UTC 기준.
 *             배포 후 존 기준 statDate 로 바뀌면 경계 시각(KST 00~09시) 세션을 마지막으로 가진 KR 유저는
 *             다음 세션에서 날짜가 +1일 튀어 스트릭이 1회 잘못 리셋될 수 있다(연속인데 gap 오판).
 *             forward-only(806 도 소급 보정 안 함) + dev DB 리셋 전제로 수용.</li>
 *       </ul></li>
 *   <li><b>804</b> — <b>해소됨</b>: by-category 실시간 집계에서 orphan(AUTO_CLOSED) 세션 제외 → /stats/focus 와 정합.</li>
 *   <li><b>805</b> — <b>해소됨</b>: 목표 달성 판정 통일(스크린타임 최종 보고 클라 신뢰·interim total 만 갱신 +
 *       week/month 누락일 정책, 오늘은 day 와 동일 재계산).</li>
 *   <li><b>806</b> — 스트릭 인정 게이트(그날 누적 10분 이상) + 세션완료 응답 필드(additive).</li>
 * </ul>
 */
package com.oneorthree.phone.stats;
