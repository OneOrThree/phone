-- GROMO-2050: group_members 에 «이탈 시각»과 «재가입 시각»을 남겨 «과거 시점 소속»을 판정할 수 있게 한다.
--
-- 없던 것은 세 가지였다(GROMO-1997 실측).
--   ① left_at 컬럼 자체가 없었다 — 「그 시점에 주민이었나」를 사후에 물을 근거가 DB 에 없다.
--   ② updated_at 은 @UpdateTimestamp 라 알림 토글 같은 아무 변경에도 갱신된다 — 이탈의 증거가 아니다.
--   ③ created_at 은 rejoin() 이 갱신하지 않아 «현재 멤버십»이 아니라 «최초» 가입 시각이다.
-- 그래서 주간 섬 랭킹의 분모 동결(V85)은 가입 방향만 닫고, 이탈 방향은 크론 실행 유예로 «시간»을 좁히는
-- 데 그쳤다(policy RK-D12). 이 두 컬럼이 그 창을 닫는다.
--
-- «시작 시각»에 created_at 을 쓰지 않고 rejoined_at 을 따로 두는 이유.
--   created_at 은 이미 «행이 생긴 시각»으로 계약이 걸려 있다 — 주민 목록 keyset 페이지네이션의 정렬 축
--   (GroupMemberRepository.findActivePageByGroupId)과 「가장 먼저 가입한 활성 섬 = 메인 섬」 도출
--   (findActiveIslandsJoinedAsc · countActiveJoinedBefore, GROMO-1971)이 그 값으로 순서를 정한다.
--   재가입이 이 값을 갱신하면 주민 목록의 커서 순서와 메인 섬 도출이 조용히 바뀐다 — 읽는 쪽 동작을
--   바꾸지 않기 위해 시작 시각은 COALESCE(rejoined_at, created_at) 로 «덮어쓰기»가 아니라 «덧씌우기»다.
--   NULL = 「재가입한 적 없음」이라 신규 행에 채울 값도, 백필할 값도 없다(빠뜨려서 조용히 틀릴 자리가
--   아예 생기지 않는다).
--
-- 백필하지 않는다 — 근거 없는 값을 지어내지 않는다(GROMO-1995 가 loss_reason 에서 내린 같은 판단).
--   · 이미 이탈한 행(is_left = true)의 left_at 은 NULL 로 둔다. 관찰 가능한 근거가 없다 —
--     updated_at 은 위 ②의 이유로 이탈 시각이 아니고, V30 백필로 일괄 이탈된 행은 더더욱 아니다.
--     그 행들은 「어느 경계에서도 주민이 아니었다」로 판정된다. 동결은 이 마이그레이션 이후의 주부터
--     도는 앞방향 배치라 실제로 손해 보는 주가 없다.
--   · 재가입한 적 있는 legacy 행의 rejoined_at 도 NULL 이다 — 되살린 시각이 어디에도 남지 않았다.
--     NULL 이면 시작 시각은 created_at 이고, 그것이 종전(V85) 동작과 정확히 같다.
ALTER TABLE group_members
    ADD COLUMN left_at     timestamptz,
    ADD COLUMN rejoined_at timestamptz;

COMMENT ON COLUMN group_members.left_at IS
    '이탈 시각 — 자진 탈퇴·강퇴·계정 탈퇴가 모두 찍는다(GroupMember.leave/kick). is_left=false 면 항상 NULL '
    '(rejoin 이 비운다). V97 이전에 이탈한 행은 근거가 없어 NULL 이다. GROMO-2050';
COMMENT ON COLUMN group_members.rejoined_at IS
    '재가입으로 멤버십이 다시 시작된 시각(GroupMember.rejoin). NULL 이면 최초 가입 그대로라 시작 시각은 '
    'created_at 이다 — 과거 시점 소속 판정의 시작 축은 COALESCE(rejoined_at, created_at). GROMO-2050';
