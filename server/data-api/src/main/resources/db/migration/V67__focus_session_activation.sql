-- GROMO-1924: 집중 세션 시작 게이트의 선행 조건.

-- 1) 소속 상실 종결 사유 (선행 조건 #7, 2026-09-18 결정 FR-D03 = B1 「강제 종료, 미정산」).
--    강퇴 TX 가 진행 세션을 MEMBERSHIP_LOST 로 끝낸다. ABANDONED(기본 마커가 밖에서 닫힌 사고의 정리)와
--    섞으면 원인 추적이 안 되므로 값을 나눈다. 15자라 V58 의 varchar(10) 를 넓힌다.
--    V58 의 인라인 CHECK 는 PostgreSQL 기본 이름(<table>_<column>_check)으로 만들어졌다.
--    두 부분 인덱스(user_progressing_uk · rest_seat_uk)의 조건은 ACTIVE/PAUSED 만 보므로 그대로다.
ALTER TABLE focus_session_details DROP CONSTRAINT focus_session_details_lifecycle_check;
ALTER TABLE focus_session_details ALTER COLUMN lifecycle TYPE varchar(20);
ALTER TABLE focus_session_details ADD CONSTRAINT focus_session_details_lifecycle_check
    CHECK (lifecycle IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED', 'MEMBERSHIP_LOST'));

-- 2) 집중 보상 정책 revision (선행 조건 #6). FR-D01 「산식은 revision 있는 서버 정책 설정으로 관리」.
--    값: 2026-09-18 결정 D5(60초당 1마리 · 주민·섬별 하루 480마리) + D5-귀속(개인 50% · 섬 통장 50%).
--    가장 큰 revision 이 현재 정책이고, 세션은 시작할 때 그 revision 을 focus_session_details.policy_revision
--    에 고정한다. 값을 바꿀 때는 행을 고치지 말고 새 revision 을 넣는다 — 진행 중 세션의 지급률이 바뀐다.
--    정책 행이 하나도 없으면 start 가 열리지 않는다(정책 없는 세션을 만들지 않는다, LLD §2 start).
CREATE TABLE focus_reward_policies (
    revision                integer PRIMARY KEY,
    seconds_per_fish        integer NOT NULL CHECK (seconds_per_fish > 0),
    daily_cap_fish          integer NOT NULL CHECK (daily_cap_fish >= 0),
    personal_share_percent  integer NOT NULL CHECK (personal_share_percent BETWEEN 0 AND 100),
    published_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO focus_reward_policies (revision, seconds_per_fish, daily_cap_fish, personal_share_percent)
VALUES (1, 60, 480, 50);

COMMENT ON TABLE focus_reward_policies IS
    'GROMO-1924: 집중 보상 산식 revision(FR-D01 · D5 · D5-귀속). 추가만 한다 — 세션은 시작 시 revision 을 고정.';

-- 3) 개인 지갑(개인 물고기, 통화 fish) — 2026-09-18 결정 D1. 집중 보상의 개인 몫을 받는다.
--    코인 지갑(user_wallets)과 다른 행이다 — 결정 D11(기존 코인 잔액 이관 안 함)이라 0 에서 시작한다.
--    원장은 아직 두지 않는다 — 적립 경로가 집중 정산 하나뿐이라 세션당 1행인 focus_settlements 가 근거다.
CREATE TABLE user_fish_wallets (
    user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    balance     integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_fish_wallets IS
    'GROMO-1924: 개인 물고기 지갑(D1). 코인(user_wallets)과 별개 — D11 로 코인 잔액을 옮기지 않는다.';

-- 4) 하루 상한 합산(주민·섬별 UTC 하루, D8) — 정산 완료 시각으로 자른다.
CREATE INDEX focus_settlements_completed_at_idx ON focus_settlements (completed_at);
