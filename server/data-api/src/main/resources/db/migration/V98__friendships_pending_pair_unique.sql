-- ════════════════════════════════════════════════════════════════════
-- V98 — 살아 있는 친구 «요청»은 두 사람당 한 건 (GROMO-2042)
-- ════════════════════════════════════════════════════════════════════
-- V1 의 ukcw1b2t1f9600yhvikefbpd1gn(from_user_id, to_user_id) 은 «같은 방향»만 막는다.
-- 그래서 A→B 와 B→A 가 동시에 들어오면 둘 다 FriendService.createRequest 의 findPair 판정에서
-- 「기존 행 없음」을 보고 PENDING 행을 하나씩 넣는다. 한쪽이 수락되면 나머지 한 행이 PENDING 인 채
-- 남아 보낸 요청 목록·배지에 영영 떠 있는 유령이 된다.
--
-- 그 판정을 「두 users 행에 배타 락」으로 직렬화하지 않고 여기서 제약으로 막는 이유:
--   ① 아직 «행이 없을 때» 나는 경합이라 잠글 관계 행이 없다. 남는 후보는 users 두 행인데,
--      방향마다 잠금 순서가 달라 새 교착을 만든다 — 막으려면 「userId 오름차순」 같은 순서 규칙을
--      «같은 쌍을 잡는 모든 경로»가 지켜야 하고, 그 규칙을 어긴 경로는 부하가 걸린 운영에서
--      교착 500 으로만 드러난다(조용한 실패).
--   ② 친구 «요청» 하나가 상대의 users 행을 배타로 잡으면 상대의 프로필 수정·닉네임 변경·탈퇴가
--      줄을 선다 — 관계없는 도메인까지 직렬화된다.
--   ③ 유니크 인덱스는 순서 규칙이 필요 없고, 지는 쪽이 결정적으로 409 로 떨어진다
--      (GlobalExceptionHandler.handleDataIntegrityViolation — warn 로그까지 남는다).
--
-- 범위를 PENDING 으로 좁힌 것도 의도다. 이 술어는 createRequest 가 «이미» 앱에서 강제하는 불변식
-- (살아 있는 PENDING 은 쌍당 하나)을 그대로 옮긴 것이라, 순차 경로에서 지금 되는 일은 하나도 막지
-- 않는다. ACCEPTED 까지 넣으면 「거절했던 요청을 뒤늦게 수락」(FriendService.acceptRequest 의 전 상태
-- 관용)이 반대 방향 PENDING 과 겹치는 기존 시나리오가 제약 위반으로 바뀐다 — 이번 경합과 무관한
-- 경로를 새로 깨는 셈이라 손대지 않는다.
--
-- deleted_at IS NULL 이 필요한 이유: 소프트 삭제된 행은 createRequest 의 복원 분기(GROMO-719)가
-- 되살릴 대상일 뿐 살아 있는 요청이 아니다. 복원이 deleted_at 을 지우는 순간 이 인덱스에 들어온다.

-- 인덱스를 거는 순간 기존 위반 행이 있으면 실패하는데, Postgres 가 알려 주는 것은 「중복 키 하나」뿐이라
-- 고치고 재배포하기를 N 번 반복하게 된다. 먼저 전량을 세어 한 번에 알린다 — 이 마이그레이션은
-- 기존 요청을 «지우지 않는다». 어느 방향을 살릴지는 운영 판단이라 조용히 고치는 대신 배포를 멈춘다
-- (V89 와 같은 결).
DO $$
DECLARE
    collision_count integer;
    collisions text;
BEGIN
    SELECT count(*), string_agg(pair, ', ')
      INTO collision_count, collisions
      FROM (SELECT least(from_user_id, to_user_id)::text
                   || ' <-> ' || greatest(from_user_id, to_user_id)::text AS pair
              FROM friendships
             WHERE status = 'PENDING'
               AND deleted_at IS NULL
             GROUP BY least(from_user_id, to_user_id), greatest(from_user_id, to_user_id)
            HAVING count(*) > 1) dups;

    IF collision_count > 0 THEN
        RAISE EXCEPTION
            'GROMO-2042: 양방향 PENDING 요청이 이미 %건 쌍에 남아 있어 유일성을 걸 수 없다. '
            '한쪽을 CANCELED 로 마감한 뒤 재배포하라 → %',
            collision_count, collisions;
    END IF;
END $$;

CREATE UNIQUE INDEX uq_friendships_pending_pair
    ON friendships (least(from_user_id, to_user_id), greatest(from_user_id, to_user_id))
    WHERE status = 'PENDING' AND deleted_at IS NULL;

COMMENT ON INDEX uq_friendships_pending_pair IS
    '살아 있는 PENDING 요청은 두 사람당 한 건 (GROMO-2042). 방향 무관 — A→B 와 B→A 동시 요청의 '
    '마지막 방어선이다. 같은 방향 중복은 V1 의 unique(from_user_id, to_user_id) 가 막는다.';
