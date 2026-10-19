-- GROMO-2343: 주간 섬 랭킹 분자의 read model + GROMO-2344: 회관 기록 조회의 시간 경계 인덱스.
--
-- 1) island_weekly_focus — (주, 섬)마다 «끝난 섬 집중»의 ACTIVE 마이크로초 합.
--
-- 종전에는 랭킹 요청마다 focus_session_details × focus_session_intervals 를 «모든 섬»에 걸쳐 다시 합쳤다
-- (FocusSessionDetailRepository.sumIslandActiveSeconds). 부하 조사(1만 명·100 RPS)에서 p95 1.62s·DB 4.37코어였고,
-- V85 의 (started_at, ended_at) 인덱스는 최근 주일수록 started_at 상한이 비선택적이라 사실상 전수 스캔이다.
-- 그래서 V85 주석의 «분자는 복제하지 않는다» 를 거둔다 — 정본은 여전히 focus_session_* 이고, 이 표는 그
-- 정본을 같은 창으로 접은 사본이다. 어긋나면 재계산(IslandWeeklyFocusService.recompute)이 정본으로 덮는다.
--
-- 단위가 «초» 가 아니라 «마이크로초» 인 이유: 원본 집계는 구간 교집합을 그대로 더한 뒤 섬마다 «마지막에
-- 한 번만» 내린다. 세션마다 초로 내려 더하면 세션 수만큼 초가 사라져 원본과 어긋난다. 읽는 쪽이
-- active_micros / 1e6 을 내린다. 섬·주 상한(15명 × 7일)은 9e12 μs 라 bigint 에 넉넉하다.
--
-- 갱신: 세션이 COMPLETED 로 전이하는 트랜잭션(FocusSessionLifecycleService.settle)이 그 세션의 ACTIVE 구간을
-- 주 창(RankingWeek — UTC 일요일 00:00Z)별로 잘라 가산한다. 주 마감 크론이 방금 끝난 주를 정본으로 다시 채운다.
CREATE TABLE island_weekly_focus (
    week_start    date        NOT NULL,
    island_id     uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    active_micros bigint      NOT NULL DEFAULT 0,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    -- 읽기가 «그 주의 모든 섬» 이라 주가 앞이다(V85 island_weekly_member_counts 와 같은 순서).
    CONSTRAINT island_weekly_focus_pk PRIMARY KEY (week_start, island_id),
    CONSTRAINT island_weekly_focus_sunday_ck CHECK (EXTRACT(ISODOW FROM week_start) = 7),
    CONSTRAINT island_weekly_focus_micros_ck CHECK (active_micros >= 0)
);

COMMENT ON TABLE island_weekly_focus IS
    '주간 섬 랭킹 분자 read model — (UTC 일요일 주, 섬)의 끝난 섬 집중 ACTIVE μs 합. GROMO-2343, V130';

-- 백필 — 지금까지의 모든 주. 구간이 주 경계를 걸치면 주마다 나눈다. 원본 집계와 같은 술어다.
INSERT INTO island_weekly_focus (week_start, island_id, active_micros)
SELECT w.week_start, d.island_id,
       SUM(EXTRACT(EPOCH FROM (LEAST(i.ended_at, w.week_end) - GREATEST(i.started_at, w.week_begin))) * 1000000)::bigint
FROM focus_session_details d
JOIN focus_session_intervals i ON i.session_id = d.session_id
CROSS JOIN LATERAL (
    SELECT ws::date AS week_start, ws AT TIME ZONE 'UTC' AS week_begin, (ws + interval '7 days') AT TIME ZONE 'UTC' AS week_end
    FROM generate_series(date_trunc('week', (i.started_at AT TIME ZONE 'UTC') + interval '1 day') - interval '1 day',
                         i.ended_at AT TIME ZONE 'UTC', interval '7 days') ws
) w
WHERE d.lifecycle = 'COMPLETED' AND d.kind = 'ISLAND' AND i.kind = 'ACTIVE' AND i.ended_at IS NOT NULL
  AND LEAST(i.ended_at, w.week_end) > GREATEST(i.started_at, w.week_begin)
GROUP BY w.week_start, d.island_id;

-- 2) 회관 기록(GROMO-2344) — 주민의 «전생애» 세션을 훑지 않도록 시간으로 자르는 경로.
--
-- findOverlapping[OnIsland] 는 상세에 시간 열이 없어 주민의 모든 세션마다 구간을 탐침했다. 끝난 세션의
-- last_transition_at 은 종결 시각이고 그 세션의 어떤 구간 ended_at 보다도 작지 않으므로(settle 이 같은 anchor 로
-- 열린 구간을 닫는다), 「구간이 창과 겹친다」면 「last_transition_at > 창 시작」이다. 진행 중 세션은 사용자당 1건이라
-- 부분 UNIQUE(focus_session_details_user_progressing_uk)가 따로 받는다.
-- 섬 열을 가운데 둔다: scope=island 는 세 열 모두 범위 조건으로, scope=me(섬 무관)는 user_id 범위 안에서
-- last_transition_at 을 인덱스 튜플로 걸러 힙을 읽지 않는다. (user_id, last_transition_at) 두 열이면 scope=island 가
-- V82 (user_id, island_id, session_id) 를 골라 주민 전생애 힙을 그대로 읽었다(EXPLAIN: 4,071 → 1,333 블록 차이).
CREATE INDEX focus_session_details_user_transition_idx
    ON focus_session_details (user_id, island_id, last_transition_at);
