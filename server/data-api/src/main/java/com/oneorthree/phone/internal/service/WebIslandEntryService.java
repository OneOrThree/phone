package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.port.IslandAppearancePort;
import com.oneorthree.phone.construction.repository.IslandConstructionStateRepository;
import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.IslandWalletRepository;
import com.oneorthree.phone.construction.repository.domain.IslandConstructionState;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.construction.repository.domain.IslandWallet;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.IslandArrivalRepository;
import com.oneorthree.phone.group.repository.WebIslandPoolRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.UserIslandContext;
import com.oneorthree.phone.group.repository.domain.WebIslandPool;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.group.service.IslandMembershipEvents;
import com.oneorthree.phone.group.service.IslandStateEvents;
import com.oneorthree.phone.group.service.UserIslandContextLockService;
import com.oneorthree.phone.internal.dto.IslandCreatedView;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 웹 방문자는 같은 운영 섬의 주민이 된다. 일반 섬의 정원·가입 정책은 바꾸지 않는다. */
@Service
@RequiredArgsConstructor
public class WebIslandEntryService {
    private final UserQueryService users;
    private final UserRepository userRepository;
    private final UserIslandContextLockService contexts;
    private final WebIslandPoolRepository pools;
    private final GroupRepository groups;
    private final GroupQueryService groupQueries;
    private final GroupMemberRepository members;
    private final GroupMembershipMutationLocks locks;
    private final IslandWalletRepository wallets;
    private final IslandConstructionStateRepository construction;
    private final IslandFacilityRepository facilities;
    private final IslandAppearancePort appearance;
    private final IslandArrivalRepository arrivals;
    private final IslandMembershipEvents membershipEvents;
    private final IslandStateEvents islandEvents;
    private final IslandMovementGuards guards;
    private final PublicCommandService commands;
    private final Clock clock;

    /** 사용자 → context → pool → island → membership 순서. 같은 키의 재시도는 기존 영수증을 재생한다. */
    @Transactional
    public IslandCreatedView enter(UUID userId, UUID key) {
        var command = new PublicCommandRequest(userId, "POST:/me/web-island:" + userId,
                key, InternalJson.tree(Map.of()));
        var result = commands.run(command, () -> users.getCallerForUpdate(userId),
                receipt -> authorizeReplay(userId, InternalJson.decode(receipt.data(), IslandCreatedView.class).id()),
                () -> {
                    User user = users.getCallerForUpdate(userId);
                    if (user.getNickname() == null || user.getCatColor() == null) {
                        throw new GroupException(GroupErrorCode.ONBOARDING_REQUIRED);
                    }
                    UserIslandContext context = contexts.lock(user);
                    WebIslandPool pool = pools.lockMain();
                    if (pool == null) {
                        throw new IllegalStateException("웹 섬 배정 테이블이 준비되지 않았습니다.");
                    }
                    List<EventEnvelope> events = new ArrayList<>();
                    if (pool.getIslandId() != null) {
                        locks.lockGroup(pool.getIslandId());
                    }
                    Group island = pool.getIslandId() == null ? provision(pool, events)
                            : groupQueries.getGroup(pool.getIslandId());
                    IslandMovementGuards.requireAlive(island);
                    if (!island.isWebLobby()) {
                        throw new IllegalStateException("웹 배정 대상이 웹 전용 섬이 아닙니다.");
                    }
                    var prior = members.findAnyByUserAndGroup(user, island);
                    // 강퇴자를 자동 재가입시키지 않는다. 앱의 다른 섬 소속도 제거하지 않는다.
                    if (prior.map(GroupMember::isKicked).orElse(false)) {
                        throw new GroupException(GroupErrorCode.KICKED_CANNOT_REJOIN);
                    }
                    if (!island.getId().equals(context.getCurrentIslandId())) {
                        guards.requireNoLiveFocusSession(user);
                    }
                    if (prior.isEmpty() || prior.get().isLeft()) {
                        GroupMember member = prior.orElseGet(() -> GroupMember.builder()
                                .user(user).group(island).role(GroupMemberRole.MEMBER).build());
                        if (prior.isPresent()) {
                            member.rejoin(clock.instant());
                        }
                        members.save(member);
                        events.add(membershipEvents.changed(island.getId(), userId, "MEMBER_ADDED", userId));
                    }
                    context.moveTo(island.getId());
                    arrivals.recordArrival(userId, island.getId(), clock.instant(), true);
                    return new PublicCommandResult(200, InternalJson.tree(new IslandCreatedView(
                            island.getId(), "active", "member", island.getId())), InternalJson.tree(events));
                });
        return InternalJson.decode(result.value().data(), IslandCreatedView.class);
    }

    private void authorizeReplay(UUID userId, UUID islandId) {
        User user = users.getCallerForUpdate(userId);
        contexts.lock(user);
        locks.lockGroup(islandId);
        Group island = groupQueries.getGroup(islandId);
        IslandMovementGuards.requireAlive(island);
        var member = members.findAnyByUserAndGroup(user, island);
        if (member.isEmpty() || member.get().isLeft() || member.get().isKicked()) {
            throw new GroupException(GroupErrorCode.MEMBER_ONLY);
        }
    }

    /** 첫 입장 한 번만 생성한다. 운영용 섬장은 인증 세션·소셜 자격이 없고 방문자에게 넘기지 않는다. */
    private Group provision(WebIslandPool pool, List<EventEnvelope> events) {
        User host = userRepository.save(User.builder().isGuest(false).catColor("cream")
                .nickname("웹섬" + UUID.randomUUID().toString().substring(0, 7)).build());
        Group island = groups.save(Group.builder().name("함께 집중할고양")
                .description("웹에서 만난 고양이들이 함께 집중하는 섬이에요.")
                .greeting("함께 집중할고양에 온 걸 환영해요!")
                .maxMembers(Group.DEFAULT_MAX_MEMBERS).webLobby(true)
                .isPrivate(true).approvalRequired(false).build());
        members.save(GroupMember.builder().user(host).group(island).role(GroupMemberRole.OWNER).build());
        wallets.save(IslandWallet.empty(island.getId()));
        construction.save(IslandConstructionState.empty(island.getId()));
        for (String building : List.of("hall", "board", "gram", "library", "mail", "tower", "shop")) {
            facilities.save(IslandFacility.completedSeed(island.getId(), building, clock.instant()));
            appearance.buildingCompleted(island.getId(), building, host.getId());
        }
        pool.assign(island.getId());
        events.add(islandEvents.created(island.getId(), host.getId()));
        return island;
    }
}
