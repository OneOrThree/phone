package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupInvite;
import com.oneorthree.phone.group.repository.domain.GroupInviteStatus;
import com.oneorthree.phone.user.repository.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 미사용 — 유저 직접 초대 기능을 접었고, 참여는 초대 링크(groupId)가 담당한다(2026-07-31).
 * 서비스·컨트롤러 참조 0건. 삭제하지 않는 이유는 참가 코드 체계와 같다(잔존 비용 &lt; 삭제 비용).
 */
public interface GroupInviteRepository extends JpaRepository<GroupInvite, UUID> {

    /**
     * 받은 초대함 — 피초대자 기준으로 특정 상태의 초대를 훑던 조회. 호출부가 없다.
     *
     * @param invitee 초대를 받은 유저(초대한 쪽이 아니다)
     * @param status 걸러낼 상태 — 초대함 화면은 {@code PENDING} 만 봤다
     * @return 조건에 맞는 초대들. 정렬이 없어 순서는 보장되지 않는다. 초대가 없으면 빈 리스트
     */
    List<GroupInvite> findByInviteeAndStatus(User invitee, GroupInviteStatus status);

    /**
     * 같은 그룹·같은 대상에 초대가 이미 있는지 — 중복 초대를 막던 조회. 호출부가 없다.
     *
     * @param group 초대를 보내는 그룹
     * @param invitee 초대 대상 유저
     * @return 상태와 무관한 기존 초대 1건. 거절·수락된 과거 초대도 그대로 걸리므로 재초대 판단은
     *     호출측이 상태를 다시 봐야 했다
     */
    Optional<GroupInvite> findByGroupAndInvitee(Group group, User invitee);
}
