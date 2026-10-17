-- GROMO-2299 바다 집중 세션 (바다 항해 v1.0 계약 §1) — 세션 종류·항해 시간·도착 여부, 그리고 한마디.
--
-- focus_session_details:
--   kind             'ISLAND' | 'SEA'. 기존 행은 전부 섬 세션이라 DEFAULT 'ISLAND' 로 채운다(SeaSessionPredicate 의 판정 근거).
--   sailing_minutes  SEA 만 값이 있다 — 시작 시 망원경 목록의 항해 분을 고정한다(목록은 저장되지 않고 매시 다시 계산된다).
--   arrived          SEA 정산 때 activeSeconds >= sailing_minutes * 60 을 적는다. 진행 중·섬 세션은 null.
--   membership_epoch_at_start NOT NULL 해제 — 바다 세션은 멤버십이 없다(island_id 는 목적지 섬, FK 는 그대로).
-- sea_remarks: 바다에서 보이는 한마디(1~20자, 빈 값은 행 삭제). 행이 없으면 한마디 없음. 유저 행은 익명화만 되고 삭제되지 않아
--   ON DELETE CASCADE 가 돌지 않는다 → 탈퇴 트랜잭션이 직접 지운다(프로필 필드 규칙).
ALTER TABLE focus_session_details
    ADD COLUMN kind            varchar(10) NOT NULL DEFAULT 'ISLAND',
    ADD COLUMN sailing_minutes integer,
    ADD COLUMN arrived         boolean,
    ALTER COLUMN membership_epoch_at_start DROP NOT NULL;

CREATE TABLE sea_remarks (
    user_id    uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    remark     varchar(20) NOT NULL,
    changed_at timestamptz NOT NULL
);
