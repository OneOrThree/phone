package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.construction.repository.IslandConstructionStateRepository;
import com.oneorthree.phone.construction.repository.IslandWalletRepository;
import com.oneorthree.phone.construction.repository.domain.IslandConstructionState;
import com.oneorthree.phone.construction.repository.domain.IslandWallet;
import com.oneorthree.phone.construction.service.IslandFacilityQueryService;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.UserIslandContextRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.repository.domain.UserIslandContext;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.group.service.IslandMembershipEvents;
import com.oneorthree.phone.group.service.IslandStateEvents;
import com.oneorthree.phone.group.service.UserIslandContextLockService;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.CurrentIslandView;
import com.oneorthree.phone.internal.dto.IslandCreatedView;
import com.oneorthree.phone.internal.dto.IslandDetailView;
import com.oneorthree.phone.internal.dto.IslandDiscoverPageView;
import com.oneorthree.phone.internal.dto.IslandSearchPageView;
import com.oneorthree.phone.internal.dto.IslandSummaryView;
import com.oneorthree.phone.internal.dto.IslandViewResponse;
import com.oneorthree.phone.internal.dto.MyIslandsView;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 섬 생성·조회·탐색·현재 섬 이동 (GROMO-1759) — 섬 소속 LLD §3.1~§3.6 의 6종.
 *
 * <p>「섬」은 저장 계층의 {@code groups} 다. 별도 테이블을 만들지 않는다(PRD 목적과 범위).
 *
 * <p><b>잠금 순서</b> 는 {@code UserIslandContextLockService} 가 고정한 {@code users/context →
 * groups → memberships} 다(LLD §4). 쓰기 경로는 먼저 {@code getCallerForUpdate} 로 users 행을 배타로
 * 잡고 그 위에서 context 를 잠근다 — 컨텍스트 잠금 계약이 {@code User} 파라미터로 그 선행 조건을
 * 표현한다. 기존 {@code GroupService.joinGroup} 의 {@code users → group → memberships} 와 같은
 * 방향이라 역순 교착이 생기지 않는다.
 *
 * <p><b>이 티켓이 배선하는 구멍</b>: GROMO-1907 이 {@code user_island_contexts} 와 잠금만 만들고
 * 이동을 되돌려 놨고, GROMO-1764 의 집중 시작은 현재 섬이 맞지 않으면 거절한다. 즉 지금까지
 * {@code currentIslandId} 를 <b>쓰는 코드가 하나도 없어</b> 집중 시작이 성공할 수 없었다. 여기의
 * create/switch 가 그 유일한 writer 다.
 */
@Service
@Slf4j
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class IslandMembershipService {

    /** 계정당 소속 상한 — 기존 {@code GroupService.MAX_JOINED_GROUPS} 와 같은 값이다. */
    private static final int MAX_JOINED_ISLANDS = 10;

    /** 생성 시 기본 정원 — 기존 {@code createGroup} 의 미입력 기본값과 같다. */
    private static final int DEFAULT_MAX_MEMBERS = 10;

    private static final String VISIBILITY_PUBLIC = "public";
    private static final String VISIBILITY_PRIVATE = "private";
    private static final String STATUS_ACTIVE = "active";
    private static final String STATUS_NONE = "none";
    private static final String ROLE_HOST = "host";
    private static final String ROLE_MEMBER = "member";

    private final UserQueryService userQueryService;
    private final GroupQueryService groupQueryService;
    private final UserIslandContextLockService userIslandContextLockService;
    private final UserIslandContextRepository userIslandContextRepository;
    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final GroupMembershipMutationLocks membershipLocks;
    private final IslandMembershipEvents membershipEvents;
    private final IslandStateEvents islandStateEvents;
    private final PublicCommandService publicCommands;
    private final IslandWalletRepository islandWalletRepository;
    private final IslandConstructionStateRepository islandConstructionStateRepository;
    private final IslandFacilityQueryService islandFacilityQueryService;

    // ---------------------------------------------------------------- §3.1 create

    /**
     * 섬을 만들고 생성자를 방장으로 앉힌 뒤 현재 섬을 새 섬으로 옮긴다 (LLD §3.1).
     *
     * <p>진행 중 집중 세션이 있으면 409 다. 「생성으로 이동 가드를 우회하지 못하게」라는 §3.1 의
     * 요구를 그대로 옮긴 것이고, 검사에는 GROMO-1764 의 집중 시작이 쓰는 <b>같은</b> 저장소 메서드를
     * 쓴다 — 두 경로가 다른 기준으로 "진행 중"을 판단하면 한쪽으로 빠져나갈 수 있다.
     */
    @Transactional
    public IslandCreatedView create(UUID userId, CreateIslandCommandRequest request, UUID idempotencyKey) {
        String intro = request.intro() == null ? "" : request.intro();
        PublicCommandRequest command = new PublicCommandRequest(userId, "POST:/islands:" + userId,
                idempotencyKey, tree(Map.of("name", request.name(), "intro", intro,
                        "approvalRequired", request.approvalRequired())));
        JsonNode data = publicCommands.run(command,
                () -> userQueryService.getCallerForUpdate(userId),
                ignored -> userQueryService.getCallerForUpdate(userId),
                () -> {
                    User user = userQueryService.getCallerForUpdate(userId);
                    UserIslandContext context = userIslandContextLockService.lock(user);
                    requireNoLiveFocusSession(user);
                    requireDepartureUnlocked(context);
                    requireJoinedIslandLimit(user);

                    Group island = groupRepository.save(Group.builder()
                            .name(request.name())
                            .description(intro)
                            .maxMembers(DEFAULT_MAX_MEMBERS)
                            .isPrivate(false)
                            .approvalRequired(request.approvalRequired())
                            .build());
                    groupMemberRepository.save(GroupMember.builder()
                            .user(user).group(island).role(GroupMemberRole.OWNER).build());
                    // 섬 생성과 함께 0원 공동 지갑·빈 건설 상태를 만든다(GROMO-1767) — 지갑 부재로
                    // 건설 조회가 깨지는 섬이 생기지 않게 한다.
                    islandWalletRepository.save(IslandWallet.empty(island.getId()));
                    islandConstructionStateRepository.save(IslandConstructionState.empty(island.getId()));
                    context.moveTo(island.getId());

                    EventEnvelope created = islandStateEvents.created(island.getId(), userId);
                    EventEnvelope members = membershipEvents.changed(island.getId(), userId, "MEMBER_ADDED");
                    IslandCreatedView view = new IslandCreatedView(
                            island.getId(), STATUS_ACTIVE, ROLE_HOST, island.getId());
                    return new PublicCommandResult(201, tree(view), tree(List.of(created, members)));
                }).value().data();
        return decode(data, IslandCreatedView.class);
    }

    // ---------------------------------------------------------------- §3.6 switch

    /**
     * 현재 섬을 옮긴다 (LLD §3.6).
     *
     * <p><b>같은 섬 PUT 은 상태확인</b> 이다 — 세션 가드보다 먼저 빠져나가고 이벤트도 membership 도
     * 만들지 않는다. 실질 이동이 없는 요청을 «진행 중 세션» 으로 막으면 집중 중에 현재 섬을 다시
     * 확인하는 것만으로 409 가 나서 앱이 자기 상태를 읽지 못한다.
     *
     * <p>상태확인이라도 <b>멤버십은 다시 본다</b> — 강퇴된 뒤 같은 섬으로 PUT 하면 200 이 아니라 403 이다
     * (저장된 현재 섬은 강퇴로 비워지지 않는다, {@link #liveCurrentIsland}). 그래서 «같은 섬» 판정을 그룹
     * 잠금과 활성 membership 확인 <b>뒤</b> 에 둔다 — 잠금 순서(users/context → groups → memberships)도
     * 그 자리라야 지켜진다.
     */
    @Transactional
    public CurrentIslandView switchCurrentIsland(UUID userId, UUID islandId, UUID idempotencyKey) {
        PublicCommandRequest command = new PublicCommandRequest(userId, "PUT:/me/current-island:" + userId,
                idempotencyKey, tree(Map.of("islandId", islandId.toString())));
        JsonNode data = publicCommands.run(command,
                () -> userQueryService.getCallerForUpdate(userId),
                ignored -> userQueryService.getCallerForUpdate(userId),
                () -> {
                    User user = userQueryService.getCallerForUpdate(userId);
                    UserIslandContext context = userIslandContextLockService.lock(user);
                    membershipLocks.lockGroup(islandId);
                    Group island = groupQueryService.getGroup(islandId);
                    requireAlive(island);
                    groupMemberRepository.findActiveByUserIdAndGroupIdForShare(userId, islandId)
                            .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
                    if (islandId.equals(context.getCurrentIslandId())) {
                        // 상태확인 — 위의 생존·멤버십 검사는 통과했고, 이동이 없으니 세션 가드는 걸지 않는다.
                        return new PublicCommandResult(200,
                                tree(new CurrentIslandView(islandId)), tree(List.of()));
                    }
                    requireNoLiveFocusSession(user);
                    requireDepartureUnlocked(context);

                    context.moveTo(islandId);
                    // 개인 선택 변경은 가입/이탈이 아니다 — island.members.updated 로 방송하지 않는다(§3.6).
                    return new PublicCommandResult(200,
                            tree(new CurrentIslandView(islandId)), tree(List.of()));
                }).value().data();
        return decode(data, CurrentIslandView.class);
    }

    // ---------------------------------------------------------------- §3.4 island

    /**
     * 섬 하나를 본다 (LLD §3.4). 활성 주민이면 상세, 비소속이면 공개 요약이다.
     *
     * <p>범위는 <b>오직 DB 상태</b> 로 정한다. 이 서명에는 {@code role}·{@code isMember} 같은 입력이
     * 아예 없고 주체는 {@code InternalAuthFilter} 가 검증한 값만 들어온다 — "X-User-Id·role·isMember
     * query/header 로 분기를 고를 수 없다"(§3.4)를 «받지 않는 것» 으로 보장한다.
     */
    public IslandViewResponse view(UUID islandId, UUID viewerUserId) {
        // 호출자 검증이 그룹 조회보다 먼저다(GROMO-1247 계약) — 탈퇴 계정이 섬 존재 여부를 떠보지 못한다.
        User viewer = userQueryService.getCaller(viewerUserId);
        Group island = groupQueryService.findGroup(islandId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.GROUP_NOT_FOUND));
        requireAlive(island);

        Optional<GroupMember> membership = groupMemberRepository.findByUserAndGroup(viewer, island);
        int memberCount = memberCountOf(islandId);
        if (membership.isEmpty()) {
            if (island.isPrivate()) {
                // 비공개 섬의 ID 직접 조회 — 404 로 숨기지 않고 403 이다(§3.4).
                throw new GroupException(GroupErrorCode.MEMBER_ONLY);
            }
            return IslandViewResponse.ofVisitor(summaryOf(island, memberCount, STATUS_NONE));
        }
        return IslandViewResponse.ofMember(new IslandDetailView(
                island.getId(), island.getName(), introOf(island), visibilityOf(island),
                island.isApprovalRequired(), memberCount, STATUS_ACTIVE, null, null,
                roleOf(membership.get()), island.getVersion() == null ? 0L : island.getVersion()));
    }

    // ---------------------------------------------------------------- §3.5 memberships

    /** 내 섬 목록 (LLD §3.5). 소속 상한 10 이라 페이지가 없다. */
    public MyIslandsView myIslands(UUID userId) {
        userQueryService.getCaller(userId);
        List<Group> islands = groupMemberRepository.findActiveMembershipsByUserId(userId).stream()
                // 정렬은 membership 생성시각+id 로 안정화한다(§3.5).
                .sorted(Comparator.comparing(GroupMember::getCreatedAt).thenComparing(GroupMember::getId))
                .map(GroupMember::getGroup)
                .filter(IslandMembershipService::isAlive)
                .toList();
        Map<UUID, Integer> counts = memberCountsOf(islands.stream().map(Group::getId).toList());
        List<IslandSummaryView> items = islands.stream()
                .map(island -> summaryOf(island, counts.getOrDefault(island.getId(), 0), STATUS_ACTIVE))
                .toList();
        return new MyIslandsView(items, liveCurrentIsland(userId));
    }

    // ---------------------------------------------------------------- §3.2 islands

    /**
     * 이름 검색 (LLD §3.2). public·생존 섬만, 커서 페이징.
     *
     * <p><b>전망대 가드</b> 가 걸린다 — 첫 소속 탐색은 discover 를 쓰므로 이 검색의 시설 가드를 풀어
     * 우회시키지 않는다(§3.2). 지금 실제로 무엇까지 검사되는지는
     * {@link #requireObservatoryUnlocked} 의 javadoc 에 적어 뒀다.
     *
     * <p>코드 정확매칭 분기는 <b>켜지 않았다</b>. §3.2 가 "이 흐름은 IM-D01 의 코드/slug 관계 결정 후
     * 활성화한다"고 했고 PRD 는 "미답은 승인으로 간주하지 않는다"고 못 박았다. 그래서 {@code q} 는
     * 이름으로만 쓰이고, 초대 코드처럼 생긴 입력도 이름 검색으로만 처리한다.
     */
    public IslandSearchPageView search(UUID userId, String q, UUID cursorIslandId, int limit) {
        User user = userQueryService.getCaller(userId);
        requireObservatory(user);

        String cursor = cursorIslandId == null ? null : cursorIslandId.toString();
        List<UUID> ids = (q == null || q.isBlank())
                ? groupRepository.findRecentPublicIslandIds(cursor, limit)
                : groupRepository.searchPublicIslandIdsByName(q, cursor, limit);
        return new IslandSearchPageView(summariesOf(userId, ids), nextIdOf(ids, limit));
    }

    // ---------------------------------------------------------------- §3.3 discover

    /**
     * 첫 소속 탐색 (LLD §3.3). 전망대 가드가 <b>없다</b> — 아직 섬이 없는 사람을 위한 경로다.
     *
     * <p>후보 조건은 공개·{@code approvalRequired=false}·미소속·미종료·미삭제·실제 가입 가능 정원이며
     * 강퇴 이력이 있는 섬은 제외한다. 「즉시 가입 가능」이라고 보여 준 뒤 가입에서 막히지 않게
     * 하려는 것이라 정원과 강퇴를 SQL 에서 함께 건다.
     *
     * <p>탐색 세션이 시작된 <b>뒤에 생긴</b> 섬도 뒷 페이지에 노출된다 — 매 페이지 후보를 다시 조회하고
     * 순서가 {@code md5(seed || id)} 라 그 값이 경계보다 크면 실린다. 의도적이다: 후보 집합을 세션 시작
     * 시점에 동결하려면 서버 세션 테이블이 필요하고, PRD 는 동결 여부를 명시하지 않았다(제품 결정 대기).
     */
    public IslandDiscoverPageView discover(UUID userId, String seed, String afterHandle, int limit) {
        userQueryService.getCaller(userId);
        List<UUID> ids = groupRepository.findDiscoverableIslandIds(
                userId.toString(), seed, afterHandle, limit);
        UUID last = nextIdOf(ids, limit);
        return new IslandDiscoverPageView(summariesOf(userId, ids),
                last == null ? null : handle(seed, last));
    }

    /**
     * 발견 순서를 만드는 셔플 핸들 — Postgres 의 {@code md5(seed || id::text)} 와 <b>같은 값</b> 이어야
     * 한다. {@code uuid::text} 와 {@link UUID#toString()} 이 둘 다 소문자 표준형이라 일치한다.
     */
    static String handle(String seed, UUID islandId) {
        try {
            byte[] digest = MessageDigest.getInstance("MD5")
                    .digest((seed + islandId).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(32);
            for (byte value : digest) {
                hex.append(Character.forDigit((value >> 4) & 0xF, 16));
                hex.append(Character.forDigit(value & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("MD5 를 초기화할 수 없습니다", e);
        }
    }

    /** 페이지를 가득 채웠을 때만 다음 경계가 있다 — 덜 찼으면 소진이라 {@code nextCursor} 가 null 이다. */
    private static UUID nextIdOf(List<UUID> ids, int limit) {
        return ids.size() < limit || ids.isEmpty() ? null : ids.get(ids.size() - 1);
    }

    // ---------------------------------------------------------------- 가드

    /**
     * 진행 중 집중 세션이 있으면 거절한다 (LLD §3.1·§3.6, PRD M07).
     *
     * <p>GROMO-1764 의 집중 시작과 <b>같은</b> 저장소 메서드를 쓴다. 일시정지(paused) 세션도 기본 행의
     * {@code endedAt} 이 null 이라 같은 조회에 잡힌다 — "active/paused 가 없어야 한다"는 요구가 이 한
     * 조회로 충족된다.
     */
    private void requireNoLiveFocusSession(User user) {
        if (focusSessionRepository.findFirstByUserAndEndedAtIsNullOrderByStartedAtDesc(user).isPresent()) {
            throw new FocusException(FocusErrorCode.SESSION_IN_PROGRESS);
        }
    }

    private void requireJoinedIslandLimit(User user) {
        if (groupMemberRepository.countByUser(user) >= MAX_JOINED_ISLANDS) {
            throw new GroupException(GroupErrorCode.GROUP_LIMIT_EXCEEDED);
        }
    }

    /**
     * 출발 섬 전망대 조건 (LLD §3.1·§3.6, HLD §3).
     *
     * <p>현재 섬이 없으면 조건이 없다 — "첫 소속에는 기존 출발 섬이 없으므로 전망대 조건이 적용되지
     * 않는다"(HLD §3).
     *
     * <p><b>여기서 null 을 첫 소속으로 읽어도 되는 이유.</b> §3.6 은 "{@code currentIslandId=null} 을
     * 첫 소속으로 간주하지 않는다"고 경고하는데, 그 경고는 <b>현재 섬을 잃은 뒤의 null</b> 을 첫
     * 소속으로 오인해 전망대 gate 를 우회하는 경우를 막으려는 것이다(IM-D06). 이 레포에는 아직
     * {@code currentIslandId} 를 <b>null 로 되돌리는 코드가 없다</b> — 유일한 writer 가 이 클래스의
     * {@code moveTo} 두 곳이고 둘 다 non-null 을 쓴다. 그래서 오늘 null 은 «한 번도 가진 적이 없다»
     * 와 동치다.
     *
     * <p><b>다음 사람에게.</b> 이탈·강퇴·섬 종료가 컨텍스트를 해제하는 경로를 넣는 순간 이 등식이
     * 깨진다. 그 경로를 만들기 전에 IM-D06(상실 이유·복구 근거)이 승인돼야 하고 이 메서드는 그때
     * {@code lossReason} 을 읽도록 바뀌어야 한다. 순서를 뒤집어 컨텍스트 해제를 먼저 넣으면 «이탈 →
     * null → 첫 소속으로 재선택» 으로 전망대를 우회할 수 있다. 그래서 이 티켓은 해제를 넣지 않았다.
     */
    private void requireDepartureUnlocked(UserIslandContext context) {
        UUID departure = context.getCurrentIslandId();
        if (departure == null) {
            return;
        }
        requireObservatoryUnlocked(departure);
    }

    /**
     * 검색 진입 가드 — 현재 섬과 그 섬의 전망대가 필요하다(LLD §3.2).
     *
     * <p>저장값이 아니라 {@link #liveCurrentIsland} 를 본다. 강퇴·탈퇴는 컨텍스트를 비우지 않으므로
     * 저장값만 믿으면 «죽은 현재 섬» 으로 활성 소속이 하나도 없는 사용자가 전역 검색을 연다.
     */
    private void requireObservatory(User user) {
        UUID current = liveCurrentIsland(user.getId());
        if (current == null) {
            throw new GroupException(GroupErrorCode.OBSERVATORY_LOCKED);
        }
        requireObservatoryUnlocked(current);
    }

    /**
     * 섬의 전망대가 열렸는지 — 건설 도메인(GROMO-1767)의 {@code island_facilities} 행으로 판정한다.
     * 전망대가 COMPLETED 가 아니면 403 {@link GroupErrorCode#OBSERVATORY_LOCKED} 다.
     * 호출부는 두 곳({@link #requireDepartureUnlocked}·{@link #requireObservatory})이다.
     */
    private void requireObservatoryUnlocked(UUID islandId) {
        if (!islandFacilityQueryService.hasObservatory(islandId)) {
            throw new GroupException(GroupErrorCode.OBSERVATORY_LOCKED);
        }
    }

    private static void requireAlive(Group island) {
        if (!isAlive(island)) {
            throw new GroupException(GroupErrorCode.GROUP_NOT_FOUND);
        }
    }

    private static boolean isAlive(Group island) {
        return island.getDeletedAt() == null && island.getStatus() != GroupStatus.ENDED;
    }

    // ---------------------------------------------------------------- 매핑

    private UUID storedCurrentIsland(UUID userId) {
        return userIslandContextRepository.findById(userId)
                .map(UserIslandContext::getCurrentIslandId)
                .orElse(null);
    }

    /**
     * 저장된 현재 섬이 «지금도 활성·생존 소속» 일 때만 그 id 를 준다 (LLD §3.5) — 아니면 «현재 섬 없음» 이다.
     *
     * <p>강퇴·탈퇴는 membership 만 비활성화하고 컨텍스트를 비우지 않는다 — 비우는 쓰기가 곧 IM-D06 이
     * 관장하는 «현재 섬 상실» 이라 이 티켓이 일부러 넣지 않았다. 그래서 저장값을 그대로 믿으면 죽은
     * 현재 섬이 검색 가드를 통과시키고 목록에 현재 섬으로 보인다. 읽기 경로(검색 가드·내 섬 목록)는
     * 전부 이 술어를 쓰고, 쓰기 경로({@link #switchCurrentIsland})는 같은 두 조건(활성 membership +
     * 생존)을 잠금 아래에서 직접 확인한다. 저장값을 null 로 «쓰지는» 않는다.
     */
    private UUID liveCurrentIsland(UUID userId) {
        UUID stored = storedCurrentIsland(userId);
        if (stored == null) {
            return null;
        }
        boolean live = groupMemberRepository.findActiveMembershipsByUserId(userId).stream()
                .map(GroupMember::getGroup)
                .anyMatch(island -> island.getId().equals(stored) && isAlive(island));
        return live ? stored : null;
    }

    private List<IslandSummaryView> summariesOf(UUID userId, List<UUID> orderedIds) {
        if (orderedIds.isEmpty()) {
            return List.of();
        }
        Map<UUID, Group> byId = groupRepository.findAllById(orderedIds).stream()
                .collect(Collectors.toMap(Group::getId, island -> island));
        Map<UUID, Integer> counts = memberCountsOf(orderedIds);
        Set<UUID> mine = new HashSet<>(groupMemberRepository.findActiveGroupIdsByUserId(userId));
        List<IslandSummaryView> items = new ArrayList<>(orderedIds.size());
        for (UUID id : orderedIds) {
            Group island = byId.get(id);
            if (island != null) {
                items.add(summaryOf(island, counts.getOrDefault(id, 0),
                        mine.contains(id) ? STATUS_ACTIVE : STATUS_NONE));
            }
        }
        return items;
    }

    private IslandSummaryView summaryOf(Group island, int memberCount, String membershipStatus) {
        return new IslandSummaryView(island.getId(), island.getName(), introOf(island),
                visibilityOf(island), island.isApprovalRequired(), memberCount, membershipStatus,
                null, null);
    }

    /** 기존 nullable {@code description} 의 공개 projection — DB 값은 바꾸지 않는다(LLD §2). */
    private static String introOf(Group island) {
        return island.getDescription() == null ? "" : island.getDescription();
    }

    private static String visibilityOf(Group island) {
        return island.isPrivate() ? VISIBILITY_PRIVATE : VISIBILITY_PUBLIC;
    }

    private static String roleOf(GroupMember member) {
        return member.getRole() == GroupMemberRole.OWNER ? ROLE_HOST : ROLE_MEMBER;
    }

    private int memberCountOf(UUID islandId) {
        return memberCountsOf(List.of(islandId)).getOrDefault(islandId, 0);
    }

    private Map<UUID, Integer> memberCountsOf(Collection<UUID> islandIds) {
        if (islandIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, Integer> counts = new HashMap<>();
        groupMemberRepository.countByGroupIdIn(islandIds).forEach(row ->
                counts.put(row.getGroupId(), (int) row.getMemberCount()));
        return counts;
    }

    // ---------------------------------------------------------------- 멱등 코덱

    private static JsonNode tree(Object value) {
        try {
            return OutboxEnvelopeCodec.fromJson(OutboxEnvelopeCodec.toJson(value), JsonNode.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("섬 명령 직렬화 실패", e);
        }
    }

    private static <T> T decode(JsonNode data, Class<T> type) {
        try {
            return OutboxEnvelopeCodec.fromJson(data.toString(), type);
        } catch (JsonProcessingException e) {
            throw new OutboxException(OutboxErrorCode.IDEMPOTENT_REPLAY_FAILED);
        }
    }
}
