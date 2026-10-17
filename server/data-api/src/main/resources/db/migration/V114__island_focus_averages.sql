-- GROMO-2257 섬별 «최근 7일 주민 1명당 하루 평균 집중(분)» 일 스냅샷 (섬 외부 계약 §3).
--
-- 매일 07:00 KST 배치가 살아 있는 섬마다 한 행을 적는다. 창은 [D-7 07:00 KST, D 07:00 KST) 이고,
-- 망원경 목록(GROMO-2265)이 섬마다 «가장 최근 snapshot_date 행» 을 읽는다.
--
-- snapshot_date: 실행일(KST 날짜). (snapshot_date, island_id) 가 PK 라 같은 날 두 번 돌려도 첫 값이 남는다
--   (INSERT … ON CONFLICT DO NOTHING) — «같은 날 2회 조회 = 같은 값» 이 이 PK 로 성립한다.
-- member_count: 계산 시점의 현재 주민 수(GroupMemberRepository.countByGroupIdIn 과 같은 모수).
-- avg_minutes_per_member_day: round(창 안 섬 집중 초 ÷ 60 ÷ member_count ÷ 7). NULL = 주민 0명(분모 0).
--   주민이 있는데 집중이 0 이면 NULL 이 아니라 0 이다.
-- computed_at: 배치가 적은 시각(운영 관측용). 엔티티는 매핑하지 않는다 — 읽는 쪽이 쓰지 않는다.
CREATE TABLE island_focus_averages (
    snapshot_date              date        NOT NULL,
    island_id                  uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    member_count               integer     NOT NULL,
    avg_minutes_per_member_day integer,
    computed_at                timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (snapshot_date, island_id)
);

-- 섬마다 가장 최근 행(DISTINCT ON (island_id) … ORDER BY island_id, snapshot_date DESC) 읽기용.
-- PK 는 날짜가 앞이라 «이 섬의 최근 행» 조회에 쓸 수 없다.
CREATE INDEX island_focus_averages_island_date_idx ON island_focus_averages (island_id, snapshot_date DESC);
