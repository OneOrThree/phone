package com.oneorthree.phone.construction.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.construction.exception.ConstructionErrorCode;
import com.oneorthree.phone.construction.exception.ConstructionException;
import com.oneorthree.phone.construction.repository.ConstructionCostPolicyRepository;
import com.oneorthree.phone.construction.repository.CostPolicyPublicationRepository;
import com.oneorthree.phone.construction.repository.IslandConstructionContributionRepository;
import com.oneorthree.phone.construction.repository.IslandConstructionStateRepository;
import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.domain.ConstructionBuilding;
import com.oneorthree.phone.construction.repository.domain.ConstructionCostPolicy;
import com.oneorthree.phone.construction.repository.domain.ConstructionCostPolicyId;
import com.oneorthree.phone.construction.repository.domain.CostPolicyPublication;
import com.oneorthree.phone.construction.repository.domain.FacilityStatus;
import com.oneorthree.phone.construction.repository.domain.IslandConstructionState;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.construction.support.SharedPurchase;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.group.service.IslandStateEvents;
import com.oneorthree.phone.construction.dto.ConstructionOptionItem;
import com.oneorthree.phone.construction.dto.ConstructionOptionsView;
import com.oneorthree.phone.construction.dto.ConstructionStartedView;
import com.oneorthree.phone.construction.dto.ConstructionTargetView;
import com.oneorthree.phone.outbox.dto.EventEnvelope;

import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.repository.AggregateVersionRepository;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersion;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersionId;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 섬 건설 1단계 (GROMO-1767, island-construction LLD §2~§4) — 내부 GET options · PUT target ·
 * POST constructions 세 계약의 Data 측 구현이다.
 *
 * <p><b>잠금 순서</b>(LLD §4): 사용자(users 배타) → receipt 선점({@link PublicCommandService}) →
 * 섬(groups 배타) → membership(공유) → 건설 상태 → 시설 → 정책 publication → 지갑. 없는 단계는
 * 건너뛴다. 두 쓰기 계약은 {@code publicCommands.run} 안에서 이 순서를 지키고, 조회는 잠금 없는
 * 일관 읽기다.
 *
 * <p><b>version 축</b>: 응답의 {@code islandVersion}·{@code walletVersion}·{@code costPolicyVersion} 은
 * 각각 aggregate_versions(ISLAND/ISLAND_WALLET) 마지막 발급값과 publication.revision 이다 — Group
 * {@code @Version} 낙관락과는 다른 시계다(LLD §2 「각 projection의 시계」).
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class IslandConstructionService {

    /** 서버 통화 식별자 — 개명 미결로 원본 계약 값을 그대로 쓴다(정책 C05). */
    private static final String CURRENCY = "village_points";
    private static final String STATUS_BUILDING = "BUILDING";

    private final UserQueryService userQueryService;
    private final GroupQueryService groupQueryService;
    private final GroupMemberRepository groupMemberRepository;
    private final GroupMembershipMutationLocks membershipLocks;
    private final IslandConstructionStateRepository states;
    private final IslandFacilityRepository facilities;
    private final IslandConstructionContributionRepository contributions;
    private final ConstructionCostPolicyRepository policies;
    private final CostPolicyPublicationRepository publication;
    private final IslandWalletService walletService;
    private final AggregateVersionRepository aggregateVersions;
    private final IslandStateEvents islandStateEvents;
    private final IslandWalletEvents walletEvents;
    private final PublicCommandService publicCommands;
    private final Clock clock;

    // ---------------------------------------------------------------- GET options

    /**
     * 건설 옵션 조회 — 활성 주민만 본다(LLD §2). 변경 권한이 없는 주민도 403 이 아니라
     * 항목별 {@code selectable=false/blockedReason=FORBIDDEN} 을 받는다(C08).
     *
     * <p>응답의 세 version·잔액·시설·기여는 <b>한 스냅샷</b>이어야 한다 — READ COMMITTED 는
     * 문장마다 스냅샷을 새로 잡아 잔액·시설·정책 revision 이 서로 다른 시점을 섞어 읽을 수
     * 있으므로, PostgreSQL 의 트랜잭션 스냅샷을 주는 {@code REPEATABLE_READ} 로 읽는다
     * ({@code NotificationSnapshotService} 와 같은 방식).
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ConstructionOptionsView options(UUID islandId, UUID userId) {
        User viewer = userQueryService.getCaller(userId);
        Group island = aliveIsland(islandId);
        GroupMember member = groupMemberRepository.findByUserAndGroup(viewer, island)
                .orElseThrow(() -> new ConstructionException(ConstructionErrorCode.CONSTRUCTION_FORBIDDEN));

        int revision = currentRevision();
        Map<String, ConstructionCostPolicy> priceBook = priceBook(revision);
        Map<String, IslandFacility> facilityByBuilding = facilities.findByIslandId(islandId).stream()
                .collect(Collectors.toMap(IslandFacility::getBuildingId, Function.identity()));
        Set<String> completed = facilityByBuilding.values().stream()
                .filter(f -> f.getStatus() == FacilityStatus.COMPLETED)
                .map(IslandFacility::getBuildingId)
                .collect(Collectors.toSet());

        IslandConstructionState state = states.findById(islandId).orElse(null);
        long epoch = state == null ? 0L : state.getTargetEpoch();
        String targetBuildingId = state == null ? null : state.getTargetBuildingId();
        Map<UUID, Integer> contributed = contributedByUser(islandId, epoch);
        int balance = walletService.balanceOf(islandId);
        boolean canSpend = SharedPurchase.canSpend(island, member);
        List<UUID> memberIds = groupMemberRepository.findActiveMemberUserIdsByGroupId(islandId);

        List<ConstructionOptionItem> items = new ArrayList<>();
        for (ConstructionBuilding building : ConstructionBuilding.values()) {
            // 완료 시설은 options 에서 제외한다(LLD §2).
            if (completed.contains(building.id())) {
                continue;
            }
            ConstructionCostPolicy price = requirePrice(priceBook, building);
            items.add(evaluate(islandId, building, price, facilityByBuilding.get(building.id()),
                    completed, canSpend, balance, memberIds, contributed, targetBuildingId));
        }
        return new ConstructionOptionsView(
                aggregateVersion(IslandStateEvents.AGGREGATE_TYPE, islandId),
                revision,
                state == null ? null : state.getTargetBuildingId(),
                balance,
                aggregateVersion(IslandWalletEvents.AGGREGATE_TYPE, islandId),
                items);
    }

    // ---------------------------------------------------------------- PUT target

    /**
     * 목표 변경 — 차감 0(정책 C03). 같은 목표·현재 version 이면 무변경 200/기존 version/빈
     * events(C11). 바뀌는 목표면 island version 과 island.updated 만 올라간다.
     *
     * <p>BUILDING 중에는 새 목표를 받지 않는다 — 공사가 끝나기 전에 목표가 바뀌면 epoch 가
     * 올라가 「각자 몫」집계가 끊기기 때문이다.
     */
    @Transactional
    public ConstructionTargetView setTarget(UUID islandId, UUID userId, String buildingId,
                                            long expectedVersion, UUID idempotencyKey) {
        ConstructionBuilding building = ConstructionBuilding.byId(buildingId)
                .orElseThrow(() -> new ConstructionException(ConstructionErrorCode.OUT_OF_RANGE));
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "PUT:/islands/" + islandId + "/construction-target", idempotencyKey,
                tree(Map.of("buildingId", buildingId, "expectedVersion", expectedVersion)));
        JsonNode data = publicCommands.run(command,
                () -> userQueryService.getCallerForUpdate(userId),
                ignored -> requireReplayPermission(islandId, userId),
                () -> {
                    userQueryService.getCallerForUpdate(userId);
                    Group island = lockedAliveIsland(islandId);
                    GroupMember member = activeMember(userId, islandId);
                    requireSpendPermission(island, member);
                    requireIslandVersion(islandId, expectedVersion);
                    // 목표 대상 자체가 이미 공사 중/완공이면 고를 수 없다.
                    facilities.findByIdForUpdate(islandId, buildingId)
                            .ifPresent(f -> {
                                throw new ConstructionException(ConstructionErrorCode.STATE_CONFLICT);
                            });
                    if (facilities.existsBuildingInProgress(islandId)) {
                        throw new ConstructionException(ConstructionErrorCode.STATE_CONFLICT);
                    }
                    if (!prerequisiteCompleted(islandId, building)) {
                        throw new ConstructionException(ConstructionErrorCode.FACILITY_LOCKED);
                    }
                    states.insertIfAbsent(islandId);
                    IslandConstructionState state = states.findByIdForUpdate(islandId)
                            .orElseThrow(() -> new IllegalStateException(
                                    "섬 건설 상태를 만들 직후에 찾지 못했습니다."));
                    long islandVersion = aggregateVersion(IslandStateEvents.AGGREGATE_TYPE, islandId);
                    if (buildingId.equals(state.getTargetBuildingId())) {
                        // 같은 값 목표 PUT — 무변경 200, receipt 에 빈 events(C11).
                        return new PublicCommandResult(200,
                                tree(new ConstructionTargetView(buildingId, true, 0, islandVersion)),
                                tree(List.of()));
                    }
                    state.retarget(buildingId);
                    EventEnvelope updated = islandStateEvents.changed(
                            islandId, userId, "CONSTRUCTION_TARGET");
                    return new PublicCommandResult(200,
                            tree(new ConstructionTargetView(buildingId, true, 0, updated.version())),
                            tree(List.of(updated)));
                }).value().data();
        return decode(data, ConstructionTargetView.class);
    }

    // ---------------------------------------------------------------- POST constructions

    /**
     * 건설 시작 — 재검증한 가격으로 시설·차감·사건을 한 TX에 확정한다(LLD §4). 응답은 즉시
     * 완공이 아니라 {@code BUILDING} 이다 — 완공은 스케줄러가 {@code completesAt} 경과를 쓴다.
     *
     * <p>이미 완공·공사 중인 시설의 새 키 명령은 409 STATE_CONFLICT, 같은 키는 멱등 계층이
     * 먼저 잡아 원 성공을 재생한다(정책 C06).
     */
    @Transactional
    public ConstructionStartedView start(UUID islandId, UUID userId, String buildingId,
                                         long expectedVersion, long expectedCostPolicyVersion,
                                         UUID idempotencyKey) {
        ConstructionBuilding building = ConstructionBuilding.byId(buildingId)
                .orElseThrow(() -> new ConstructionException(ConstructionErrorCode.OUT_OF_RANGE));
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "POST:/islands/" + islandId + "/constructions", idempotencyKey,
                tree(Map.of("buildingId", buildingId, "expectedVersion", expectedVersion,
                        "expectedCostPolicyVersion", expectedCostPolicyVersion)));
        JsonNode data = publicCommands.run(command,
                () -> userQueryService.getCallerForUpdate(userId),
                ignored -> requireReplayPermission(islandId, userId),
                () -> {
                    userQueryService.getCallerForUpdate(userId);
                    Group island = lockedAliveIsland(islandId);
                    GroupMember member = activeMember(userId, islandId);
                    requireSpendPermission(island, member);
                    requireIslandVersion(islandId, expectedVersion);

                    // 정책 publication 잠금 아래 가격 동의를 비교한다 — 검증 직후 가격만
                    // 교체되는 경합을 막는다(LLD §2).
                    CostPolicyPublication current = publication.findCurrentForUpdate()
                            .orElseThrow(() -> new IllegalStateException("비용 정책 publication 이 없습니다."));
                    if (expectedCostPolicyVersion != current.getRevision()) {
                        throw new ConstructionException(ConstructionErrorCode.VERSION_CONFLICT);
                    }
                    ConstructionCostPolicy policy = policies.findById(
                                    new ConstructionCostPolicyId(current.getRevision(), buildingId))
                            .orElseThrow(() -> new IllegalStateException(
                                    "현재 비용 정책에 없는 건물입니다: " + buildingId));

                    facilities.findByIdForUpdate(islandId, buildingId)
                            .ifPresent(f -> {
                                // BUILDING·COMPLETED 모두 재건설 불가 — (섬, buildingId) 유일(C06).
                                throw new ConstructionException(ConstructionErrorCode.STATE_CONFLICT);
                            });
                    if (!prerequisiteCompleted(islandId, building)) {
                        throw new ConstructionException(ConstructionErrorCode.STATE_CONFLICT);
                    }

                    states.insertIfAbsent(islandId);
                    IslandConstructionState state = states.findByIdForUpdate(islandId)
                            .orElseThrow(() -> new IllegalStateException(
                                    "섬 건설 상태를 만들 직후에 찾지 못했습니다."));
                    requireFunded(islandId, building, policy.getCost(), state);

                    // 실제 차감 — 단일 TX 의 지갑 구간이다. 잔액 부족은 여기서 INSUFFICIENT_FUNDS.
                    int newBalance = walletService.debitForConstruction(islandId, policy.getCost(),
                            "construction:" + islandId + ":" + buildingId);

                    Instant now = clock.instant();
                    Instant completesAt = now.plusSeconds(policy.getBuildSeconds());
                    facilities.save(IslandFacility.started(islandId, buildingId, policy.getCost(),
                            current.getRevision(), userId, now, completesAt));
                    // 건설이 확정되면 걸려 있던 목표는 소비된 것이다 — 어떤 건물을 지었든
                    // 같은 TX 안에서 무조건 해제한다. 남겨 두면 이미 지은 건물을 가리키는
                    // 죽은 목표가 epoch 와 함께 다음 「각자 몫」판정을 오염시킨다.
                    state.clearTarget();

                    EventEnvelope islandUpdated = islandStateEvents.changed(
                            islandId, userId, "FACILITY_STARTED");
                    EventEnvelope walletUpdated = walletEvents.changed(
                            islandId, userId, "CONSTRUCTION_DEBIT");
                    ConstructionStartedView view = new ConstructionStartedView(
                            buildingId, STATUS_BUILDING,
                            new ConstructionStartedView.Spent(CURRENCY, policy.getCost()),
                            islandUpdated.version(), newBalance, walletUpdated.version(),
                            now, completesAt);
                    return new PublicCommandResult(200, tree(view),
                            tree(List.of(islandUpdated, walletUpdated)));
                }).value().data();
        return decode(data, ConstructionStartedView.class);
    }

    // ---------------------------------------------------------------- 판정

    /**
     * 항목별 selectable/buildable/blockedReason 평가 (LLD §2).
     * 우선순위: FORBIDDEN → FACILITY_LOCKED → IN_PROGRESS → INSUFFICIENT_FUNDS → 통과(null).
     * selectable 은 잔액을 보지 않고, buildable 은 selectable 에 건설 가능 상태·자금을 더한다.
     */
    private ConstructionOptionItem evaluate(UUID islandId, ConstructionBuilding building,
                                            ConstructionCostPolicy price, IslandFacility facility,
                                            Set<String> completed, boolean canSpend, int balance,
                                            List<UUID> memberIds, Map<UUID, Integer> contributed,
                                            String targetBuildingId) {
        if (!canSpend) {
            return item(building, price, false, false, "FORBIDDEN");
        }
        if (!prerequisiteMet(building, completed)) {
            return item(building, price, false, false, "FACILITY_LOCKED");
        }
        if (facility != null && facility.getStatus() == FacilityStatus.BUILDING) {
            return item(building, price, false, false, "IN_PROGRESS");
        }
        if (!funded(islandId, building, price.getCost(), balance, memberIds, contributed,
                targetBuildingId)) {
            return item(building, price, true, false, "INSUFFICIENT_FUNDS");
        }
        return item(building, price, true, true, null);
    }

    private static ConstructionOptionItem item(ConstructionBuilding building,
                                               ConstructionCostPolicy price, boolean selectable,
                                               boolean buildable, String blockedReason) {
        return new ConstructionOptionItem(building.id(), building.displayName(), price.getCost(),
                CURRENCY, selectable, buildable, blockedReason);
    }

    /** 선행 조건 — 선형이라 「바로 앞 건물 완공」 하나다(정책 C01). 잠금 없는 읽기용. */
    private static boolean prerequisiteMet(ConstructionBuilding building, Set<String> completed) {
        ConstructionBuilding previous = building.prerequisite();
        return previous == null || completed.contains(previous.id());
    }

    /** 선행 조건 — 잠금 아래 재검사용(TX 안). */
    private boolean prerequisiteCompleted(UUID islandId, ConstructionBuilding building) {
        ConstructionBuilding previous = building.prerequisite();
        return previous == null || facilities.existsCompleted(islandId, previous.id());
    }

    /**
     * 자금 충족 — 「섬 통장 합산」은 잔액만, 「각자 몫 n빵」은 활성 주민 <b>전원</b>이
     * 현재 목표 epoch 아래 ceil(cost/n) 을 채웠는지 본다(1829 표·P-D04). 지갑 잔액의
     * 총액 검사는 차감({@code debitForConstruction})이 같이 한다.
     */
    private boolean funded(UUID islandId, ConstructionBuilding building, int cost, int balance,
                           List<UUID> memberIds, Map<UUID, Integer> contributed,
                           String targetBuildingId) {
        if (balance < cost) {
            return false;
        }
        if (building.funding() != ConstructionBuilding.Funding.RESIDENT_SPLIT) {
            return true;
        }
        // 「각자 몫」은 그 건물을 목표로 고른 epoch 의 기여만 인정한다 — 다른 목표·무목표
        // epoch 에 모인 기여는 이 건물의 몫이 아니다(정책 P-D04).
        if (!building.id().equals(targetBuildingId)) {
            return false;
        }
        int n = memberIds.size();
        int quota = n == 0 ? cost : (cost - 1) / n + 1; // ceil(cost/n), int overflow 없는 형태
        return memberIds.stream().allMatch(id -> contributed.getOrDefault(id, 0) >= quota);
    }

    /** {@link #funded} 의 TX 안 판정 — 주민 목록·기여를 그 자리에서 다시 읽는다. */
    private void requireFunded(UUID islandId, ConstructionBuilding building, int cost,
                               IslandConstructionState state) {
        if (building.funding() == ConstructionBuilding.Funding.RESIDENT_SPLIT) {
            // 「각자 몫」은 그 건물을 목표로 고른 뒤부터만 인정한다 — 지금 목표가 이 건물이
            // 아니면 다른 목표·무목표 epoch 의 기여를 끌어다 쓰는 우회다(정책 P-D04).
            // 건설 선행 조건 불충족이라 STATE_CONFLICT 로 거절한다(LLD §3 오류표).
            if (!building.id().equals(state.getTargetBuildingId())) {
                throw new ConstructionException(ConstructionErrorCode.STATE_CONFLICT);
            }
            List<UUID> memberIds = groupMemberRepository.findActiveMemberUserIdsByGroupId(islandId);
            Map<UUID, Integer> contributed = contributedByUser(islandId, state.getTargetEpoch());
            int n = memberIds.size();
            int quota = n == 0 ? cost : (cost - 1) / n + 1;
            boolean allFunded = memberIds.stream()
                    .allMatch(id -> contributed.getOrDefault(id, 0) >= quota);
            if (!allFunded) {
                throw new ConstructionException(ConstructionErrorCode.INSUFFICIENT_FUNDS);
            }
        }
        // 잔액 총액은 debitForConstruction 이 잠긴 지갑에서 검사한다 — 여기서 읽은 잔액은
        // 잠금 전 스냅샷이라 판정 근거로 쓰지 않는다.
    }

    private Map<UUID, Integer> contributedByUser(UUID islandId, long epoch) {
        Map<UUID, Integer> byUser = new HashMap<>();
        contributions.findByIslandIdAndEpoch(islandId, epoch)
                .forEach(c -> byUser.put(c.getUserId(), c.getAmount()));
        return byUser;
    }

    // ---------------------------------------------------------------- 공통 가드

    /** 읽기 경로의 섬 조회 — 없거나 종료·삭제면 GROUP_NOT_FOUND(LLD §3 404 보존). */
    private Group aliveIsland(UUID islandId) {
        Group island = groupQueryService.findGroup(islandId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.GROUP_NOT_FOUND));
        if (!isAlive(island)) {
            throw new GroupException(GroupErrorCode.GROUP_NOT_FOUND);
        }
        return island;
    }

    /**
     * 쓰기 경로의 섬 — 그룹 행을 배타로 잠근 뒤 생존을 본다. 잠금 순서상 사용자 → receipt 뒤,
     * membership·시설·정책·지갑보다 앞이다(LLD §4).
     */
    private Group lockedAliveIsland(UUID islandId) {
        membershipLocks.lockGroup(islandId);
        Group island = groupQueryService.getGroup(islandId);
        if (!isAlive(island)) {
            throw new GroupException(GroupErrorCode.GROUP_NOT_FOUND);
        }
        return island;
    }

    private static boolean isAlive(Group island) {
        return island.getDeletedAt() == null && island.getStatus() != GroupStatus.ENDED;
    }

    /** 활성 주민 확인 — 비주민은 403 CONSTRUCTION_FORBIDDEN(LLD §3 오류표). */
    private GroupMember activeMember(UUID userId, UUID islandId) {
        return groupMemberRepository.findActiveByUserIdAndGroupIdForShare(userId, islandId)
                .orElseThrow(() -> new ConstructionException(ConstructionErrorCode.CONSTRUCTION_FORBIDDEN));
    }

    /** 지출 권한(C13·SHARED_PURCHASE) — PUT/POST 실행 권한이다. */
    private static void requireSpendPermission(Group island, GroupMember member) {
        if (!SharedPurchase.canSpend(island, member)) {
            throw new ConstructionException(ConstructionErrorCode.CONSTRUCTION_FORBIDDEN);
        }
    }

    /**
     * 멱등 재생 권한 — receipt 는 원 명령 성공 시점의 결과라, 강퇴·탈퇴·섬 종료·토글
     * OWNER_ONLY 전환 뒤 같은 key+body 재생이 그때의 권한을 되살리면 안 된다.
     * 재생 시점의 섬 생존·활성 주민·지출 권한을 실행 경로와 같은 잠금 순서로 다시 검사한다.
     */
    private void requireReplayPermission(UUID islandId, UUID userId) {
        Group island = lockedAliveIsland(islandId);
        requireSpendPermission(island, activeMember(userId, islandId));
    }

    private void requireIslandVersion(UUID islandId, long expectedVersion) {
        if (expectedVersion != aggregateVersion(IslandStateEvents.AGGREGATE_TYPE, islandId)) {
            throw new ConstructionException(ConstructionErrorCode.VERSION_CONFLICT);
        }
    }

    /** aggregate_versions 의 마지막 발급값 — 행이 없으면 0(아직 사건이 없는 축). */
    private long aggregateVersion(String type, UUID islandId) {
        return aggregateVersions.findById(new AggregateVersionId(type, islandId.toString()))
                .map(AggregateVersion::getLastVersion)
                .orElse(0L);
    }

    private int currentRevision() {
        return publication.findById(true)
                .map(CostPolicyPublication::getRevision)
                .orElseThrow(() -> new IllegalStateException("비용 정책 publication 이 없습니다."));
    }

    private Map<String, ConstructionCostPolicy> priceBook(int revision) {
        return policies.findByRevision(revision).stream()
                .collect(Collectors.toMap(ConstructionCostPolicy::getBuildingId, Function.identity()));
    }

    /** 현재 가격표에 없는 건물은 배포 구성 오류 — 계약 위반이 아니라 500 이다(P-D03). */
    private static ConstructionCostPolicy requirePrice(Map<String, ConstructionCostPolicy> priceBook,
                                                       ConstructionBuilding building) {
        ConstructionCostPolicy price = priceBook.get(building.id());
        if (price == null) {
            throw new IllegalStateException("현재 비용 정책에 없는 건물입니다: " + building.id());
        }
        return price;
    }

    // ---------------------------------------------------------------- 멱등 코덱

    private static JsonNode tree(Object value) {
        try {
            return OutboxEnvelopeCodec.fromJson(OutboxEnvelopeCodec.toJson(value), JsonNode.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("건설 명령 직렬화 실패", e);
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
