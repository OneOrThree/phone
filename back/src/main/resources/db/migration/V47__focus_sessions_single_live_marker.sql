-- ════════════════════════════════════════════════════════════════════
-- V47 — 유저당 라이브 마커 1개 불변식 (GROMO-1287)
-- ════════════════════════════════════════════════════════════════════
-- 「라이브 마커」 = focus_sessions 의 ended_at IS NULL 인 행. 유저당 1개여야 하는데 그걸 강제하는
-- 것이 아무것도 없었다(FocusService.startFocusSession 이 기존 열린 마커를 조회조차 하지 않고 INSERT).
-- 고아 마커가 남으면 친구·리그 isFocusing 이 최대 12시간(orphan 스윕 주기) 참으로 남고,
-- FocusSessionRepository.existsActiveOverlappingWindow(GROMO-1413) 정산 대기 가드가 계속 참이라
-- 그 회차 내기 정산이 그만큼 밀린다(최악의 경우 24h 자동 환불로 내기 무효).
--
-- ⚠️ 순서가 계약이다: ① 백필 → ② 부분 유니크 인덱스.
--    프로덕션에는 이미 유저당 다중 미종료 행이 있다(그게 이 티켓이다). 백필 없이 인덱스를 만들면
--    CREATE UNIQUE INDEX 가 중복으로 실패해 배포(부팅)가 막힌다 — V28 이 CHECK 로 겪은 것과 같은 함정.
--
-- ⚠️ 술어는 status = 'ACTIVE' 가 아니라 ended_at IS NULL 이다.
--    FocusSessionStatus.ACTIVE javadoc: "GROMO-610 시절 레거시 경로로 endedAt 만 채워지고 ACTIVE 로 남은
--    완료 세션도 존재할 수 있다". status 술어를 쓰면 그 레거시 완료 행까지 유니크에 계수돼 인덱스 생성이
--    실패하고, 반대로 진짜 라이브 판정(모든 조회가 ended_at IS NULL 로 한다)과도 어긋난다.
--
-- 서버측 짝(같은 티켓): startFocusSession 이 close-then-open 으로 바뀌어, 새 마커 INSERT 직전에
-- 같은 유저의 열린 마커를 AUTO_CLOSED 로 마감한다(FocusSessionRepository.autoCloseOpenMarkersOf).
-- 이 인덱스는 그 뒤에 얹는 2차 방어선이다 — 인덱스만 걸면 뽀모도로 「마커 회전」(구 마커 마감 전에
-- 신 마커를 여는 정상 흐름, GROMO-873)이 500 으로 터진다.

-- ── ① 백필: 유저당 최신 1건만 남기고 나머지 열린 마커를 마감 ─────────────
-- 남기는 쪽 = started_at 이 가장 최신인 마커. findLiveSessionsByUserIdIn 의 ORDER BY started_at DESC 가
-- 이미 "여럿이면 최신을 고른다"를 관례로 세워뒀으므로, 백필이 남기는 행과 조회가 보던 행이 일치한다.
--
-- ended_at 값 선택: LEAST(그 유저의 다음(더 최신) 열린 마커 started_at, started_at + 12h).
--   · 다음 마커 started_at = 이 마커가 실제로 대체된 시각이다. 마커 회전·중복 시작 어느 경로든
--     그 시점 이후로는 이 마커에 귀속될 집중이 없다(앱이 이미 참조를 끊었다).
--   · 12h 상한 = FocusService.ORPHAN_TIMEOUT. orphan 스윕이 쓰는 상한과 같은 값이라, 다음 마커가
--     한참 뒤에 열린 경우(앱 강제종료 후 며칠 뒤 재시작)에도 스윕이 채웠을 값을 넘지 않는다.
--   · started_at 동률이면 LEAD 가 같은 값을 주어 ended_at = started_at (0초). 역전(ended_at < started_at)은
--     생기지 않는다.
-- status 는 AUTO_CLOSED — 신규 상태값을 만들지 않은 근거는 autoCloseOpenMarkersOf javadoc 참고.
-- 요지: ① 모든 집계가 NOT IN(CANCELED, AUTO_CLOSED) 제외 목록 방식이라 신규 값은 자동 포함돼 이중집계가
-- 되고 ② PATCH 409 → SESSION_DISCARDED → 앱 POST 폴백(시간·코인 회수) 배선이 이 값에만 걸려 있다.
--
-- 보상 유실 없음: 마감 대상은 전부 ended_at IS NULL 이라 통계(daily_focus_stats)·코인·창 집계
-- (sumOverlapSecondsInWindow 는 ended_at IS NOT NULL 조건)에 **한 번도** 반영된 적이 없는 행이다.
-- 앞으로 들어올 지급도 막지 않는다 — 앱이 이 마커에 PATCH 를 보내면 409 SESSION_DISCARDED 를 받고
-- POST 완료 저장으로 폴백해 그 블록의 시간·코인이 그대로 귀속된다(uploadFocusBlock.ts).
--
-- user_id IS NULL(탈퇴로 nullifyUser 된 행)은 건드리지 않는다. Postgres 유니크 인덱스는 NULL 을
-- 중복으로 보지 않아 인덱스 생성을 막지 않고, 탈퇴자 행의 상태를 바꿀 이유도 없다.
WITH open_markers AS (
    SELECT id,
           started_at,
           LEAD(started_at) OVER (PARTITION BY user_id ORDER BY started_at, id) AS superseded_at,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY started_at DESC, id DESC) AS recency
      FROM public.focus_sessions
     WHERE user_id IS NOT NULL
       AND ended_at IS NULL
)
UPDATE public.focus_sessions s
   SET status   = 'AUTO_CLOSED',
       ended_at = LEAST(m.superseded_at, m.started_at + interval '12 hours')
  FROM open_markers m
 WHERE s.id = m.id
   AND m.recency > 1;

-- ── ② 부분 유니크 인덱스 ────────────────────────────────────────────────
-- 이름을 명시한다(V20 교훈: 뒤 마이그레이션이 이름-무관 드롭을 반복하지 않도록 제약/인덱스명을 박는다).
-- JPA 는 부분 유니크를 표현할 수 없어 엔티티 @Table(indexes=...) 에는 없다 — 따라서 ci 프로파일
-- (create-drop) 스키마에도 없고, 실 SQL 검증은 FocusSessionV47MigrationTest 가 맡는다.
-- 부수 효과: focus_sessions 는 PK 외 인덱스가 하나도 없었다. 이 인덱스는
-- findLiveSessionsByUserIdIn / findUserIdsWithLiveSession (user_id IN … AND ended_at IS NULL) 도 탄다.
CREATE UNIQUE INDEX uq_focus_sessions_live_marker
    ON public.focus_sessions (user_id)
    WHERE ended_at IS NULL;
