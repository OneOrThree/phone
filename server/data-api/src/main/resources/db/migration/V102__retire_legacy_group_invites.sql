-- GROMO-2070 · 미사용 초대 코드(group_join_codes)·직접 초대(group_invites) 테이블 제거
--
-- 참여 경로는 초대 링크(group_invite_links, GROMO-1760 계열)가 담당하고, 두 테이블의 런타임
-- 읽기·쓰기는 엔티티/리포지토리 삭제로 이미 0건이다. 운영 데이터 보존 없이 DROP 한다 —
-- group_invites 는 2026-07-31 유저 직접 초대 종료 이후 신규 행이 없고, group_join_codes 의
-- 코드는 조회 경로가 없어 발급만 되던 잔존 데이터다.
--
-- 두 테이블을 참조하는 인바운드 FK 는 없다(마이그레이션 전량 검색). DROP 이 자기 CHECK·
-- outbounds FK 까지 함께 정리한다.

DROP TABLE IF EXISTS group_join_codes;
DROP TABLE IF EXISTS group_invites;
