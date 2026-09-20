-- ════════════════════════════════════════════════════════════════════
-- V81 — 메인 섬 (GROMO-1971 · 계정 «메인 섬» 속성)
-- ════════════════════════════════════════════════════════════════════
-- ① 메인 섬은 «지금 접속해 있는 섬»(user_island_contexts.current_island_id)과 **다른 축**이다.
--    현재 섬은 이동할 때마다 바뀌는 위치이고, 메인 섬은 「내 대표 섬」이라 친구 목록에도 노출된다.
--    한 컬럼으로 합치면 섬을 잠깐 구경하러 옮긴 것만으로 대표 섬이 바뀐다 — 그래서 별도 테이블이다.
--
--    users 컬럼이 아니라 테이블인 이유는 users 엔티티에 @Version 도 @DynamicUpdate 도 없어서다
--    (User 클래스 주석). 이탈·강퇴·계정탈퇴가 같은 트랜잭션에서 메인 섬을 옮기는데, 그 갱신을
--    users 행의 더티 체킹에 맡기면 전 컬럼 UPDATE 가 나가 같은 TX 의 PII 파기(탈퇴)와 순서를 다툰다.
--    자기 행을 가지면 그 다툼 자체가 없다.
--
--    행이 없으면 «아직 고른 적 없음» 이고, 그때의 메인 섬은 가장 먼저 가입한 활성 섬으로 도출한다
--    (MainIslandService). 그래서 백필이 필요 없다 — 기존 주민도 첫 가입 섬이 그대로 메인 섬이 된다.
CREATE TABLE user_main_islands (
    -- ON DELETE CASCADE: user_island_contexts(V57) 와 같은 이유다 — 유저에 종속된 1:1 행이라
    -- 유저가 사라지면 남을 이유가 없고, 통합 테스트의 정리 단계가 users 를 하드 삭제한다.
    user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    -- ON DELETE CASCADE: 섬 행이 사라지면 그 섬을 대표로 둔 행도 함께 사라진다. SET NULL 이 아닌 이유는
    -- 「행 없음 = 도출」이 이 테이블의 계약이라 NULL 자리를 둘 수 없기 때문이다(그래서 NOT NULL 이다).
    island_id  uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz
);

COMMENT ON TABLE user_main_islands IS
    '사용자가 고른 메인 섬(users 1:1) — 행이 없으면 가장 먼저 가입한 활성 섬으로 도출한다. '
    '현재 섬(user_island_contexts.current_island_id)과 다른 축이다. GROMO-1971, V81';

COMMENT ON COLUMN user_main_islands.island_id IS
    '메인 섬 groups.id — 이 행이 있는 동안 사용자는 그 섬의 활성 주민이다(이탈·강퇴·탈퇴가 같은 TX 에서 옮기거나 지운다). GROMO-1971';
