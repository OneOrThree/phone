-- ════════════════════════════════════════════════════════════════════
-- V95 — 기존 닉네임의 앞뒤 공백 제거 (GROMO-2051 · policy-2026-09-14 「친구 관리·우체통 대화」)
-- ════════════════════════════════════════════════════════════════════
-- 정책: 「닉네임은 대소문자를 구분하지 않고 중복될 수 없으며 앞뒤 공백 없이 저장한다.」
--
-- 저장 경로(UserService)가 지금까지 Java 의 trim 을 썼다. trim 은 U+0020 «이하»만 자르므로
-- U+2003(앰 스페이스)처럼 U+0020 보다 큰 공백은 살아남아 그대로 저장됐다. 그러면 V89 의
-- uq_users_nickname_lower 가 ' alice' 와 'alice' 를 서로 다른 키로 보아, 화면에는 같아 보이는
-- 두 계정이 공존한다 — 그 인덱스가 막으려던 「보이기에 같은 이름」이 공백 축으로 열려 있었다.
-- 같은 티켓에서 저장 경로를 strip 으로 옮겼고, 이 마이그레이션은 이미 저장된 행을 맞춘다.
--
-- 스키마는 바꾸지 않는다 — users.nickname 의 «값»만 고친다.
--
-- CHECK 제약을 걸지 않은 이유: 이 컬럼의 writer 는 UserService.changeNickname 하나뿐이고
-- (V48 봇 시드 외에 nickname 을 쓰는 SQL 이 없다), 제약을 추가하면 ACCESS EXCLUSIVE 락으로
-- users 전체를 훑는다. writer 가 여럿으로 갈라지면 그때 CHECK 로 올린다.

DO $$
DECLARE
    -- Java String.strip() 의 공백 정의(Character.isWhitespace)를 그대로 옮긴 문자 집합.
    -- 여기에 «없는» 것이 중요하다 — NBSP(U+00A0) · FIGURE SPACE(U+2007) · NNBSP(U+202F) 는
    -- isWhitespace 가 false 라 Java 가 자르지 않는다. SQL 쪽이 더 넓게 자르면 코드가 저장할 값과
    -- DB 의 값이 다시 갈라진다.
    ws CONSTANT text :=
        '[\u0009-\u000D\u001C-\u0020\u1680\u2000-\u2006\u2008-\u200A\u2028\u2029\u205F\u3000]';
    pattern CONSTANT text := '^(' || ws || ')+|(' || ws || ')+$';
    blanked text;
    collisions text;
    normalized integer;
BEGIN
    -- ① 통째로 공백인 닉네임 — 지우면 빈 문자열이 된다. NULL(탈퇴자 PII 파기)과 달리 빈 문자열은
    -- 유니크 인덱스에 걸리는 «값»이고, 앱의 2~10자 규칙도 만족하지 못한다. 무엇으로 되살릴지는
    -- 운영 판단이라 조용히 NULL 로 바꾸지 않고 멈춘다.
    SELECT string_agg(id::text, ', ')
      INTO blanked
      FROM users
     WHERE nickname IS NOT NULL
       AND regexp_replace(nickname, pattern, '', 'g') = '';

    IF blanked IS NOT NULL THEN
        RAISE EXCEPTION
            'GROMO-2051: 앞뒤 공백을 지우면 빈 닉네임이 되는 행이 있다. 값을 정하고 재배포하라 → %',
            blanked;
    END IF;

    -- ② 정규화가 «새» 충돌을 만드는 경우 — ' Alice' 와 'Alice' 가 지금은 lower(nickname) 이 달라
    -- 공존하지만, 공백을 지우면 같은 키가 되어 uq_users_nickname_lower(V89) 가 거부한다.
    -- V89 와 같은 결로 전량을 세어 한 번에 알린다: 인덱스에 맡기면 「중복된 키 하나」만 나와
    -- 고치고 재배포하기를 충돌 수만큼 반복하게 된다. 누구의 이름을 살릴지는 운영 판단이다.
    SELECT string_agg(duplicated, ', ')
      INTO collisions
      FROM (SELECT lower(regexp_replace(nickname, pattern, '', 'g')) AS duplicated
              FROM users
             WHERE nickname IS NOT NULL
             GROUP BY 1
            HAVING count(*) > 1) dups;

    IF collisions IS NOT NULL THEN
        RAISE EXCEPTION
            'GROMO-2051: 앞뒤 공백을 지우면 대소문자 무시 중복이 되는 닉네임이 있다. 해소 후 재배포하라 → %',
            collisions;
    END IF;

    -- ③ 가드를 모두 통과한 뒤에야 실제로 고친다 (V84 가 쓴 「백필은 가드 뒤」 순서).
    UPDATE users
       SET nickname = regexp_replace(nickname, pattern, '', 'g')
     WHERE nickname IS NOT NULL
       AND nickname <> regexp_replace(nickname, pattern, '', 'g');

    GET DIAGNOSTICS normalized = ROW_COUNT;
    RAISE NOTICE 'GROMO-2051: 닉네임 %건을 앞뒤 공백 없이 정규화했다.', normalized;
END $$;
