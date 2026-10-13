-- GROMO-2289 고양이 잡지 홍보 칸 (잡지 구현 계획 §2-2 V114) — 섬장이 신청한 홍보 한 건 = 한 행.
--
-- issue_date: 실릴 호의 KST 날짜(= 신청한 KST 날짜 + 1). 신청 창은 전날 07:00~24:00 KST 이고, 고치기도 그 창 안에서만
--   된다(10/14 확정 — 마감 00시가 지나면 글·틀·스티커 모두 굳는다). «발행됨» 을 따로 적지 않는다.
-- applied_at: 지면 순서(먼저 신청한 순)의 기준. 고쳐도 바뀌지 않는다. updated_at 은 마지막 고친 시각.
-- body: 한 줄 글(신고 대상). varchar(n) 은 PostgreSQL 에서 글자(코드 포인트) 수 기준이다 — 60자.
-- layout: 틀·스티커·테이프 배치 JSON(서비스가 검증한 정규형만 들어온다).
-- snapshot: 발행 때 고정하는 섬 이름·건물 수·주민 수·정원·평균. 발행 전에는 NULL(발행 배치가 채운다).
-- moderation: 신고 숨김 상태(NONE·HIDDEN·REMOVED·CLEARED). 운영 사전 검토는 없다(10/14 확정) — 검토·승인 열을 두지 않는다.
-- UNIQUE (island_id, issue_date): 한 섬은 한 호에 한 칸. 「지난번에 실은 칸」(섬별 최신 호) 읽기도 이 유니크 인덱스를
--   거꾸로 탄다 — 같은 열의 인덱스를 따로 두지 않는다.
-- 섬이 닫혀도 groups 행은 묘비로 남아 ON DELETE CASCADE 가 돌지 않는다 → IslandPurgeService 가 직접 지운다.
-- 유저는 익명화만 되고 삭제되지 않는다 — applied_by 는 기록이라 탈퇴 정리 대상이 아니다.
CREATE TABLE island_promotions (
    id         uuid        PRIMARY KEY,
    island_id  uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    issue_date date        NOT NULL,
    applied_by uuid        NOT NULL REFERENCES users (id),
    applied_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    body       varchar(60) NOT NULL,
    layout     jsonb       NOT NULL,
    snapshot   jsonb,
    moderation varchar(10) NOT NULL DEFAULT 'NONE'
        CHECK (moderation IN ('NONE', 'HIDDEN', 'REMOVED', 'CLEARED')),
    hidden_at  timestamptz,
    UNIQUE (island_id, issue_date)
);

-- 지면 순서(같은 호 안에서 먼저 신청한 순) 읽기용.
CREATE INDEX island_promotions_issue_order_idx ON island_promotions (issue_date, applied_at, id);
