-- ════════════════════════════════════════════════════════════════════
-- V86 — 닉네임 대소문자 무시 유일성 (GROMO-1996 · policy-2026-09-14 「친구 관리·우체통 대화」)
-- ════════════════════════════════════════════════════════════════════
-- 정책: 「닉네임은 대소문자를 구분하지 않고 중복될 수 없으며 … 친구 검색은 대소문자를
-- 구분하지 않고 정확히 일치할 때만 결과를 보여 준다.」
--
-- 지금까지는 V1 의 uq_users_nickname(nickname) 이 «정확 일치» 유일성만 걸어 Alice 와 alice 가
-- 둘 다 가입할 수 있었다. 그 상태로 대소문자 무시 «검색»만 켜면 한 질의에 두 사람이 잡혀
-- 「정확히 일치할 때만」이 깨진다 — 검색과 유일성은 같은 축이어야 한다.
--
-- uq_users_nickname 은 그대로 둔다(V1 은 이미 적용된 마이그레이션이라 한 글자도 못 고친다).
-- 아래 인덱스에 포섭되는 중복 제약이지만 해로운 점이 없고, 지우는 쪽이 더 위험하다.
--
-- 탈퇴자는 여기 걸리지 않는다 — withdraw 의 PII 파기가 nickname 을 NULL 로 만들고
-- (UserService.setNickname(null)), Postgres 유니크 인덱스는 NULL 을 서로 다른 값으로 본다.
-- 그래서 partial 조건(WHERE is_deleted = false)을 따로 달 필요가 없다.

-- 인덱스를 거는 순간 기존 충돌 행이 있으면 실패하는데, 그때 Postgres 가 알려 주는 것은
-- 「중복된 키 하나」뿐이다. 충돌이 N 건이면 고치고 재배포하기를 N 번 반복하게 된다.
-- 먼저 전량을 세어 한 번에 알린다 — 이 마이그레이션은 사용자 닉네임을 «고치지 않는다».
-- 무엇을 어떻게 살릴지는 운영 판단이라, 조용히 바꾸는 대신 배포를 멈추고 목록을 내민다.
DO $$
DECLARE
    collisions text;
BEGIN
    SELECT string_agg(duplicated, ', ')
      INTO collisions
      FROM (SELECT lower(nickname) AS duplicated
              FROM users
             WHERE nickname IS NOT NULL
             GROUP BY lower(nickname)
            HAVING count(*) > 1) dups;

    IF collisions IS NOT NULL THEN
        RAISE EXCEPTION
            'GROMO-1996: 대소문자만 다른 닉네임이 이미 있어 유일성을 걸 수 없다. 해소 후 재배포하라 → %',
            collisions;
    END IF;
END $$;

-- 검색 인덱스를 따로 만들지 않는다 — 이 유니크 인덱스가 곧
-- `WHERE lower(nickname) = lower(:q)` 의 인덱스다(B-tree, 표현식 일치).
CREATE UNIQUE INDEX uq_users_nickname_lower ON users (lower(nickname));

COMMENT ON INDEX uq_users_nickname_lower IS
    '닉네임 대소문자 무시 유일성 + 친구 검색(정확 일치) 인덱스 (GROMO-1996). '
    '탈퇴자는 nickname=NULL 이라 걸리지 않는다.';

-- idx_users_nickname_trgm(V1) 은 남겨 둔다. 친구 검색이 전체 일치로 바뀌어 죽은 인덱스가 되지만,
-- 안정화 전에 지우면 되돌릴 길이 없다 — 제거는 별건으로 남긴다. groups.name 의 trgm(V18)은 계속 쓰인다.
