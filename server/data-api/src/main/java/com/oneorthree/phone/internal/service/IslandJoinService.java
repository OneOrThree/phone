package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.IslandJoinRequestRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.IslandJoinRequest;
import com.oneorthree.phone.group.repository.domain.IslandJoinRequestStatus;
import com.oneorthree.phone.group.repository.domain.UserIslandContext;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.group.service.IslandJoinRequestEvents;
import com.oneorthree.phone.group.service.IslandMembershipEvents;
import com.oneorthree.phone.group.service.LinkMembershipEventService;
import com.oneorthree.phone.group.service.UserIslandContextLockService;
import com.oneorthree.phone.internal.dto.JoinIslandCommandRequest;
import com.oneorthree.phone.internal.dto.JoinIslandResultView;
import com.oneorthree.phone.internal.dto.JoinRequestAnswerView;
import com.oneorthree.phone.internal.dto.JoinRequestCancelView;
import com.oneorthree.phone.internal.dto.JoinRequestStatusView;
import com.oneorthree.phone.internal.dto.MyJoinRequestsPageView;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.support.SlugGenerator;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 섬 가입·가입 요청 조회·취소 (GROMO-1760 · 섬 소속 LLD §3.7~§3.9).
 *
 * <h2>잠금 순서</h2>
 * {@code users → context → groups → memberships → join_request} — 1759 가 고정한 축과 같다.
 * pending 생성은 컨텍스트를 쓰지 않지만 같은 순서로 잠근다 — 즉시 가입이 context 를 잡아야 하고,
 * 분기마다 순서가 갈리면 언젠가 역순 교착이 생긴다.
 *
 * <h2>같은 pending 은 새로 만들지 않는다</h2>
 * (섬, 신청자)의 열린 요청은 최대 하나다(부분 유니크가 최후 방어선). 재시도·이중 탭은 새 행이
 * 아니라 <b>같은 자원</b>을 돌려주는 성공이다 — 「중복 신청」이라는 실패는 계약에 없다(§3.7).
 *
 * <h2>초대는 커밋 안에서 다시 검증한다</h2>
 * Business 의 사전 resolve 성공만 믿으면 그 사이 발급자 이탈·섬 종결이 빠진다. 가입 커밋은
 * 발급자의 활성 멤버십을 공유 잠금으로 잡고 발급 세대를 대조한다 — 발급자의 이탈·강퇴는 같은
 * 행을 배타로 잡으므로 둘 중 하나만 커밋된다.
 */
@Service
@Slf4j
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class IslandJoinService {

    /** 목록 limit 상한 — 섬 관리 신청자 목록(섬 관리 LLD §3.3)과 같다. 기본값은 Business 몫이다. */
    private static final int MY_REQUESTS_MAX_LIMIT = 100;

    private final UserQueryService userQueryService;
    private final GroupQueryService groupQueryService;
    private final UserIslandContextLockService userIslandContextLockService;
    private final GroupMembershipMutationLocks membershipLocks;
    private final GroupMemberRepository groupMemberRepository;
    private final IslandJoinRequestRepository joinRequestRepository;
    private final GroupInviteLinkRepository inviteLinkRepository;
    private final IslandMembershipEvents membershipEvents;
    private final IslandJoinRequestEvents joinRequestEvents;
    private final LinkMembershipEventService linkMembershipEventService;
    private final IslandMovementGuards movementGuards;
    private final PublicCommandService publicCommands;
    /**
     * 재가입 시각을 찍는 시계 (GROMO-2050) — 근거는 {@code GroupMember.leftAt} Javadoc(Hibernate 의
     * 시각 애너테이션은 주입 {@link Clock} 을 타지 않는다).
     */
    private final Clock clock;

    /** 섬 관리 명령 게이트(GROMO-1802) — {@code IslandManagementService} 와 같은 스위치다. 기본은 닫혀 있다. */
    @Value("${island-management.commands-enabled:false}")
    private boolean managementEnabled;

    // ---------------------------------------------------------------- §3.7 join

    /**
     * 섬에 가입하거나 가입을 요청한다 (LLD §3.7).
     *
     * <p>{@code approvalRequired=false} 이면 즉시 가입 — switch 와 같은 이동 가드를 거치고 현재 섬을
     * 옮긴다. {@code true} 이면 승인 대기 요청만 만든다 — 소속 상한·집중 세션·전망대는
     * <b>검사하지 않는다</b>: pending 은 자리 예약이 아니라 신청이고, 그 조건은 승인 시점의 값으로
     * 다시 판정해야 한다(IM-D05 — 예약 없음).
     *
     * <p><b>정원만은 신청에도 건다</b>(GROMO-1993) — 정책 「승인 필요 섬이 가득 차면 새 가입 신청을
     * 막는다」. 예약이 생기는 것은 아니다: 이미 열린 신청은 가득 차도 유지되고 승인 시점에 다시
     * {@code requireCapacity} 로 걸린다(「신청은 유지하고 승인만 막으며」).
     */
    @Transactional
    public JoinIslandResultView join(UUID userId, UUID islandId, JoinIslandCommandRequest body,
                                     UUID idempotencyKey) {
        Map<String, Object> fingerprint = new HashMap<>();
        fingerprint.put("invitationToken", normalizeToken(body == null ? null : body.invitationToken()));
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "POST:/islands/" + islandId + "/memberships:" + userId,
                idempotencyKey, InternalJson.tree(fingerprint));
        JsonNode data = publicCommands.run(command,
                () -> userQueryService.getCallerForUpdate(userId),
                ignored -> userQueryService.getCallerForUpdate(userId),
                () -> {
                    User user = userQueryService.getCallerForUpdate(userId);
                    // 잠금 순서는 분기와 무관하게 같다 — context 를 쓰지 않는 경로도 같은 순서로 잠근다.
                    UserIslandContext context = userIslandContextLockService.lock(user);
                    membershipLocks.lockGroup(islandId);
                    Group island = groupQueryService.getGroup(islandId);
                    IslandMovementGuards.requireAlive(island);

                    Optional<GroupMember> prior = groupMemberRepository.findAnyByUserAndGroup(user, island);
                    if (prior.isPresent() && !prior.get().isLeft()) {
                        throw new GroupException(GroupErrorCode.ALREADY_MEMBER);
                    }
                    if (prior.isPresent() && prior.get().isKicked()) {
                        throw new GroupException(GroupErrorCode.KICKED_CANNOT_REJOIN);
                    }

                    Optional<IslandJoinRequest> pending = joinRequestRepository
                            .findByIslandIdAndApplicantIdAndStatus(
                                    islandId, userId, IslandJoinRequestStatus.PENDING);
                    if (pending.isPresent()) {
                        // 같은 자원을 돌려주는 성공 — 새 사건을 만들지 않는다(조회/재시도에는 사건 없음).
                        IslandJoinRequest existing = pending.get();
                        long version = existing.getVersion() == null ? 0L : existing.getVersion();
                        return new PublicCommandResult(200, InternalJson.tree(
                                JoinIslandResultView.pending(existing.getId(), islandId, version)),
                                InternalJson.tree(List.of()));
                    }
                    if (island.getPassword() != null) {
                        // IM-D04 미결 — password 입력이 없는 이 API 로 잠긴 방을 열면 «기존 잠금 무시»다.
                        throw new GroupException(GroupErrorCode.ISLAND_JOIN_UNAVAILABLE);
                    }

                    GroupInviteLink invitation = revalidateInvitation(island, body == null
                            ? null : body.invitationToken());
                    if (island.isPrivate() && invitation == null) {
                        throw new GroupException(GroupErrorCode.INVITATION_REQUIRED);
                    }

                    if (island.isApprovalRequired()) {
                        // 정책(GROMO-1993): 「승인 필요 섬이 가득 차면 «새» 가입 신청을 막는다.」
                        // 이미 열린 pending 은 위에서 그대로 돌려줬으므로 여기 오지 않는다 —
                        // 「승인 대기 중에 가득 차면 신청은 유지하고 승인만 막는다」가 그 둘의 차이다.
                        requireCapacity(island);
                        IslandJoinRequest request = joinRequestRepository.save(IslandJoinRequest.pending(
                                island, user, invitation == null ? null : invitation.getId()));
                        List<EventEnvelope> events =
                                joinRequestEvents.changed(request, currentHost(islandId));
                        long version = request.getVersion() == null ? 0L : request.getVersion();
                        return new PublicCommandResult(200, InternalJson.tree(
                                JoinIslandResultView.pending(request.getId(), islandId, version)),
                                InternalJson.tree(events));
                    }

                    movementGuards.requireNoLiveFocusSession(user);
                    movementGuards.requireDepartureUnlocked(context);
                    movementGuards.requireJoinedIslandLimit(user);
                    requireCapacity(island);

                    GroupMember membership = admit(user, island, prior);
                    context.moveTo(islandId);
                    EventEnvelope members = membershipEvents.changed(islandId, userId, "MEMBER_ADDED");
                    if (invitation != null) {
                        linkMembershipEventService.recordJoinAttribution(islandId, userId,
                                invitation.getSlug(), "invite", membership.getMembershipEpoch());
                    }
                    return new PublicCommandResult(200, InternalJson.tree(
                            JoinIslandResultView.active(islandId, members.version())),
                            InternalJson.tree(List.of(members)));
                }).value().data();
        return InternalJson.decode(data, JoinIslandResultView.class);
    }

    // ---------------------------------------------------------------- §3.8 join-status

    /**
     * 본인 가입 요청 하나의 상태를 본다 (LLD §3.8).
     *
     * <p>타인의 requestId 는 「없음」이다 — 존재 여부를 응답으로 구분해 주면 내가 아닌 요청의
     * 진행 상황을 추정할 수 있다.
     */
    public JoinRequestStatusView status(UUID userId, UUID requestId) {
        userQueryService.getCaller(userId);
        IslandJoinRequest request = joinRequestRepository.findByIdAndApplicantId(requestId, userId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.JOIN_REQUEST_NOT_FOUND));
        return new JoinRequestStatusView(request.getId(), request.getIsland().getId(),
                request.getStatus().wireName(),
                request.getVersion() == null ? 0L : request.getVersion());
    }

    // ---------------------------------------------------------------- §3.12 my-requests

    /**
     * 본인의 대기 중 가입 요청 목록 (GROMO-1895, LLD §3.12) — explore 화면의 「신청 중」 조각이다.
     *
     * <p>pending 만 싣는다: 닫힌 요청은 §3.8 단건 조회로 결과를 확인하는 자원이지 대기 목록이 아니다.
     * 승인·거절로 닫힌 신청은 <b>다음 페이지 요청부터 사라진다</b> — 정책이 「승인 대기 중인 가입
     * 신청은 취소할 수 있고, 다시 신청할 수 있다」까지만 정하고 이력 열람을 열지 않았으므로
     * (policy-2026-09-14 「섬 가입·전망대·랭킹」), 이력은 만들지 않는다(GROMO-2047).
     * 섬이 종결되면 그 섬의 pending 은 같은 TX 에서 닫히므로(ISLAND_CLOSED) 죽은 섬이 목록에 남지 않는다.
     * 커서는 Business 가 서명·검증한 뒤 평문 keyset 경계({@code after…})만 넘긴다(§3.3 과 같은 규칙).
     */
    public MyJoinRequestsPageView myRequests(UUID userId, Instant afterCreatedAt, UUID afterRequestId, int limit) {
        if ((afterCreatedAt == null) != (afterRequestId == null) || limit < 1 || limit > MY_REQUESTS_MAX_LIMIT) {
            throw new GroupException(GroupErrorCode.INVALID_PAGE_REQUEST);
        }
        userQueryService.getCaller(userId);
        List<IslandJoinRequest> rows = joinRequestRepository.findPageByApplicantIdAndStatus(userId,
                IslandJoinRequestStatus.PENDING,
                afterCreatedAt == null ? Instant.EPOCH : afterCreatedAt,
                afterRequestId == null ? new UUID(0L, 0L) : afterRequestId,
                PageRequest.of(0, limit + 1));
        boolean more = rows.size() > limit;
        List<IslandJoinRequest> page = more ? rows.subList(0, limit) : rows;
        IslandJoinRequest last = more ? page.get(page.size() - 1) : null;
        // 주민 수는 페이지 전체를 한 번에 센다(GROMO-2047) — 항목마다 세면 페이지당 N+1 이다.
        // 멤버가 0인 섬은 행 자체가 없으므로 0 으로 채운다(countByGroupIdIn javadoc).
        Map<UUID, Integer> memberCounts = new HashMap<>();
        if (!page.isEmpty()) {
            groupMemberRepository.countByGroupIdIn(page.stream()
                            .map(request -> request.getIsland().getId()).distinct().toList())
                    .forEach(row -> memberCounts.put(row.getGroupId(), (int) row.getMemberCount()));
        }
        return new MyJoinRequestsPageView(page.stream()
                .map(request -> new MyJoinRequestsPageView.Item(request.getId(), request.getIsland().getId(),
                        request.getIsland().getName(),
                        memberCounts.getOrDefault(request.getIsland().getId(), 0),
                        request.getIsland().getMaxMembers(), request.getStatus().wireName(),
                        request.getVersion() == null ? 0L : request.getVersion(), request.getCreatedAt()))
                .toList(),
                last == null ? null : last.getCreatedAt(), last == null ? null : last.getId());
    }

    // ---------------------------------------------------------------- §3.9 cancel

    /**
     * 열린 가입 요청을 본인이 철회한다 (LLD §3.9).
     *
     * <p>요청 행을 배타 잠금한 뒤 PENDING 을 확인하고 전이한다 — 승인·섬 종결 같은 다른 전이와
     * 경합해도 한쪽만 성공한다. 이미 닫힌 요청은 409 다.
     */
    @Transactional
    public JoinRequestCancelView cancel(UUID userId, UUID requestId, UUID idempotencyKey) {
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "DELETE:/me/join-requests/" + requestId + ":" + userId,
                idempotencyKey, InternalJson.tree(Map.of()));
        JsonNode data = publicCommands.run(command,
                () -> userQueryService.getCallerForUpdate(userId),
                ignored -> userQueryService.getCallerForUpdate(userId),
                () -> {
                    userQueryService.getCallerForUpdate(userId);
                    IslandJoinRequest request = joinRequestRepository
                            .findByIdAndApplicantIdForUpdate(requestId, userId)
                            .orElseThrow(() -> new GroupException(GroupErrorCode.JOIN_REQUEST_NOT_FOUND));
                    if (!request.isPending()) {
                        throw new GroupException(GroupErrorCode.JOIN_REQUEST_TERMINAL);
                    }
                    request.cancel();
                    List<EventEnvelope> events = joinRequestEvents.changed(
                            request, currentHost(request.getIsland().getId()));
                    return new PublicCommandResult(200, InternalJson.tree(
                            new JoinRequestCancelView(request.getId(), "cancelled")),
                            InternalJson.tree(events));
                }).value().data();
        return InternalJson.decode(data, JoinRequestCancelView.class);
    }

    // ---------------------------------------------------------------- 섬 관리 §3.4 request-answer

    /**
     * 방장이 가입 요청을 승인·거절한다 (GROMO-1802, 섬 관리 LLD §3.4).
     *
     * <p><b>잠금 순서는 가입과 같다</b> — {@code users → groups → join_request}. 신청자 users 행은
     * <b>배타</b>로 잡는다: 신청자의 소속 상한은 신청자 본인의 가입·섬 생성·다른 섬 승인과 경합하는데
     * 그 경로들이 전부 신청자 행을 배타로 잡기 때문이다(처리자 방장만 잠그면 동시 다른 섬 가입을 못 막는다,
     * LLD §4). 두 users 행은 UUID 순서로 잡아 서로 다른 섬의 방장이 서로를 승인하는 교차에서 교착하지 않는다.
     *
     * <p>승인만 가입 자격(과거 강퇴·기존 멤버십·소속 상한·정원·초대 근거)을 본다. 거절은 자격·자리와
     * 무관하게 pending 을 닫을 수 있다. 승인은 현재 섬을 바꾸지 않는다 — 이동은 별도 switch 가드를 탄다.
     * 이미 닫힌 요청은 다른 키면 409 이고, 같은 키는 receipt 가 원 결과를 재생한다.
     */
    @Transactional
    public JoinRequestAnswerView answer(UUID userId, UUID islandId, UUID requestId, boolean approve,
                                        UUID idempotencyKey) {
        if (!managementEnabled) {
            throw new GroupException(GroupErrorCode.ISLAND_MANAGEMENT_NOT_READY);
        }
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "PATCH:/islands/" + islandId + "/join-requests/" + requestId,
                idempotencyKey, InternalJson.tree(Map.of("decision", approve ? "approve" : "reject")));
        // 판정 근거가 아니라 잠글 행을 고르기 위한 선조회다 — 전이는 잠금 아래 다시 읽은 행으로 한다.
        UUID applicantId = approve
                ? joinRequestRepository.findApplicantIdByIdAndIslandId(requestId, islandId).orElse(null)
                : null;
        JsonNode data = publicCommands.run(command,
                () -> lockAnswerUsers(userId, applicantId),
                // 재생도 지금 방장이어야 한다 — 위임·강등 뒤의 이전 방장에게 처리 결과를 다시 주지 않는다(#808 선례).
                ignored -> groupQueryService.findMembership(userQueryService.getCallerForShare(userId),
                                groupQueryService.getGroup(islandId))
                        .filter(member -> member.getRole() == GroupMemberRole.OWNER)
                        .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_OWNER)),
                () -> {
                    User caller = lockAnswerUsers(userId, applicantId);
                    membershipLocks.lockGroup(islandId);
                    Group island = groupQueryService.getGroup(islandId);
                    IslandMovementGuards.requireAlive(island);
                    groupQueryService.findMembership(caller, island)
                            .filter(member -> member.getRole() == GroupMemberRole.OWNER)
                            .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_OWNER));
                    IslandJoinRequest request = joinRequestRepository
                            .findByIdAndIslandIdForUpdate(requestId, islandId)
                            .orElseThrow(() -> new GroupException(GroupErrorCode.JOIN_REQUEST_NOT_FOUND));
                    if (!request.isPending()) {
                        throw new GroupException(GroupErrorCode.JOIN_REQUEST_TERMINAL);
                    }
                    // 응답 version 은 전이 «후» 요청 버전이다 — 플러시 전 엔티티 값에 UPDATE 의 +1 을 더한다
                    // (IslandJoinRequestEvents 와 같은 보정).
                    long version = (request.getVersion() == null ? 0L : request.getVersion()) + 1;
                    List<EventEnvelope> events = new ArrayList<>();
                    UUID memberId = null;
                    if (approve) {
                        User applicant = userQueryService.findActiveForUpdate(request.getApplicant().getId())
                                .orElseThrow(() -> new UserException(UserErrorCode.TARGET_USER_NOT_FOUND));
                        Optional<GroupMember> prior = groupMemberRepository.findAnyByUserAndGroup(applicant, island);
                        if (prior.isPresent() && !prior.get().isLeft()) {
                            throw new GroupException(GroupErrorCode.ALREADY_MEMBER);
                        }
                        if (prior.isPresent() && prior.get().isKicked()) {
                            throw new GroupException(GroupErrorCode.KICKED_CANNOT_REJOIN);
                        }
                        GroupInviteLink invitation = request.getInviteLinkId() == null ? null
                                : requireIssuerCurrent(island, inviteLinkRepository.findById(request.getInviteLinkId())
                                        .orElseThrow(() -> new InviteLinkException(
                                                InviteLinkErrorCode.INVITATION_EXPIRED)));
                        movementGuards.requireJoinedIslandLimit(applicant);
                        requireCapacity(island);
                        GroupMember membership = admit(applicant, island, prior);
                        request.approve();
                        events.add(membershipEvents.changed(islandId, userId, "MEMBER_ADDED"));
                        if (invitation != null) {
                            linkMembershipEventService.recordJoinAttribution(islandId, applicant.getId(),
                                    invitation.getSlug(), "invite", membership.getMembershipEpoch());
                        }
                        memberId = applicant.getId();
                    } else {
                        request.reject();
                    }
                    events.addAll(joinRequestEvents.changed(request, userId));
                    return new PublicCommandResult(200, InternalJson.tree(new JoinRequestAnswerView(
                            request.getStatus().wireName(), memberId, version)), InternalJson.tree(events));
                }).value().data();
        return InternalJson.decode(data, JoinRequestAnswerView.class);
    }

    // ---------------------------------------------------------------- 내부

    /**
     * 방장(공유)과 신청자(배타)를 UUID 오름차순으로 잠근다. 신청자를 못 찾았거나(선조회 실패) 방장 본인이면
     * 방장만 잠근다 — 그 경우 뒤의 판정이 404/409 로 끝난다. 탈퇴한 신청자는 잠그지 않고 넘어간다.
     *
     * @return 활성 방장 — 잠금은 호출 트랜잭션이 끝날 때까지 유지된다
     */
    private User lockAnswerUsers(UUID callerId, UUID applicantId) {
        if (applicantId != null && applicantId.compareTo(callerId) < 0) {
            userQueryService.findActiveForUpdate(applicantId);
        }
        User caller = userQueryService.getCallerForShare(callerId);
        if (applicantId != null && applicantId.compareTo(callerId) > 0) {
            userQueryService.findActiveForUpdate(applicantId);
        }
        return caller;
    }

    /** 새 멤버십을 만들거나 자진 탈퇴 행을 되살린다 — 즉시 가입과 승인이 같은 전이를 쓴다. */
    private GroupMember admit(User user, Group island, Optional<GroupMember> prior) {
        if (prior.isPresent()) {
            GroupMember membership = prior.get();
            membership.rejoin(clock.instant());
            // 재가입은 새 세대 — 이 사람이 발급한 옛 초대 코드는 이 전이로 폐기된다.
            linkMembershipEventService.recordMembershipRejoined(membership);
            return membership;
        }
        return groupMemberRepository.save(GroupMember.builder()
                .user(user).group(island).role(GroupMemberRole.MEMBER).build());
    }

    /**
     * 초대 참조를 가입 커밋 안에서 다시 검증한다 — 그룹 일치·발급자 활성 멤버십·발급 세대.
     * 발급자 멤버십은 공유 잠금으로 잡아 이탈·강퇴의 배타 잠금과 직렬화한다.
     *
     * @return 유효한 초대 링크, 없으면 null. <b>무효한 토큰은 null 이 아니라 410 이다</b> —
     *         값을 보냈는데 조용히 무시하면 앱은 초대로 들어왔다고 믿은 채 일반 가입이 된다
     */
    private GroupInviteLink revalidateInvitation(Group island, String rawToken) {
        String token = normalizeToken(rawToken);
        if (token == null) {
            return null;
        }
        // 형식 오류는 422 — resolve 의 code 와 같은 공유 형식이다. 형식은 맞지만 없거나
        // 섬이 다르거나 세대가 어긋난 토큰만 410 으로 간다(§4 에러 표 — «늦은 token»).
        if (!SlugGenerator.FORMAT.matcher(token).matches()) {
            throw new InviteLinkException(InviteLinkErrorCode.INVITATION_CODE_INVALID);
        }
        return requireIssuerCurrent(island, inviteLinkRepository.findBySlug(token)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.INVITATION_EXPIRED)));
    }

    /**
     * 초대 근거를 커밋 안에서 재검증한다 — 그룹 일치·발급자 활성 멤버십(공유 잠금)·발급 세대. 즉시 가입과
     * 초대 기반 pending 의 승인(섬 관리 LLD §3.4)이 같은 규칙을 쓴다. 어긋나면 410 이다.
     */
    private GroupInviteLink requireIssuerCurrent(Group island, GroupInviteLink link) {
        if (!link.getGroupId().equals(island.getId())) {
            throw new InviteLinkException(InviteLinkErrorCode.INVITATION_EXPIRED);
        }
        GroupMember issuer = groupMemberRepository
                .findActiveByUserIdAndGroupIdForShare(link.getInviterId(), island.getId())
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.INVITATION_EXPIRED));
        if (issuer.getMembershipEpoch() != link.getIssuanceEpoch()) {
            throw new InviteLinkException(InviteLinkErrorCode.INVITATION_EXPIRED);
        }
        return link;
    }

    /** 그 섬의 현재 방장 — 방장 공백 구간이면 null 이고 사건은 신청자에게만 간다. */
    private UUID currentHost(UUID islandId) {
        return groupMemberRepository.findActiveOwnersByGroupId(islandId).stream()
                .map(member -> member.getUser().getId())
                .findFirst()
                .orElse(null);
    }

    /**
     * 정원 판정 (GROMO-1993) — 「정원에는 방장을 포함한 현재 주민만 센다. 승인 대기 중인 가입 신청과
     * NPC 는 세지 않는다」. 모수는 {@code group_members} 의 활성 행이라 신청은 자연히 빠진다.
     *
     * <p><b>동시성</b>: 호출자가 이미 {@code membershipLocks.lockGroup} 으로 groups 행을
     * {@code FOR UPDATE} 잡은 뒤다. 그 섬에 멤버십을 넣는 모든 경로(즉시 가입·승인·레거시
     * {@code GroupService.joinGroup})가 같은 잠금을 먼저 지나므로 count → insert 가 섬 단위로
     * 직렬화된다 — 정책 「마지막 한 자리에 동시에 가입하면 한 명만 성공한다」가 이것으로 성립한다.
     */
    private void requireCapacity(Group island) {
        long members = groupMemberRepository.countByGroupIdIn(List.of(island.getId())).stream()
                .mapToLong(row -> row.getMemberCount())
                .sum();
        if (island.getMaxMembers() <= members) {
            throw new GroupException(GroupErrorCode.ROOM_FULL);
        }
    }

    private static String normalizeToken(String raw) {
        return raw == null || raw.isBlank() ? null : raw.trim().toLowerCase(Locale.ROOT);
    }
}
