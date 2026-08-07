package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupMemberService {

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserRepository userRepository;
    private final UserActivityEventLogger userActivityEventLogger;
    private final GroupBetService groupBetService;

    @Transactional
    public void transferOwner(UUID groupId, UUID targetUserId, UUID userId) {
        // 요청자도 공유 락 (GROMO-1227) — 801 은 아래 대상만 고치고 요청자를 놓쳤다. 락 없는
        // findById 면 요청자 본인의 계정 탈퇴와 직렬화되지 않아, 탈퇴가 오너 검사를 통과한 뒤에
        // 이 위임이 끼면 탈퇴 확정 계정이 마지막 오너 권한 행사를 한 상태가 남는다.
        User user = requireActiveUser(userId);

        // 위임 대상은 활성 검증 + 공유 락 (GROMO-801, codex 리뷰) — 락 없는 findById 면 대상의 계정
        // 탈퇴(유저 행 배타 락)와 직렬화되지 않는다. 탈퇴가 owner 검사·멤버십 leave 를 끝낸 뒤 이
        // 위임이 flush 되면 GroupMember 에 @Version 이 없어 full-row UPDATE 가 is_left=false 를
        // 되살리며 role=OWNER 를 세워, 탈퇴한 유저가 오너인(그리고 전 오너는 이미 강등된) 그룹이
        // 남는다. 탈퇴가 먼저 커밋되면 여기서 삭제를 관측하고 기존 계약대로 NOT_FOUND 로 거절된다.
        User targetUser = userRepository.findActiveByIdForShare(targetUserId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        GroupMember hostGroupMember = groupMemberRepository.findByUserAndGroup(user, group)
                .filter(m -> m.getRole() == GroupMemberRole.OWNER)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_OWNER));

        GroupMember targetGroupMember = groupMemberRepository.findByUserAndGroup(targetUser, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // GROMO-676: groups.host_id 폐기 — 방장 이양은 group_members.role 교체(OWNER↔MEMBER)로만 수행한다.
        hostGroupMember.demoteToMember();
        targetGroupMember.promoteToOwner();
    }

    /** 멤버 강퇴 (A-3) — OWNER 전용. 소프트삭제 + KICKED 마커로 재참여를 막는다. 본인은 강퇴 불가. */
    @Transactional
    public void kickMember(UUID groupId, UUID targetUserId, UUID userId) {
        // 요청자 공유 락 (GROMO-1227) — 근거는 requireActiveUser Javadoc.
        User user = requireActiveUser(userId);

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // 요청자는 활성 OWNER 여야 한다
        groupMemberRepository.findByUserAndGroup(user, group)
                .filter(m -> m.getRole() == GroupMemberRole.OWNER)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_OWNER));

        // 본인 강퇴 불가 — 방장은 위임 후 탈퇴, 멤버는 나가기를 쓴다
        if (userId.equals(targetUserId)) {
            throw new GroupException(GroupErrorCode.CANNOT_KICK_SELF);
        }

        // 강퇴 대상도 활성 검증 + 공유 락 (GROMO-1227) — 위 transferOwner 대상과 같은 논증이다.
        // GroupMember 에 @Version 이 없어 kick() 의 full-row UPDATE 가, 대상의 계정 탈퇴가 같은
        // 행에 이미 flush 한 변경(leave)을 stale 스냅샷으로 덮어쓴다(lost update). 탈퇴가 먼저
        // 커밋되면 여기서 삭제를 관측하고 기존 계약대로 NOT_FOUND 로 거절된다.
        User targetUser = userRepository.findActiveByIdForShare(targetUserId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        GroupMember target = groupMemberRepository.findByUserAndGroup(targetUser, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // 강퇴 마킹. 진행 중 내기 판돈은 건드리지 않는다(지갑 생존 → 정산 시 정상 지급/환불, 엔진 무변경).
        target.kick();
        userActivityEventLogger.log(UserActivityEvent.GROUP_LEFT, Map.of("group_id", group.getId().toString()));
    }

    @Transactional
    public void withdrawGroup(UUID groupId, UUID userId) {
        // 요청자 공유 락 (GROMO-1227) — 특히 이 경로는 아래 releaseFromOpenBets(환불·돈 경로)에
        // 이 User 를 그대로 밀어넣는다. 락 없는 stale User 면 내기 참가 정리(#503)가 계정 탈퇴와
        // 직렬화되지 않아, 막아둔 구멍을 옆문으로 다시 여는 셈이다.
        User user = requireActiveUser(userId);
        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        GroupMember groupMember = groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        // A-0 소프트삭제: 행을 지우지 않고 이탈 마킹(leave). findByGroup 은 활성만 세므로 마지막 1인 판정 유지.
        List<GroupMember> groupMembers = groupMemberRepository.findByGroup(group);
        if (groupMembers.size() > 1 && groupMember.getRole() == GroupMemberRole.OWNER) {
            throw new GroupException(GroupErrorCode.HOST_WITHDRAW);
        }

        // 탈퇴가 확정된 뒤, 같은 트랜잭션에서 OPEN 내기부터 정리한다(참가 해제·환불·자동 취소).
        // 별도 트랜잭션이면 "탈퇴는 됐는데 판돈은 묶인" 반쪽 상태가 생길 수 있다.
        groupBetService.releaseFromOpenBets(user, group);

        if (groupMembers.size() == 1) {
            groupMember.leave();
            group.close();
        } else if (groupMember.getRole() == GroupMemberRole.MEMBER) {
            groupMember.leave();
        }
        userActivityEventLogger.log(UserActivityEvent.GROUP_LEFT, Map.of("group_id", group.getId().toString()));
    }

    /**
     * 활성 검증 + 공유 락 + 게스트 차단 (GROMO-801 락 규율, GROMO-1227) — 위임·강퇴·그룹 탈퇴처럼
     * users 행을 <b>읽기만 하고</b> 그 값을 멤버십 변경의 근거로 쓰는 트랜잭션의 요청자 로드.
     * 락 없는 findById 는 계정 탈퇴(UserService.withdraw, 유저 행 배타 락)와 직렬화되지 않아
     * 탈퇴의 정리 스캔 이후·커밋 이전에 낀 변경이 유령 상태로 남는다. 공유 락끼리는 충돌하지
     * 않아 동시 요청은 그대로 병렬이고, 탈퇴가 먼저 커밋되면 is_deleted=true 를 보고
     * NOT_FOUND(404) 로 거절된다. 게스트는 GUEST_FORBIDDEN(403).
     *
     * <p><b>readOnly 조회 메서드에서는 쓰지 말 것</b> — 이 클래스 기본 트랜잭션이
     * {@code @Transactional(readOnly = true)} 라 Postgres 가 FOR SHARE 를 거절한다
     * (read-only 에서 행 잠금 불가 — {@code GroupBetService.getBetHistory} 주석 참조).
     * 메서드 레벨 {@code @Transactional} 로 쓰기 트랜잭션을 연 변경 경로 전용이다.
     */
    private User requireActiveUser(UUID userId) {
        User user = userRepository.findActiveByIdForShare(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }
        return user;
    }
}
