-- ════════════════════════════════════════════════════════════════════
-- V80 — users.cat_color + outbox SCORE 대상 (GROMO-1945 · 계정 Q03/Q04 2026-09-19 결정)
-- ════════════════════════════════════════════════════════════════════
-- ① 고양이 색. 값은 앱 2.0 카탈로그(app/app-dev/src/services/model.ts 의 colors) 6종 그대로다.
--    NULL = 아직 고르지 않음(온보딩 전). 기존 행은 백필하지 않는다 — A24 로 1.x 데이터는 이관하지 않고,
--    남아 있는 행은 온보딩을 다시 거쳐 색을 고른다(Q03). 색이 늘면 이 CHECK 와 두 서버의 카탈로그를 함께 늘린다.
ALTER TABLE users ADD COLUMN cat_color varchar(16);
ALTER TABLE users ADD CONSTRAINT ck_users_cat_color
    CHECK (cat_color IN ('black', 'ginger', 'cream', 'gray', 'white', 'calico'));

COMMENT ON COLUMN users.cat_color IS
    '고양이 색 자산 ID(black·ginger·cream·gray·white·calico). NULL=미선택(온보딩 전). 탈퇴 시 파기. GROMO-1945 Q03, V80';

-- ② user.onboarded 는 랭킹 적격성 계약(㊣)이라 score-events 로 가야 한다. 랭킹 소비자·transport 가 아직 없어
--    알림/realtime 전송에 섞지 않고 전용 대상으로 내구 보류한다(V56 과 같은 방식).
ALTER TABLE event_outbox_deliveries
    DROP CONSTRAINT event_outbox_deliveries_target_check;
ALTER TABLE event_outbox_deliveries
    ADD CONSTRAINT event_outbox_deliveries_target_check
    CHECK (target IN ('KAFKA', 'LINK', 'NOTI', 'REALTIME', 'SCORE'));
