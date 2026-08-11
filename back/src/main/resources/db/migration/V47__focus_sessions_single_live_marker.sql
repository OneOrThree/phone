-- ════════════════════════════════════════════════════════════════════
-- V47 — 유저당 라이브 마커 1개 불변식 (GROMO-1287)
-- ════════════════════════════════════════════════════════════════════
-- 「라이브 마커」 = focus_sessions 의 ended_at IS NULL 인 행. 유저당 1개여야 하는데 그걸 강제하는
-- 것이 아무것도 없었다(FocusService.startFocusSession 이 기존 열린 마커를 조회조차 하지 않고 INSERT).
-- 고아 마커가 남으면 친구·리그 isFocusing 이 최대 12시간(orphan 스윕 주기) 참으로 남고,
-- FocusSessionRepository.existsActiveOverlappingWindow(GROMO-1413) 정산 대기 가드가 계속 참이라
-- 그 회차 내기 정산이 그만큼 밀린다(최악의 경우 24h 자동 환불로 내기 무효).
--
-- ⚠️ 이 마이그레이션은 **백필만** 한다. 부분 유니크 인덱스는 일부러 뺐다.
--
--    prod 롤백은 Flyway 를 그대로 두고 **이미지만 되돌린다**(back/CLAUDE.md "Per profile" +
--    .github/workflows/prod-rollback.yml 이 image_sha 만 받는다). 그래서 유니크 인덱스를 여기서
--    만들면, V47 적용 후 이전 이미지로 롤백했을 때 **인덱스는 DB 에 남고** 구버전 startFocusSession
--    (열린 마커를 닫지 않고 INSERT)이 뽀모도로 회전·리플레이 start 마다 유니크 위반 500 을 낸다.
--
--    인덱스는 close-then-open 이 prod 에 안착한 뒤 **별도 배포**로 넣는다(후속 티켓). Flyway 는
--    pending 을 순서대로 전부 돌리므로, 같은 PR 에 V48 로 넣어도 같은 배포에 적용돼 의미가 없다 —
--    "앞 배포가 안착한 뒤"를 강제할 수 있는 유일한 방법이 파일을 다음 PR 로 미루는 것이다.
--
--    그때까지 「유저당 라이브 마커 1개」는 서비스 레이어가 지킨다: users 행 배타 락(동시 start 직렬화)
--    + close-then-open + startedAt 단조성. 열린 마커를 만드는 경로가 startFocusSession 하나뿐이라
--    (POST 완료 저장은 항상 ended_at 을 채운다) 이 조합으로 불변식이 성립한다. 인덱스는 2차 방어선이다.
--
-- 백필은 롤백에도 무해하다 — 구버전 서버가 보기엔 그냥 정리된 상태이고, 되돌릴 필요가 없다.

-- ── 백필: 유저당 최신 1건만 남기고 나머지 열린 마커를 마감 ───────────────
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

-- 정산 대기 가드(GroupBetSettler)와의 관계: 여기서 채우는 ended_at 은 **과거값**(다음 마커 시작 또는
-- +12h)이라, GROMO-1287 이 넓힌 가드의 '방금 닫힌 마커' 유예창(5분)에 걸리지 않는다 —
-- 배포 직후 창형 FOCUS 정산이 무더기로 멈추는 일이 없다.
