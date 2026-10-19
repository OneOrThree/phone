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

-- 잡지 핀이 «어느 홍보 칸에서» 넣었는가 — 망원경 말풍선 미리보기(magazineCell)는 이 칸만 싣는다. 편집부 무료 칸·전망대
-- 핀은 NULL 이다. 넣을 때 그 섬의 현재 호에 보이는 칸인지 확인한 값만 들어가고(PIN 집계와 같은 판정), 이미 있는 핀을 다시
-- 넣어도 출처·넣은 시각처럼 바꾸지 않는다. 칸이 지워지면 핀은 남고 미리보기만 빠진다.
-- ponytail: promotion_id 인덱스 없음 — 칸 삭제(SET NULL)가 핀 표를 훑지만 핀은 사람당 몇 행뿐이다. 커지면 인덱스를 단다.
ALTER TABLE telescope_pins
    ADD COLUMN promotion_id uuid REFERENCES island_promotions (id) ON DELETE SET NULL,
    ADD CONSTRAINT telescope_pins_promotion_source_check CHECK (promotion_id IS NULL OR source = 'magazine');
