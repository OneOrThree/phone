-- GROMO-1243: 유령 방장 그룹의 소유권 공백 — 최고참 활성 멤버 일회성 승계 백필.
--
-- V30(:16)은 "유령 방장의 소유권 위임은 데이터로 재구성할 수 없어 이 범위 밖 — 멤버십 leave 까지만"
-- 이라고 선을 그었다. 이 파일이 그 후속이다. 데이터 재구성이 아니라 **문서화된 정책 결정**으로 메운다:
-- 오너 결정 — 활성 OWNER 가 없는 살아있는 그룹은 최고참 활성 멤버(가입 시각 오름차순, 동률 시 id
-- 오름차순 — 결정적)가 방장을 승계한다. 이 공백을 방치하면 오너 전용 엔드포인트(챌린지 생성·강퇴·
-- 위임 등 8개)가 영구 403 이 되어 그룹이 산 채로 동결된다.
--
-- 신규 발생 불가(유한·감소 전용 레거시 집합) 근거 4중:
--   ① 그룹 나가기: 방장은 HOST_WITHDRAW 로 차단(GroupMemberService — 위임 후에만 이탈 가능)
--   ② 계정 탈퇴: 방장은 HOST_WITHDRAW 로 차단(UserService — 솔로 방장은 A-2 로 그룹 자동 ENDED)
--   ③ 자기 강퇴 불가(CANNOT_KICK_SELF)
--   ④ 위임×탈퇴 레이스는 #516/#1227 FOR SHARE 락으로 봉인
-- → 대상은 #497 이전 탈퇴 데이터가 V30 을 거치며 남긴 것뿐이며, 이 백필로 소멸한다.
--
-- 유령 방장 행(role='OWNER', is_left=true)은 강등하지 않고 이력으로 보존한다 — 활성 행이 아니라
-- 아래 판정(is_left=false ∧ is_deleted=false)에 잡히지 않는다. 단, 이력 행에 role 을 남기는 것의
-- 유일한 소비처는 감사(과거 방장 추적·백필 이전 상태 복원)임을 명시해 둔다.
--
-- 멱등: 승계 대상 술어(활성 OWNER NOT EXISTS)가 승계 직후 스스로 거짓이 된다. 재실행 시 0행.
-- 데이터 전용 — 스키마 변경 없음. 상시(런타임) 승계 로직은 두지 않는다(일회성 백필).

-- 대상: 삭제되지 않았고 종료되지 않은 그룹 중, 활성(is_left=false ∧ u.is_deleted=false) 멤버가
-- 1명 이상 존재하나 그중 role='OWNER' 가 0명인 그룹. 그룹별 최고참 활성 멤버 1명만 승계한다.
-- GroupMember.promoteToOwner() 와 동일한 값(role='OWNER')으로 세운다.
UPDATE group_members gm
SET role = 'OWNER',
    updated_at = now()
FROM (
    SELECT DISTINCT ON (m.group_id) m.id
    FROM group_members m
    JOIN users u ON u.id = m.user_id
    JOIN groups g ON g.id = m.group_id
    WHERE g.deleted_at IS NULL
      AND g.status <> 'ENDED'
      AND m.is_left = false
      AND u.is_deleted = false
      AND NOT EXISTS (
          SELECT 1
          FROM group_members o
          JOIN users ou ON ou.id = o.user_id
          WHERE o.group_id = m.group_id
            AND o.role = 'OWNER'
            AND o.is_left = false
            AND ou.is_deleted = false)
    ORDER BY m.group_id, m.created_at ASC, m.id ASC
) successor
WHERE gm.id = successor.id;
