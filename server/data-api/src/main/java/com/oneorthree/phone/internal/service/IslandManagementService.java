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
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.group.service.IslandMembershipEvents;
import com.oneorthree.phone.group.service.IslandStateEvents;
import com.oneorthree.phone.group.service.LinkMembershipEventService;
import com.oneorthree.phone.internal.dto.IslandJoinRequestsPageView;
import com.oneorthree.phone.internal.dto.IslandLeftView;
import com.oneorthree.phone.internal.dto.IslandManageCommandRequest;
import com.oneorthree.phone.internal.dto.IslandManageView;
import com.oneorthree.phone.internal.dto.IslandMemberRemovedView;
import com.oneorthree.phone.internal.dto.IslandMembersPageView;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.repository.AggregateVersionRepository;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersion;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersionId;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 섬 관리·주민 잔여 계약 (GROMO-1802, 섬 관리 LLD §3.1~§3.3·§3.6·§3.7) — 정보 수정·주민 목록·신청자 목록·
 * 강퇴·나가기. 승인/거절(§3.4)은 가입 전이를 공유하므로 {@link IslandJoinService#answer} 에 있다.
 *
 * <h2>명령은 기본 비활성</h2>
 * {@code island-management.commands-enabled} 가 false 면 네 명령(수정·승인/거절·강퇴·나가기)은 receipt 선점·
 * 잠금·쓰기보다 앞서 503 이다 — 방장 위임 게이트({@code InternalHostTransferService})와 같은 모양이다.
 * 전용 Realtime 수신·인가 철회·주민 snapshot 복구가 검증되기 전에는 열지 않는다. 조회 둘은 게이트가 없다.
 *
 * <h2>권한은 DB 의 현재 역할로만</h2>
 * Business 의 사전 판정·캐시를 믿지 않는다. 쓰기는 {@code users → groups → memberships} 잠금 아래에서
 * 역할을 다시 읽고, 위임 커밋 뒤 이전 방장의 첫 요청은 403 이다(권한 행렬 «동시성 판정»).
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class IslandManagementService {

    private static final int MAX_LIMIT = 100;
    /** 첫 페이지 경계 — 어떤 행보다도 이르다. 실제 행의 {@code (createdAt, id)} 는 이 값이 될 수 없다. */
    private static final Instant FIRST_AT = Instant.EPOCH;
    private static final UUID FIRST_ID = new UUID(0L, 0L);

    private final UserQueryService userQueryService;
    private final GroupQueryService groupQueryService;
    private final GroupMembershipMutationLocks membershipLocks;
    private final GroupMemberRepository groupMemberRepository;
    private final IslandJoinRequestRepository joinRequestRepository;
    private final AggregateVersionRepository aggregateVersions;
    private final GroupMemberService membershipCommands;
    private final IslandStateEvents islandStateEvents;
    private final LinkMembershipEventService linkMembershipEventService;
    private final IslandMovementGuards movementGuards;
    private final PublicCommandService publicCommands;

    @Value("${island-management.commands-enabled:false}")
    private boolean enabled;

    // ---------------------------------------------------------------- §3.1 manage

    /**
     * 섬 정보 수정 — 방장만. 누락 필드는 보존하고 실제로 바뀐 것이 없으면 사건·버전을 만들지 않는다(LLD §2).
     *
     * <p>이름이 실제로 바뀔 때만 같은 트랜잭션에 링크 표시정보 {@code group.renamed} 를 남긴다 — 기존
     * {@code GroupService.updateGroup} 과 같은 {@code recordGroupRenamed} 이고, 멤버십 세대는 올리지 않는다.
     * 가입 방식 전환은 이미 열린 요청을 자동 승인·거절하지 않는다.
     */
    @Transactional
    public IslandManageView manage(UUID userId, UUID islandId, IslandManageCommandRequest body, UUID key) {
        requireEnabled();
        Map<String, Object> fingerprint = new LinkedHashMap<>();
        if (body.name() != null) {
            fingerprint.put("name", body.name());
        }
        if (body.intro() != null) {
            fingerprint.put("intro", body.intro());
        }
        if (body.approvalRequired() != null) {
            fingerprint.put("approvalRequired", body.approvalRequired());
        }
        PublicCommandRequest command = new PublicCommandRequest(userId, "PATCH:/islands/" + islandId, key,
                InternalJson.tree(fingerprint));
        JsonNode data = publicCommands.run(command,
                () -> userQueryService.getCallerForShare(userId),
                ignored -> userQueryService.getCallerForShare(userId),
                () -> {
                    Group island = lockIslandAsHost(userQueryService.getCallerForShare(userId), islandId);
                    boolean renamed = body.name() != null && !body.name().equals(island.getName());
                    boolean introChanged = body.intro() != null && !body.intro().equals(intro(island));
                    boolean approvalChanged = body.approvalRequired() != null
                            && body.approvalRequired() != island.isApprovalRequired();
                    if (renamed) {
                        island.updateName(body.name());
                        linkMembershipEventService.recordGroupRenamed(island);
                    }
                    if (introChanged) {
                        island.updateDescription(body.intro());
                    }
                    if (approvalChanged) {
                        island.updateApprovalRequired(body.approvalRequired());
                    }
                    List<EventEnvelope> events = renamed || introChanged || approvalChanged
                            ? List.of(islandStateEvents.changed(islandId, userId, "UPDATED"))
                            : List.of();
                    long version = events.isEmpty()
                            ? aggregateVersion(IslandStateEvents.AGGREGATE_TYPE, islandId)
                            : events.get(0).version();
                    return new PublicCommandResult(200, InternalJson.tree(new IslandManageView(island.getId(),
                            island.getName(), intro(island), island.isApprovalRequired(), version)),
                            InternalJson.tree(events));
                }).value().data();
        return InternalJson.decode(data, IslandManageView.class);
    }

    // ---------------------------------------------------------------- §3.2 members

    /**
     * 주민 목록 — 활성 주민만 읽을 수 있고(방문자·pending·이탈자 403), 탈퇴 계정은 목록에서 뺀다.
     *
     * <p>{@code REPEATABLE_READ} 인 이유: 목록 {@code version} 은 응답 행들과 <b>같은 스냅샷</b>에서 읽어야 한다
     * (LLD §3.2). 기본 READ COMMITTED 는 문장마다 스냅샷이 달라, 행을 읽은 뒤 커밋된 가입이 version 에만
     * 반영되면 클라이언트는 새 주민이 빠진 목록을 최신 버전으로 믿는다.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public IslandMembersPageView members(UUID userId, UUID islandId, Instant afterJoinedAt, UUID afterMembershipId,
                                         int limit) {
        requirePage(afterJoinedAt, afterMembershipId, limit);
        User caller = userQueryService.getCaller(userId);
        Group island = groupQueryService.getGroup(islandId);
        IslandMovementGuards.requireAlive(island);
        groupQueryService.getMembership(caller, island);
        List<GroupMember> rows = groupMemberRepository.findActivePageByGroupId(islandId,
                afterJoinedAt == null ? FIRST_AT : afterJoinedAt,
                afterMembershipId == null ? FIRST_ID : afterMembershipId,
                PageRequest.of(0, limit + 1));
        boolean more = rows.size() > limit;
        List<GroupMember> page = more ? rows.subList(0, limit) : rows;
        GroupMember last = more ? page.get(page.size() - 1) : null;
        return new IslandMembersPageView(page.stream()
                .map(member -> new IslandMembersPageView.Item(member.getUser().getId(),
                        member.getUser().getNickname(),
                        member.getRole() == GroupMemberRole.OWNER ? "host" : "member"))
                .toList(),
                last == null ? null : last.getCreatedAt(), last == null ? null : last.getId(),
                aggregateVersion(IslandMembershipEvents.AGGREGATE_TYPE, islandId));
    }

    // ---------------------------------------------------------------- §3.3 requests

    /** 신청자 목록 — 현재 방장만(주민 403), pending 만. 신청자 프로필은 공개 닉네임뿐이다. */
    public IslandJoinRequestsPageView joinRequests(UUID userId, UUID islandId, Instant afterCreatedAt,
                                                   UUID afterRequestId, int limit) {
        requirePage(afterCreatedAt, afterRequestId, limit);
        User caller = userQueryService.getCaller(userId);
        Group island = groupQueryService.getGroup(islandId);
        IslandMovementGuards.requireAlive(island);
        requireHost(caller, island);
        List<IslandJoinRequest> rows = joinRequestRepository.findPageByIslandIdAndStatus(islandId,
                IslandJoinRequestStatus.PENDING,
                afterCreatedAt == null ? FIRST_AT : afterCreatedAt,
                afterRequestId == null ? FIRST_ID : afterRequestId,
                PageRequest.of(0, limit + 1));
        boolean more = rows.size() > limit;
        List<IslandJoinRequest> page = more ? rows.subList(0, limit) : rows;
        IslandJoinRequest last = more ? page.get(page.size() - 1) : null;
        return new IslandJoinRequestsPageView(page.stream()
                .map(request -> new IslandJoinRequestsPageView.Item(request.getId(),
                        request.getApplicant().getId(), request.getApplicant().getNickname(),
                        request.getStatus().wireName(),
                        request.getVersion() == null ? 0L : request.getVersion()))
                .toList(),
                last == null ? null : last.getCreatedAt(), last == null ? null : last.getId());
    }

    // ---------------------------------------------------------------- §3.6 kick

    /**
     * 강퇴 — 판정·잠금·이탈 마킹·링크 폐기·주민 사건은 legacy 강퇴({@code GroupMemberService.kickMember})와
     * 한 경로다. 대상의 진행 중 집중 강제 종료(FR-D03)와 미수령 퀘스트 보상은 이 명령이 다루지 않는다 —
     * 전자는 참고 티켓 1924, 후자는 정책 대기다(LLD §5). 기존 내기 판돈은 그대로 둔다.
     */
    @Transactional
    public IslandMemberRemovedView kick(UUID userId, UUID islandId, UUID targetUserId, UUID key) {
        requireEnabled();
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "DELETE:/islands/" + islandId + "/members/" + targetUserId, key, InternalJson.tree(Map.of()));
        JsonNode data = publicCommands.run(command,
                () -> userQueryService.getCallerForShare(userId),
                ignored -> userQueryService.getCallerForShare(userId),
                () -> {
                    EventEnvelope event = membershipCommands.kickMemberAndRecord(islandId, targetUserId, userId);
                    return new PublicCommandResult(200, InternalJson.tree(new IslandMemberRemovedView(true)),
                            InternalJson.tree(List.of(event)));
                }).value().data();
        return InternalJson.decode(data, IslandMemberRemovedView.class);
    }

    // ---------------------------------------------------------------- §3.7 leave

    /**
     * 나가기 — 진행 중(active/paused) 집중이 있으면 409 이고, 나머지는 legacy 탈퇴
     * ({@code GroupMemberService.withdrawGroup})와 한 경로다: 다인 방장은 위임 선행, 마지막 1인은 섬 종료와
     * pending 전건 cancelled, OPEN 내기 정리·환불이 같은 트랜잭션이다.
     *
     * <p>집중 가드는 사용자 공유 잠금 아래에서 본다 — 집중 시작은 같은 users 행을 배타로 잡으므로 둘 중
     * 하나만 먼저 커밋된다. 현재 섬 context 초기화(IM-D06)와 «마지막 섬은 못 나간다»(참고 티켓 1867)는
     * 승인 전이라 넣지 않는다. 같은 키 재생은 이미 주민이 아닌 본인에게 {@code left:true} 만 돌려준다.
     */
    @Transactional
    public IslandLeftView leave(UUID userId, UUID islandId, UUID key) {
        requireEnabled();
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "DELETE:/islands/" + islandId + "/memberships/me:" + userId, key, InternalJson.tree(Map.of()));
        JsonNode data = publicCommands.run(command,
                () -> userQueryService.getCallerForShare(userId),
                ignored -> userQueryService.getCallerForShare(userId),
                () -> {
                    movementGuards.requireNoLiveFocusSession(userQueryService.getCallerForShare(userId));
                    EventEnvelope event = membershipCommands.withdrawGroupAndRecord(islandId, userId);
                    return new PublicCommandResult(200, InternalJson.tree(new IslandLeftView(true)),
                            InternalJson.tree(List.of(event)));
                }).value().data();
        return InternalJson.decode(data, IslandLeftView.class);
    }

    // ---------------------------------------------------------------- 내부

    private void requireEnabled() {
        if (!enabled) {
            throw new GroupException(GroupErrorCode.ISLAND_MANAGEMENT_NOT_READY);
        }
    }

    /** 그룹 행을 잠근 뒤 생존과 현재 방장 역할을 다시 본다 — 위임과 직렬화된다. */
    private Group lockIslandAsHost(User caller, UUID islandId) {
        membershipLocks.lockGroup(islandId);
        Group island = groupQueryService.getGroup(islandId);
        IslandMovementGuards.requireAlive(island);
        requireHost(caller, island);
        return island;
    }

    private void requireHost(User caller, Group island) {
        groupQueryService.findMembership(caller, island)
                .filter(member -> member.getRole() == GroupMemberRole.OWNER)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_OWNER));
    }

    /** keyset 경계는 둘이 짝이다 — 하나만 오면 커서 위조·배선 사고라 400 이다. limit 기본값은 Business 몫이다. */
    private static void requirePage(Instant after, UUID afterId, int limit) {
        if ((after == null) != (afterId == null) || limit < 1 || limit > MAX_LIMIT) {
            throw new GroupException(GroupErrorCode.INVALID_PAGE_REQUEST);
        }
    }

    /** 기존 소개가 null 이어도 공개 계약은 빈 문자열이다(LLD §3.1) — DB 값은 바꾸지 않는다. */
    private static String intro(Group island) {
        return island.getDescription() == null ? "" : island.getDescription();
    }

    /** aggregate_versions 의 마지막 발급값 — 행이 없으면 0(아직 사건이 없는 축). 건설 조회와 같은 읽기다. */
    private long aggregateVersion(String type, UUID islandId) {
        return aggregateVersions.findById(new AggregateVersionId(type, islandId.toString()))
                .map(AggregateVersion::getLastVersion)
                .orElse(0L);
    }
}
