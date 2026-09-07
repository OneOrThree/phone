package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 그룹 멤버십을 <b>바꾸는</b> 경로 — 방장 위임·강퇴·그룹 탈퇴. 조회는 {@code GroupService} 가 맡는다.
 *
 * <p>세 경로 모두 요청자(대상이 있으면 대상까지) users 행을 공유 락으로 읽는다. 계정 탈퇴와
 * 직렬화되지 않으면 탈퇴 확정 계정이 방장을 넘겨받거나, {@code GroupMember} 에 {@code @Version}
 * 이 없어 탈퇴가 쓴 이탈 표시를 이 트랜잭션의 full-row UPDATE 가 통째로 되살린다.
 *
 * <p>404 가 두 버킷으로 갈린다 — 요청자 세션이 죽었으면 {@code USER_NOT_FOUND}(재로그인),
 * 지목한 <b>대상</b>이 없으면 {@code NOT_FOUND} 다. 대상 부재를 전자로 바꾸면 앱이 멀쩡한 방장을
 * 로그아웃시킨다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupMemberService {

    private final GroupMemberRepository groupMemberRepository;
    private final GroupQueryService groupQueryService;
    private final UserQueryService userQueryService;
    private final UserActivityEventLogger userActivityEventLogger;
    private final GroupBetService groupBetService;

    /**
     * 방장을 넘긴다 — 대상이 OWNER 로 오르고 요청자는 같은 트랜잭션에서 MEMBER 로 내려온다.
     *
     * <p>{@code groups.host_id} 는 폐기됐고 {@code group_members.role} 교체가 유일한 정본이다.
     * 대상이 이 그룹 멤버가 아니거나 이미 탈퇴했으면 {@code NOT_FOUND} 로 거절한다.
     *
     * @param groupId 위임이 일어날 그룹
     * @param targetUserId 새 방장이 될 멤버
     * @param userId 요청자 — 현재 방장이 아니면 {@code NOT_OWNER}
     */
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
        //
        // GROMO-1247: 여기는 <b>대상</b> 유저라 USER_NOT_FOUND(요청자 세션 사망 → 재로그인)로 바꾸지
        // 않는다. 방장이 없는 유저를 지목한 것이지 내 세션이 죽은 게 아니다 — 바꾸면 앱이 멀쩡한
        // 방장을 로그아웃시킨다. 바로 아래 멤버십 조회의 GroupErrorCode.NOT_FOUND 와 같은 버킷
        // ("지목한 대상이 없다")이고, 둘 다 code 문자열 "NOT_FOUND" 로 나가 앱 분기가 일치한다.
        User targetUser = userQueryService.getTargetForShare(targetUserId);

        Group group = groupQueryService.getGroup(groupId);

        GroupMember hostGroupMember = groupQueryService.findMembership(user, group)
                .filter(m -> m.getRole() == GroupMemberRole.OWNER)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_OWNER));

        GroupMember targetGroupMember = groupQueryService.findMembership(targetUser, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // GROMO-676: groups.host_id 폐기 — 방장 이양은 group_members.role 교체(OWNER↔MEMBER)로만 수행한다.
        hostGroupMember.demoteToMember();
        targetGroupMember.promoteToOwner();
    }

    /**
     * 멤버 강퇴 (A-3) — OWNER 전용. 소프트삭제 + KICKED 마커로 재참여를 막는다. 본인은 강퇴 불가.
     *
     * @param groupId 강퇴가 일어날 그룹
     * @param targetUserId 내보낼 멤버 — 자기 자신을 지목하면 {@code CANNOT_KICK_SELF}
     * @param userId 요청자 — 현재 방장이 아니면 {@code NOT_OWNER}
     */
    @Transactional
    public void kickMember(UUID groupId, UUID targetUserId, UUID userId) {
        // 요청자 공유 락 (GROMO-1227) — 근거는 requireActiveUser Javadoc.
        User user = requireActiveUser(userId);

        Group group = groupQueryService.getGroup(groupId);

        // 요청자는 활성 OWNER 여야 한다
        groupQueryService.findMembership(user, group)
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
        // GROMO-1247: transferOwner 대상과 같은 이유로 USER_NOT_FOUND 로 바꾸지 않는다(대상 유저다).
        User targetUser = userQueryService.getTargetForShare(targetUserId);
        GroupMember target = groupQueryService.findMembership(targetUser, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // 강퇴 마킹. 진행 중 내기 판돈은 건드리지 않는다(지갑 생존 → 정산 시 정상 지급/환불, 엔진 무변경).
        target.kick();
        userActivityEventLogger.log(UserActivityEvent.GROUP_LEFT, Map.of("group_id", group.getId().toString()));
    }

    /**
     * 그룹에서 나간다 — 행을 지우지 않고 이탈로 마킹한다(A-0 소프트삭제).
     *
     * <p>순서가 계약이다: 이탈이 확정된 뒤 <b>같은 트랜잭션에서</b> OPEN 내기 참가를 정리해 판돈을
     * 환불한다. 별도 트랜잭션으로 미루면 「탈퇴는 됐는데 판돈은 묶인」 반쪽 상태가 남는다.
     * 멤버가 둘 이상인데 요청자가 방장이면 {@code HOST_WITHDRAW} 로 막고(위임이 먼저),
     * 마지막 1인이 나가면 그룹까지 닫는다.
     *
     * @param groupId 나갈 그룹
     * @param userId 요청자 — 그룹원이 아니면 {@code MEMBER_ONLY}
     */
    @Transactional
    public void withdrawGroup(UUID groupId, UUID userId) {
        // 요청자 공유 락 (GROMO-1227) — 특히 이 경로는 아래 releaseFromOpenBets(환불·돈 경로)에
        // 이 User 를 그대로 밀어넣는다. 락 없는 stale User 면 내기 참가 정리(#503)가 계정 탈퇴와
        // 직렬화되지 않아, 막아둔 구멍을 옆문으로 다시 여는 셈이다.
        User user = requireActiveUser(userId);
        Group group = groupQueryService.getGroup(groupId);
        GroupMember groupMember = groupQueryService.requireMember(user, group);

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
     * 활성 검증 + 공유 락 (GROMO-801 락 규율, GROMO-1227) — 위임·강퇴·그룹 탈퇴처럼
     * users 행을 <b>읽기만 하고</b> 그 값을 멤버십 변경의 근거로 쓰는 트랜잭션의 요청자 로드.
     * 락 없는 findById 는 계정 탈퇴(UserService.withdraw, 유저 행 배타 락)와 직렬화되지 않아
     * 탈퇴의 정리 스캔 이후·커밋 이전에 낀 변경이 유령 상태로 남는다. 공유 락끼리는 충돌하지
     * 않아 동시 요청은 그대로 병렬이고, 탈퇴가 먼저 커밋되면 is_deleted=true 를 보고
     * USER_NOT_FOUND(404) 로 거절된다 — 그룹·대상 멤버 부재(NOT_FOUND)와 구분되는 <b>요청자 세션</b>
     * 전용 코드다(GROMO-1247). 게스트도 소셜 로그인 유저와 동일하게 통과한다(GROMO-1509).
     *
     * <p><b>readOnly 조회 메서드에서는 쓰지 말 것</b> — 이 클래스 기본 트랜잭션이
     * {@code @Transactional(readOnly = true)} 라 Postgres 가 FOR SHARE 를 거절한다
     * (read-only 에서 행 잠금 불가 — {@code GroupBetService.getBetHistory} 주석 참조).
     * 메서드 레벨 {@code @Transactional} 로 쓰기 트랜잭션을 연 변경 경로 전용이다.
     */
    private User requireActiveUser(UUID userId) {
        return userQueryService.getCallerForShare(userId);
    }
}
