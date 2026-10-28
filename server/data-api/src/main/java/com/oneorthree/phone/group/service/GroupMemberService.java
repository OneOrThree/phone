package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.common.port.IslandPurgePort;
import com.oneorthree.phone.focus.service.FocusMembershipLossService;
import com.oneorthree.phone.group.event.IslandKickedEvent;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupAnnouncementCommentRepository;
import com.oneorthree.phone.group.repository.GroupAnnouncementRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.IslandArrivalRepository;
import com.oneorthree.phone.group.repository.IslandGuestbookEntryRepository;
import com.oneorthree.phone.group.repository.IslandJoinRequestRepository;
import com.oneorthree.phone.group.repository.TelescopeBucketRepository;
import com.oneorthree.phone.group.repository.OnboardingIslandRepository;
import com.oneorthree.phone.group.repository.TelescopePinRepository;
import com.oneorthree.phone.group.repository.domain.IslandJoinRequest;
import com.oneorthree.phone.group.repository.domain.IslandJoinRequestStatus;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 그룹 멤버십을 <b>바꾸는</b> 경로 — 방장 위임·강퇴·그룹 탈퇴. 멤버십 조회는 {@code GroupQueryService} 가 맡는다.
 *
 * <p>세 경로 모두 요청자(대상이 있으면 대상까지) users 행을 공유 락으로 읽는다. 계정 탈퇴와
 * 직렬화되지 않으면 탈퇴 확정 계정이 방장을 넘겨받을 수 있다. 변경 컬럼만 저장하더라도
 * 활성 계정 판정과 권한 변경의 순서는 이 공유 락으로 계속 보장해야 한다.
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
    private final GroupRepository groupRepository;
    private final GroupQueryService groupQueryService;
    private final UserQueryService userQueryService;
    private final UserActivityEventLogger userActivityEventLogger;
    private final GroupMembershipMutationLocks membershipLocks;
    private final IslandMembershipEvents membershipEvents;
    /** 멤버십 세대를 갱신하고 소속 상실에 따른 대표 섬과 현재 섬을 같은 트랜잭션에서 복구한다. */
    private final IslandMembershipTransitions membershipTransitions;
    private final GroupAnnouncementRepository groupAnnouncementRepository;
    private final GroupAnnouncementCommentRepository groupAnnouncementCommentRepository;
    private final IslandGuestbookEntryRepository guestbookEntryRepository;
    private final IslandJoinRequestRepository joinRequestRepository;
    private final IslandArrivalRepository islandArrivalRepository;
    private final IslandArrivalEvents islandArrivalEvents;
    private final TelescopePinRepository telescopePinRepository;
    private final TelescopeBucketRepository telescopeBucketRepository;
    private final OnboardingIslandRepository onboardingIslandRepository;
    private final IslandJoinRequestEvents joinRequestEvents;
    /**
     * 탈퇴자의 댓글 벌크 삭제도 다른 공지·댓글 writer 와 같은 축으로 {@code notice.updated} 를 낸다
     * (GROMO-2137 코드리뷰 대응) — {@link #eraseWithdrawnUserRecords} 참조.
     */
    private final IslandNoticeEvents noticeEvents;
    /**
     * 소속 상실과 진행 집중 세션의 연결 (GROMO-1924, FR-D03) — 강퇴는 종결, 자진 탈퇴는 거절.
     * 멤버십을 바꾸는 이 클래스의 잠금 아래에서 부른다.
     */
    private final FocusMembershipLossService focusMembershipLossService;
    private final IslandStateEvents islandStateEvents;
    /**
     * 섬이 닫히면 공동 데이터도 함께 지운다 (GROMO-1995, 정책 「섬 삭제 시 … 함께 삭제한다」).
     * 지울 대상이 construction·appearance·quest·shop 소유라 호출을 포트로 뒤집는다 — 구현은 L10 이다.
     */
    private final IslandPurgePort islandPurge;
    /** 강퇴 알림 사건(GROMO-2315) — 알림 리스너가 같은 트랜잭션에서 outbox에 기록한다. */
    private final ApplicationEventPublisher events;
    /**
     * 이탈 시각을 찍는 시계 (GROMO-2050) — Hibernate 의 {@code @UpdateTimestamp} 를 쓰지 않는 이유는
     * {@code GroupMember.leftAt} Javadoc 에 있다(애너테이션은 주입 {@link Clock} 을 타지 않는다).
     */
    private final Clock clock;

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
        transferOwnerAndRecord(groupId, targetUserId, userId);
    }

    /** 새 내부 명령도 기존 역할 전이를 공유하며 봉투는 receipt에 같은 TX로 보존한다. */
    @Transactional
    public EventEnvelope transferOwnerAndRecord(UUID groupId, UUID targetUserId, UUID userId) {
        var locked = GroupMemberUserLocks.lock(userQueryService, userId, targetUserId);
        User user = locked.caller();
        User targetUser = locked.requireTarget();
        membershipLocks.lockGroup(groupId);
        membershipLocks.lockMembers(groupId, List.of(userId, targetUserId));
        Group group = groupQueryService.getGroup(groupId);
        GroupMember hostGroupMember = groupQueryService.findMembership(user, group)
                .filter(m -> m.getRole() == GroupMemberRole.OWNER)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_OWNER));
        GroupMember targetGroupMember = groupQueryService.findMembership(targetUser, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        // 기존 자기 위임은 상태 변화 없는 성공이다. 신규 공개 명령은 별도409로 거절한다.
        if (userId.equals(targetUserId)) {
            return null;
        }
        hostGroupMember.demoteToMember();
        targetGroupMember.promoteToOwner();
        return membershipEvents.transferred(groupId, userId, targetUserId);
    }

    /**
     * 멤버 강퇴 (A-3) — OWNER 전용. 소프트삭제 + KICKED 마커. 본인은 강퇴 불가. 다시 들어오려면 섬장 승인을 거친다
     * (GROMO-2315 — 가입 신청이 pending 이 된다).
     *
     * <p>대상이 이 섬에서 집중·휴식 중이면 <b>같은 트랜잭션·같은 잠금 아래</b> 그 세션을 서버 시각으로
     * 종결한다 — 2026-09-18 결정 FR-D03(B1 「강제 종료, 미정산」, GROMO-1924). 섬 강퇴 표면이 늘어나도
     * 이 메서드를 거치면 같은 종결을 얻는다.
     *
     * @param groupId 강퇴가 일어날 그룹
     * @param targetUserId 내보낼 멤버 — 자기 자신을 지목하면 {@code CANNOT_KICK_SELF}
     * @param userId 요청자 — 현재 방장이 아니면 {@code NOT_OWNER}
     */
    @Transactional
    public void kickMember(UUID groupId, UUID targetUserId, UUID userId) {
        kickMemberAndRecord(groupId, targetUserId, userId);
    }

    /**
     * 강퇴하고 주민 목록 사건을 돌려준다 (GROMO-1802) — 새 공개 명령이 그 봉투를 receipt 에 함께 저장해
     * 재생이 같은 결과를 재현한다. 판정·잠금·마킹은 {@link #kickMember} 와 한 경로다.
     *
     * @return 이 강퇴로 발행한 {@code island.members.updated} 봉투
     */
    @Transactional
    public EventEnvelope kickMemberAndRecord(UUID groupId, UUID targetUserId, UUID userId) {
        // 요청자 공유 락 (GROMO-1227) — 근거는 requireActiveUser Javadoc.
        var locked = GroupMemberUserLocks.lock(userQueryService, userId, targetUserId);
        User user = locked.caller();
        membershipLocks.lockGroup(groupId);
        membershipLocks.lockMembers(groupId, List.of(userId, targetUserId));

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
        // kick()과 계정 탈퇴의 leave()는 같은 이탈 사유를 바꾸므로 변경 컬럼만 저장해도 경합한다. 탈퇴가 먼저
        // 커밋되면 여기서 삭제를 관측하고 TARGET_USER_NOT_FOUND 로 거절된다(GROMO-1725).
        // GROMO-1247: transferOwner 대상과 같은 이유로 USER_NOT_FOUND 로 바꾸지 않는다(대상 유저다).
        User targetUser = locked.requireTarget();
        // 멤버십 행을 먼저 잠가 강퇴와 소속 복구를 같은 전이로 반영한다.
        GroupMember target = groupMemberRepository.findActiveByUserIdAndGroupIdForUpdate(
                        targetUser.getId(), group.getId())
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // 강퇴와 집중 종료를 같은 트랜잭션에 반영한다.
        target.kick(clock.instant());
        // FR-D03 — 멤버십 배타 잠금을 쥔 채 종결한다. 전이(pause/resume/finish)도 같은 섬 행을 먼저
        // 잡으므로, 여기서 끝낸 세션에 뒤늦은 전이가 끼어들지 않는다.
        focusMembershipLossService.endOnMembershipLoss(targetUser.getId(), groupId);
        // 초대 코드의 이전 세대를 무효화하고 대표 섬과 현재 섬을 복구한다.
        membershipTransitions.recordMembershipRevoked(target);
        // 강퇴된 본인에게 앱 알림 1건(GROMO-2315) — 메인 섬이 옮겨졌어도 이전 알림은 MainIslandService 가 내지 않는다.
        events.publishEvent(new IslandKickedEvent(targetUser.getId(), groupId, group.getName(), target.getLeftAt()));
        // memberUserId 는 강퇴 «대상»이다 — 요청자(userId, 방장)가 아니라 targetUserId 를 줘야 Realtime 이
        // 강퇴당한 그 유저의 멤버십 캐시를 지운다(GROMO-2140). actorId 자리(userId)는 그대로 방장이다.
        EventEnvelope event = membershipEvents.changed(groupId, userId, "MEMBER_REMOVED", targetUserId);
        userActivityEventLogger.log(UserActivityEvent.GROUP_LEFT, Map.of("group_id", group.getId().toString()));
        return event;
    }

    /**
     * 그룹에서 나간다 — 행을 지우지 않고 이탈로 마킹한다(A-0 소프트삭제).
     *
     * <p>멤버가 둘 이상인데 요청자가 방장이면 {@code HOST_WITHDRAW} 로 막고(위임이 먼저),
     * 마지막 1인이 나가면 그룹까지 닫는다.
     *
     * <p>이 섬에서 집중·휴식 중이면 {@code SESSION_IN_PROGRESS}(409)로 막는다 — FR-D03 의 「자진 탈퇴는
     * 먼저 끝내고 나가라」(관리 LLD §5, GROMO-1924). 막지 않으면 탈퇴 뒤 그 세션은 멤버십이 없어 어떤
     * 전이로도 끝낼 수 없다.
     *
     * @param groupId 나갈 그룹
     * @param userId 요청자 — 그룹원이 아니면 {@code MEMBER_ONLY}
     */
    @Transactional
    public void withdrawGroup(UUID groupId, UUID userId) {
        withdrawGroupAndRecord(groupId, userId);
    }

    /**
     * 그룹에서 나가고 주민 목록 사건을 돌려준다 (GROMO-1802) — {@link #kickMemberAndRecord} 와 같은 이유다.
     *
     * @return 이 이탈로 발행한 {@code island.members.updated} 봉투
     */
    @Transactional
    public EventEnvelope withdrawGroupAndRecord(UUID groupId, UUID userId) {
        // 계정 탈퇴와 직렬화하도록 요청자의 공유 잠금을 먼저 잡는다.
        User user = requireActiveUser(userId);
        membershipLocks.lockGroup(groupId);
        membershipLocks.lockMembers(groupId, List.of(userId));
        Group group = groupQueryService.getGroupForUpdate(groupId);
        GroupMember groupMember = groupQueryService.getMembership(user, group);

        // A-0 소프트삭제: 행을 지우지 않고 이탈 마킹(leave). findByGroup 은 활성만 세므로 마지막 1인 판정 유지.
        List<GroupMember> groupMembers = groupMemberRepository.findByGroup(group);
        if (groupMembers.size() > 1 && groupMember.getRole() == GroupMemberRole.OWNER) {
            throw new GroupException(GroupErrorCode.HOST_WITHDRAW);
        }
        // 진행 중 집중 세션은 종료한 뒤 나가야 한다.
        focusMembershipLossService.requireNoProgressingSession(userId, groupId);

        if (groupMembers.size() == 1) {
            groupMember.leave(clock.instant());
            membershipTransitions.recordMembershipRevoked(groupMember);
            group.close();
            // 공개 섬 상태 축에도 종료를 남긴다(섬 관리 LLD §3.7) — 주민 목록 사건만으로는 섬이 닫힌 것을 모른다.
            islandStateEvents.changed(groupId, userId, "CLOSED");
            closeJoinRequests(group);
            // 공동 데이터 삭제는 이 블록의 «마지막»이다 — 위의 봉투·신청 전이를 전부 적은 뒤라야
            // 삭제가 그 쓰기를 앞질러 죽은 섬을 참조하는 반쪽 상태를 만들지 않는다.
            islandPurge.purgeIsland(groupId);
        } else if (groupMember.getRole() == GroupMemberRole.MEMBER) {
            groupMember.leave(clock.instant());
            membershipTransitions.recordMembershipRevoked(groupMember);
        }
        EventEnvelope event = membershipEvents.changed(groupId, userId, "MEMBER_REMOVED", userId);
        userActivityEventLogger.log(UserActivityEvent.GROUP_LEFT, Map.of("group_id", group.getId().toString()));
        return event;
    }

    /**
     * 계정 탈퇴의 users 배타 잠금 직후, 세션·USER outbox보다 먼저 관련 그룹을 전부 잠근다.
     * 섬 변경과 같은 그룹 → USER aggregate 순서를 따른다. 가입·이탈은 users 잠금과 직렬화된다.
     *
     * <p><b>잠그는 대상은 활성 멤버십 그룹 ∪ 댓글을 남긴 섬이다</b>(GROMO-2137 코드리뷰 대응). 이 유저의
     * 댓글은 {@link #eraseWithdrawnUserRecords} 가 원문째 지우며 그 섬의 {@code notice.updated} 를 발행하는데,
     * {@code IslandNoticeService} 의 잠금 규율(모든 공지·댓글 writer 가 섬 배타 락을 먼저 쥔다, class Javadoc
     * §「잠금 순서」)을 지키려면 <b>이미 나간 섬</b>이라도 댓글이 남아 있으면 함께 잠가야 한다 — 활성 멤버십
     * 목록만 잠그면 그 섬의 동시 공지 쓰기와 경합 없이 댓글이 사라진다. <b>반환값은 여전히 활성 그룹뿐</b>이다:
     * {@link #detachWithdrawnUser} 는 이 목록으로 <b>활성</b> 멤버 행만 잠그면 되고, 이미 나간 섬은 잠글
     * 멤버 행 자체가 없다.
     *
     * @param user 호출자가 배타 잠금으로 로드한 탈퇴 대상
     * @return 선점한 <b>활성</b> 그룹 ID 목록 — 락 자체는 댓글을 남긴 섬까지 포함해 걸린다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public List<UUID> lockGroupsForAccountWithdrawal(User user) {
        List<UUID> activeGroupIds = groupMemberRepository.findActiveGroupIdsByUserId(user.getId());
        Set<UUID> groupIdsToLock = new LinkedHashSet<>(activeGroupIds);
        groupAnnouncementCommentRepository.findDistinctNoticesCommentedByUser(user.getId()).stream()
                .map(GroupAnnouncementCommentRepository.CommentedNotice::getIslandId)
                .forEach(groupIdsToLock::add);
        membershipLocks.lockGroups(groupIdsToLock);
        return activeGroupIds;
    }

    /**
     * 계정 탈퇴자의 소속을 정리한다. 혼자 남은 섬은 닫고 다른 주민이 남은 방장은 위임을 요구한다.
     * 멤버십·초대 링크·주민 사건은 호출자의 탈퇴 트랜잭션에서 함께 변경한다.
     *
     * @param user 배타 잠금으로 읽은 탈퇴 대상
     * @throws GroupException 다른 주민이 남은 섬의 방장이면 HOST_WITHDRAW
     */
    @Transactional
    public void detachWithdrawnUser(User user) {
        UUID userId = user.getId();
        // 원 진입점은 USER outbox 전에 이미 선점했다. 직접 진입도 같은 그룹 잠금을 재확인한다.
        List<UUID> groupIds = lockGroupsForAccountWithdrawal(user);
        groupIds.stream().distinct().sorted()
                .forEach(groupId -> membershipLocks.lockMembers(groupId, List.of(userId)));

        for (GroupMember ownerMembership : groupMemberRepository.findActiveOwnerMembershipsByUserId(userId)) {
            // 현재 주민 수로 혼자인 방장의 섬 종료 여부를 판단한다.
            List<GroupMember> recipients = groupMemberRepository.findByGroup(ownerMembership.getGroup());
            if (recipients.size() <= 1) {
                ownerMembership.leave(clock.instant());
                membershipTransitions.recordMembershipRevoked(ownerMembership);
                membershipEvents.changed(ownerMembership.getGroup().getId(), userId, "MEMBER_REMOVED", userId);
                ownerMembership.getGroup().close();
                islandStateEvents.changed(ownerMembership.getGroup().getId(), userId, "CLOSED");
                closeJoinRequests(ownerMembership.getGroup());
                // 계정 탈퇴로 닫히는 1인 섬도 같은 삭제를 받는다 (GROMO-1995) — 닫히는 경로마다
                // 다른 결과가 나오면 「닫혔는데 공동 잔액은 남은」 섬이 이쪽으로만 생긴다.
                islandPurge.purgeIsland(ownerMembership.getGroup().getId());
            }
        }

        if (groupRepository.existsGroupOwnedBy(userId)) {
            throw new GroupException(GroupErrorCode.HOST_WITHDRAW);
        }


        for (GroupMember membership : groupMemberRepository.findByUser(user)) {
            // 사용자 배타 잠금은 다른 방장의 그룹명 변경을 막지 않는다.
            // 이탈 직전에 멤버십 행을 잠가 같은 전이를 직렬화한다.
            groupMemberRepository.findActiveByUserIdAndGroupIdForUpdate(userId, membership.getGroup().getId())
                    .ifPresent(locked -> {
                        locked.leave(clock.instant());
                        membershipTransitions.recordMembershipRevoked(locked);
                        membershipEvents.changed(locked.getGroup().getId(), userId, "MEMBER_REMOVED", userId);
                    });
        }

        // 탈퇴자가 신청자로 연 둔 가입 요청도 닫는다 — 계정이 사라진 뒤에도 PENDING 으로 남으면
        // 그 섬 방장은 영원히 오지 않을 신청을 들고 있는다. 신청은 멤버십이 아니라 위의 그룹 선점에
        // 잡히지 않으므로 요청 행 잠금으로 신청자 취소와 직렬화한다. 신청자 측 종결이라 cancel() 이다.
        for (IslandJoinRequest request : joinRequestRepository.findByApplicantIdAndStatusForUpdate(
                userId, IslandJoinRequestStatus.PENDING)) {
            request.cancel();
            joinRequestEvents.changed(request, currentHostId(request.getIsland().getId()));
        }
    }

    /**
     * 탈퇴자의 그룹 쪽 개인 자료를 파기한다 (GROMO-1801 · 계정 LLD §4).
     *
     * <p>{@link #detachWithdrawnUser} 뒤에 같은 트랜잭션에서 개인 설정과 작성자 정보를 정리한다.
     *
     * <p><b>댓글 벌크 삭제는 {@code notice.updated} 를 함께 낸다</b>(GROMO-2137 코드리뷰 대응) — 안 그러면
     * 다른 주민의 목록·상세({@code commentCount})가 이 변화를 영영 모른다. {@code IslandNoticeService} 의 다른
     * 모든 공지·댓글 writer 처럼 같은 TX 에서 공지마다 한 번씩 사건을 낸다. actorId 는 <b>탈퇴 중인 본인</b>이다
     * — {@code IslandNoticeEvents.changed} 가 그 값을 outbox 행의 필수 필드({@code OutboxAppendCommand.userId})로
     * 그대로 쓰므로 null 을 줄 수 없고, 이 정리를 일으킨 주체도 이 탈퇴 자신이라 값이 맞다(다른 outbox 호출도
     * 이 메서드 전체에서 탈퇴자 id 를 그대로 쓴다). 섬 배타 락은 {@link #lockGroupsForAccountWithdrawal} 이
     * 댓글 섬까지 포함해 이미 쥐고 있다.
     *
     * @param user 탈퇴 중인 유저 — 호출부가 배타 락으로 로드했다
     */
    @Transactional
    public void eraseWithdrawnUserRecords(User user) {
        UUID userId = user.getId();
        groupMemberRepository.eraseSettingsOfUser(userId);
        groupAnnouncementRepository.detachAuthor(userId);
        // 댓글은 공지와 달리 원문째 지운다 (2026-09-25 결정 GROMO-2136 — BQ02 확정). 지우기 전에 영향받는
        // (섬, 공지) 쌍을 모아 둔다 — 지운 뒤에는 어떤 공지의 댓글이 사라졌는지 알 수 없다.
        List<GroupAnnouncementCommentRepository.CommentedNotice> commentedNotices =
                groupAnnouncementCommentRepository.findDistinctNoticesCommentedByUser(userId);
        groupAnnouncementCommentRepository.deleteAllOfUser(userId);
        for (GroupAnnouncementCommentRepository.CommentedNotice notice : commentedNotices) {
            noticeEvents.changed(notice.getIslandId(), notice.getNoticeId(), userId);
        }
        // 섬 방명록(GROMO-2262)도 댓글과 같은 쪽이다 — 방문자·주민이 남긴 짧은 글을 지운 글까지 원문째 지운다.
        // 사건·섬 잠금은 필요 없다: 방명록에는 aggregate version 도 notice.updated 같은 사건도 없고, 섬 쓰기(삽입 →
        // 31번째 이후 정리)와 겹쳐도 지우는 쪽은 활성 글을 «줄이기만» 해 상한 30 을 넘기지 않는다.
        guestbookEntryRepository.deleteAllOfUser(userId);
        // 섬 도착 기록(GROMO-2260) — 개인 이동·방문 이력이다. 남의 판정 근거가 아니라 원문째 지운다.
        islandArrivalRepository.deleteAllOfUser(userId);
        // 주민 첫 도착 사건(GROMO-2302) params 의 이름·털색 사본.
        islandArrivalEvents.eraseWithdrawnUser(userId);
        // 망원경 핀(GROMO-2268)도 개인 목록이다 — 남의 판정 근거가 아니라 원문째 지운다.
        telescopePinRepository.deleteAllOfUser(userId);
        // 망원경 1시간 목록 스냅샷(GROMO-2306)도 개인 목록이다.
        telescopeBucketRepository.deleteAllOfUser(userId);
        onboardingIslandRepository.closePendingOfUser(userId);
        onboardingIslandRepository.deleteAllOfUser(userId);
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
     * 메서드 레벨 {@code @Transactional} 로 쓰기 트랜잭션을 연 변경 경로 전용이다.
     */
    private User requireActiveUser(UUID userId) {
        return userQueryService.getCallerForShare(userId);
    }

    /**
     * 섬 종결에 딸린 가입 요청 정리 (GROMO-1760) — 열려 있던 신청은 섬이 닫히면 무효가 되므로
     * 영구히 {@code PENDING} 으로 남기지 않고 전부 종결한다. 호출 지점은 이미 그룹 행을 잠근 뒤다 —
     * 신청 생성(같은 그룹 잠금)·신청자 취소(요청 행 잠금)와 이 전이는 한쪽만 성공한다.
     * 방장 공백의 종결이라 사건은 신청자에게만 간다.
     */
    private void closeJoinRequests(Group island) {
        for (IslandJoinRequest request : joinRequestRepository.findByIslandIdAndStatusForUpdate(
                island.getId(), IslandJoinRequestStatus.PENDING)) {
            request.closeByIsland();
            joinRequestEvents.changed(request, null);
        }
    }

    /** 그 섬의 현재 방장 — 방장 공백 구간이면 null 이고 사건은 신청자에게만 간다. */
    private UUID currentHostId(UUID islandId) {
        return groupMemberRepository.findActiveOwnersByGroupId(islandId).stream()
                .map(member -> member.getUser().getId())
                .findFirst()
                .orElse(null);
    }
}
