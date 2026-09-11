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
import com.oneorthree.phone.group.repository.GroupRepository;
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
    private final GroupRepository groupRepository;
    private final GroupQueryService groupQueryService;
    private final UserQueryService userQueryService;
    private final UserActivityEventLogger userActivityEventLogger;
    private final GroupBetService groupBetService;
    /**
     * 멤버십 전이·그룹 종료를 링크 서버로 나르는 내구 명령 (A22 ⓑ · ㋢). 같은 트랜잭션에서 적는다 —
     * 커밋 후 발행이면 응답 유실·프로세스 종료 시 보낼 주체가 사라진다.
     */
    private final LinkMembershipEventService linkMembershipEventService;

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
        // 방장을 로그아웃시킨다. GROMO-1725: 대상 유저 부재는 TARGET_USER_NOT_FOUND, 바로 아래
        // 멤버십 부재는 NOT_FOUND(그룹 안의 것) — 앱이 둘을 다른 문구로 가른다(1726).
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
        // 커밋되면 여기서 삭제를 관측하고 TARGET_USER_NOT_FOUND 로 거절된다(GROMO-1725).
        // GROMO-1247: transferOwner 대상과 같은 이유로 USER_NOT_FOUND 로 바꾸지 않는다(대상 유저다).
        User targetUser = userQueryService.getTargetForShare(targetUserId);
        GroupMember target = groupQueryService.findMembership(targetUser, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // 강퇴 마킹. 진행 중 내기 판돈은 건드리지 않는다(지갑 생존 → 정산 시 정상 지급/환불, 엔진 무변경).
        target.kick();
        // 멤버십 전이 = 그 (그룹, 발급자) 링크의 폐기다(A22 ⓑ). Business 의 revoke 만 있으면
        // 그것이 실패했을 때 예전 slug 가 살아 «비공개 그룹 무단 가입»이 된다 — 같은 트랜잭션에서
        // outbox 를 적고 relay 가 재전달한다.
        linkMembershipEventService.recordMembershipRevoked(target);
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
        GroupMember groupMember = groupQueryService.getMembership(user, group);

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
            linkMembershipEventService.recordMembershipRevoked(groupMember);
            group.close();
            // 그룹 종료는 폐기와 «별개 사건»이다(㋢) — 현행 랜딩·매치가 둘 다 findActiveGroup 으로
            // 실시간 판정하므로, 안 보내면 죽은 그룹의 slug 가 계속 랜딩·매치에 성공한다.
            linkMembershipEventService.recordGroupClosed(group);
        } else if (groupMember.getRole() == GroupMemberRole.MEMBER) {
            groupMember.leave();
            linkMembershipEventService.recordMembershipRevoked(groupMember);
        }
        userActivityEventLogger.log(UserActivityEvent.GROUP_LEFT, Map.of("group_id", group.getId().toString()));
    }

    /**
     * 계정 탈퇴자를 그룹에서 떼어낸다 (GROMO-801, GROMO-1423 · 이동 GROMO-1656).
     *
     * <p><b>이 메서드가 여기 있는 이유.</b> 종전엔 {@code UserService.withdraw} 안에 이 네 단계가
     * 펼쳐져 있어 계정 도메인이 그룹 리포지토리·예외·엔티티를 직접 참조했다(user → group 역행 6건).
     * 그룹에서 떼어내는 방법은 그룹이 알아야 하므로 통째로 옮겼다 — <b>단계와 그 순서는 그대로다.</b>
     * 호출은 {@code withdrawal/AccountWithdrawalService} 가 열어 둔 트랜잭션에 편승한다.
     *
     * <p><b>네 단계의 순서가 곧 정합성이다.</b>
     * <ol>
     *   <li><b>혼자 있는 소유 그룹 자동 종료</b> — 활성 멤버가 자기 하나뿐인 그룹은 방장 위임을
     *       요구할 상대가 없으므로 그냥 닫는다. 여기서 이탈시킨 멤버십은 아래 4단계의 활성 조회에
     *       다시 잡히지 않는다.</li>
     *   <li><b>위임하지 않은 방장 그룹이 남으면 거절</b> — 다른 멤버가 남은 그룹의 방장은 위임 전까지
     *       탈퇴할 수 없다. 판정이 아래 두 단계보다 <b>앞</b>이어야 돈이 움직이기 전에 롤백된다.</li>
     *   <li><b>OPEN 내기 일괄 해제</b> — 해제하지 않으면 판돈이 에스크로에 묶인 채 소각된다
     *       ({@code GroupBetSettler} 는 탈퇴자 지급을 스킵한다). 멤버십이 아니라 <b>유저 스코프</b>인
     *       이유는 ① 강퇴자는 활성 멤버십이 없어도 참가·판돈이 남고 ② 그룹 단위 순차 해제는 앞 그룹
     *       환불로 지갑 잠금을 쥔 채 다음 그룹 내기 잠금을 기다려 정산기와 AB-BA 교착이 되기 때문이다.
     *       전 그룹의 내기 행을 bet id 오름차순으로 전부 잠근 뒤에만 돈이 움직인다.</li>
     *   <li><b>판정 근거 박제</b> — 위 해제가 환불하지 못하고 정산 대상으로 남긴 OPEN 참가 행에
     *       달성·진행분을 박제한다. 반드시 해제 <b>뒤</b>(남는 행만 박제)여야 한다.</li>
     *   <li><b>활성 멤버십 이탈</b> — 안 하면 탈퇴자가 {@code is_left=false} 유령 멤버로 남아 멤버
     *       목록에 nickname null 로 뜨고 정원 한 자리를 영구히 차지한다.</li>
     * </ol>
     *
     * <p><b>호출부가 지켜야 하는 두 가지</b>(이 메서드가 강제할 수 없다) — 3단계의 환불이 이 유저의
     * 지갑에 입금되므로 <b>지갑 삭제보다 먼저</b> 불려야 하고, 4단계의 박제는 통계가 사라지기 전의
     * 값을 읽으므로 <b>집중·통계 익명화보다 먼저</b>여야 한다.
     *
     * @param user 탈퇴 중인 유저. 호출부가 배타 락으로 로드해 둔 엔티티여야 한다
     * @throws GroupException 위임하지 않은 방장 그룹이 남아 있을 때 {@code HOST_WITHDRAW}
     */
    @Transactional
    public void detachWithdrawnUser(User user) {
        UUID userId = user.getId();

        for (GroupMember ownerMembership : groupMemberRepository.findActiveOwnerMembershipsByUserId(userId)) {
            if (groupMemberRepository.findByGroup(ownerMembership.getGroup()).size() <= 1) {
                ownerMembership.leave();
                linkMembershipEventService.recordMembershipRevoked(ownerMembership);
                ownerMembership.getGroup().close();
                // 그룹 종료도 함께 전달한다(㋢). 폐기만 보내면 그 그룹의 «다른» 발급자 링크가 남는다.
                linkMembershipEventService.recordGroupClosed(ownerMembership.getGroup());
            }
        }

        if (groupRepository.existsGroupOwnedBy(userId)) {
            throw new GroupException(GroupErrorCode.HOST_WITHDRAW);
        }

        groupBetService.releaseFromAllOpenBets(user);
        groupBetService.freezeEvidenceForAccountErasure(user);

        for (GroupMember membership : groupMemberRepository.findByUser(user)) {
            membership.leave();
            linkMembershipEventService.recordMembershipRevoked(membership);
        }
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
