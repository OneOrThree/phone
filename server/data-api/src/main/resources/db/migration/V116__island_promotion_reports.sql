-- GROMO-2289 고양이 잡지 홍보 칸 신고 (잡지 구현 계획 §2-2 V116, SAFE-04) — 한 사람이 한 칸을 한 번 신고한다.
--
-- 서로 다른 사람 3명이 신고하면 그 트랜잭션에서 island_promotions.moderation 을 HIDDEN 으로 바꿔 모든 독자에게서 즉시
-- 숨긴다. 운영이 SQL 로 확인해 REMOVED(내림, 물고기는 돌려주지 않는다) 또는 CLEARED(되살림, 이후 자동 숨김 없음)로 바꾼다.
-- 운영 사전 검토는 없다(10/14 확정).
-- reason 은 앱의 유저 신고 창과 같은 8종이다. 신고는 소셜 로그인 계정만 한다(게스트 계정으로 경쟁 섬 칸을 숨기는 악용 방지).
-- 홍보 칸이 지워지면(섬이 닫혀 IslandPurgeService 가 지울 때) 신고도 함께 지워진다. 유저는 익명화만 되고 지워지지 않아
-- reporter 의 CASCADE 는 돌지 않는다 — 신고 행은 숨김 판정의 근거라 탈퇴해도 남긴다.
CREATE TABLE island_promotion_reports (
    promotion_id uuid        NOT NULL REFERENCES island_promotions (id) ON DELETE CASCADE,
    reporter_id  uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reason       varchar(30) NOT NULL CHECK (reason IN ('HARASSMENT', 'HATE', 'SPAM_FRAUD', 'SEXUAL', 'CHILD_SAFETY',
                                                        'THREAT', 'PRIVACY_IMPERSONATION', 'OTHER')),
    created_at   timestamptz NOT NULL,
    PRIMARY KEY (promotion_id, reporter_id)
);
