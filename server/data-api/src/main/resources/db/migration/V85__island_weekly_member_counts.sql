-- GROMO-1997: 주간 섬 랭킹 — 주 마감 시점의 «분모 동결».
--
-- 평균 = 그 섬에서 집중한 시간 합계 ÷ 그 섬 «전체 주민 수» (기획 정본 2026-09-14 「섬 가입·전망대·랭킹」).
-- 주는 UTC 일요일 00:00Z ~ 다음 일요일 00:00Z 다 — 요일은 기획 정본(「주간 랭킹은 매주 일요일 00시에
-- 초기화한다」), 시간대는 결정 D8·RC-축·Q-6 과 같은 축(신규 기능은 처음부터 UTC)이다.
--
-- «분모만» 동결한다. 분자(집중 시간)의 정본은 focus_session_details·focus_session_intervals 이고
-- 그 표는 지난 주가 지나도 바뀌지 않는다 — 복제하면 늦게 끝난 세션이 정본과 어긋나고, 같은 값을 두 곳에서
-- 읽게 된다. 반대로 분모는 «사후 복원이 불가능»하다: group_members 는 (user_id, group_id) 한 행뿐이고
-- left_at 이 없어 「그 주에 몇 명이었나」가 어디에도 남지 않는다.
--
-- 동결하지 않으면 주민을 내보내는 것만으로 지난 주 평균이 올라간다(분모가 줄어드니까) — 강퇴로 순위를
-- 조작할 수 있다. 이 표가 그 창을 닫는다: 주가 끝난 시각의 인원을 한 번 적고, 그 뒤 누가 나가든 지난 주
-- 순위는 움직이지 않는다.
--
-- 기준 시각은 «크론이 실행된 순간»이 아니라 «주 종료 경계»다. 가입은 created_at < 경계 로 거르고,
-- 이탈은 group_members 에 이탈 시각이 없어(left_at 부재 · updated_at 은 알림 토글에도 갱신 · created_at 은
-- rejoin 이 갱신 안 함) 쿼리로 닫을 수 없다 — 대신 실행 유예를 넘긴 배치는 아무것도 쓰지 않는다
-- (ranking.freeze.grace). 첫 값이 ON CONFLICT DO NOTHING 으로 영구 고착되므로, 늦게 돈 배치가 틀린 인원을
-- 정답으로 굳히는 것보다 그 주를 비워 두는 편이 낫다. 잔여 창은 island-rankings policy RK-D12.
CREATE TABLE island_weekly_member_counts (
    week_start   date        NOT NULL,
    island_id    uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    member_count integer     NOT NULL,
    frozen_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT island_weekly_member_counts_pk PRIMARY KEY (week_start, island_id),
    -- 주민이 0명인 섬은 애초에 적지 않는다 — 분모 0 을 「0점 참가」로 바꾸지 않기 위해서다(RK-D06).
    CONSTRAINT island_weekly_member_counts_count_ck CHECK (member_count > 0),
    -- ISODOW: 월=1 … 일=7. 키가 «정말로» 일요일인지 DB 가 지킨다 — 크론 존이나 호출측 계산이 틀어져도
    -- 월요일자 주가 조용히 섞이지 않는다.
    CONSTRAINT island_weekly_member_counts_sunday_ck CHECK (EXTRACT(ISODOW FROM week_start) = 7)
);

COMMENT ON TABLE island_weekly_member_counts IS
    '주간 섬 랭킹의 동결된 분모 — 주 마감(일요일 00:00Z) 시점의 활성 주민 수. GROMO-1997, V85';

-- 랭킹 분자의 스캔 경로. 주 창은 [주 시작, 주 끝) 과 겹치는 «닫힌 ACTIVE» 구간만 본다(끝난 집중만 반영).
-- 이 부분 인덱스가 없으면 랭킹 한 번에 전체 구간을 훑는다.
-- ponytail: 단순 btree 라 「아주 오래된 주」일수록 started_at 상한이 느슨해져 더 읽는다. 조회하는 주가
-- 최근 몇 주뿐이라 지금은 충분하다 — 과거 주 조회가 늘면 (ended_at, started_at) BRIN 으로 옮긴다.
CREATE INDEX focus_session_intervals_active_window_idx
    ON focus_session_intervals (started_at, ended_at)
    WHERE kind = 'ACTIVE' AND ended_at IS NOT NULL;
