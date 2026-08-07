-- GROMO-1220: 탈퇴 유저의 유령 활성 멤버십 백필 (결정 D2).
--
-- 계정 탈퇴(UserService.withdraw)에 그룹 정리(멤버십 leave·OPEN 내기 해제)가 들어가기 전
-- (GROMO-801, PR #497 이전)에 탈퇴한 유저는 users.is_deleted = true 인데도
-- group_members.is_left = false 인 채 남아 있다. 이 유령 멤버십은
--   ① 멤버 목록·공지 권한 뷰에 빈 닉네임(파기됨)으로 뜨고
--   ② 정원(max_members) 한 자리를 영구히 차지하며
--   ③ "다른 활성 멤버 존재" 판정(방장 탈퇴 차단·마지막 1인 종료)을 오염시킨다.
-- #497 이후의 탈퇴는 같은 트랜잭션에서 leave 를 밟으므로(락 규율 #516 포함) 신규 유령은
-- 생기지 않는다 — 이 파일은 배포 이전 데이터의 일회성 정리다.

-- 1) 활성 멤버가 전부 탈퇴 유저뿐인 그룹은 종료(ENDED)한다.
--    UserService.withdraw A-2(솔로 방장 탈퇴 → leave + 그룹 ENDED)·GroupMemberService.withdrawGroup
--    (마지막 1인 이탈 → leave + 그룹 ENDED)과 같은 시맨틱 — 이 탈퇴들이 제때 정리됐다면 마지막
--    이탈이 그룹을 닫았을 것이다. 활성 비탈퇴 멤버가 남는 그룹은 상태를 건드리지 않는다
--    (유령 방장의 소유권 위임은 데이터로 재구성할 수 없어 이 범위 밖 — 멤버십 leave 까지만).
--    2)보다 먼저 실행해야 한다 — 판정 술어가 is_left = false 인 유령 행을 읽는다.
UPDATE groups g
SET status = 'ENDED'
WHERE g.status <> 'ENDED'
  AND EXISTS (
      SELECT 1
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = g.id AND gm.is_left = false AND u.is_deleted = true)
  AND NOT EXISTS (
      SELECT 1
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = g.id AND gm.is_left = false AND u.is_deleted = false);

-- 2) 유령 멤버십을 자진 탈퇴 시맨틱으로 이탈 처리한다.
--    GroupMember.leave() 가 세우는 값 그대로: is_left = true, left_reason = 'LEFT' (V25).
--    KICKED 는 강퇴 전용 사유(재참여 차단)라 쓰지 않는다 — 어차피 탈퇴 계정은 재로그인이 불가해
--    재참여 자체가 성립하지 않는다. 이미 이탈한 행(is_left = true)은 사유(LEFT/KICKED) 불문 보존한다.
UPDATE group_members gm
SET is_left = true,
    left_reason = 'LEFT',
    updated_at = now()
FROM users u
WHERE u.id = gm.user_id
  AND u.is_deleted = true
  AND gm.is_left = false;
