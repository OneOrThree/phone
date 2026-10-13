-- GROMO-2289 잡지 경유 행동 (잡지 구현 계획 §2-2 V117, AD-11) — 회관 홍보 기록판의 넣은 수·도착 수·가입 수.
--
-- PIN: 현재 호(실린 날 07시~다음 날 07시)에 보이는 그 홍보 칸에서 망원경에 넣었다. 편집부 무료 칸에서 넣은 핀은 홍보가
--      없으므로 세지 않는다.
-- ARRIVE·JOIN: 그 홍보에 PIN 을 남긴 사람이 같은 현재 호 동안 그 섬에 항해해 도착했다·가입이 성립했다(승인제는 승인 시각).
-- 같은 사람의 같은 단계는 한 번만 센다(PK). 핀 행(telescope_pins)은 빼기·만료로 지워지므로 기록은 이 표에 따로 남긴다.
-- 홍보 칸이 지워지면 함께 지워진다. 유저는 익명화만 되고 지워지지 않는다 — 기록판의 숫자라 탈퇴해도 남긴다.
CREATE TABLE island_promotion_funnel (
    promotion_id uuid        NOT NULL REFERENCES island_promotions (id) ON DELETE CASCADE,
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    step         varchar(8)  NOT NULL CHECK (step IN ('PIN', 'ARRIVE', 'JOIN')),
    occurred_at  timestamptz NOT NULL,
    PRIMARY KEY (promotion_id, user_id, step)
);
