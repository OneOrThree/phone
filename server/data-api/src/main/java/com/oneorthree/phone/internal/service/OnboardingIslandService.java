package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.construction.repository.IslandConstructionStateRepository;
import com.oneorthree.phone.construction.repository.IslandWalletRepository;
import com.oneorthree.phone.construction.repository.domain.IslandConstructionState;
import com.oneorthree.phone.construction.repository.domain.IslandWallet;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.OnboardingIslandRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.OnboardingIsland;
import com.oneorthree.phone.group.repository.domain.UserIslandContext;
import com.oneorthree.phone.internal.dto.TelescopeItemView;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 망원경에 정착할 섬이 없을 때의 개인 무인도. users 배타 잠금은 호출자가 먼저 잡는다.
 * 실제 SEA 완료 기록이 있어야 도착 명령이 방장 소속을 만든다. 목록 조회·출항·중도 종료는 소속을 만들지 않는다.
 */
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class OnboardingIslandService {
    private final OnboardingIslandRepository reservations;
    private final GroupRepository groups;
    private final GroupQueryService groupQueries;
    private final GroupMemberRepository members;
    private final IslandWalletRepository wallets;
    private final IslandConstructionStateRepository construction;
    private final FocusSessionDetailRepository sessions;
    private final IslandMovementGuards guards;

    /** 기존 예약은 시간대가 바뀌어도 보존한다. 이미 소속이 있으면 온보딩 목적지를 추가하지 않는다. */
    public Optional<TelescopeItemView> destination(UUID userId, List<UUID> joined,
                                                   List<TelescopeItemView> items) {
        if (!joined.isEmpty()) {
            return Optional.empty();
        }
        Optional<OnboardingIsland> prior = reservations.findPendingForUser(userId);
        if (prior.isEmpty() && items.stream().anyMatch(item -> !item.full())) {
            return Optional.empty();
        }
        Group island = prior.flatMap(reservation -> groupQueries.findGroup(reservation.getIslandId()))
                .filter(IslandMovementGuards::isAlive).orElse(null);
        if (island == null) {
            // 죽은 예약이 있다면 먼저 지워 사용자 PK를 비운다.
            if (prior.isPresent()) {
                reservations.delete(prior.get());
                reservations.flush();
            }
            island = groups.save(Group.builder().name("무인도").description("")
                    .maxMembers(Group.DEFAULT_MAX_MEMBERS).isPrivate(true).approvalRequired(false).build());
            wallets.save(IslandWallet.empty(island.getId()));
            construction.save(IslandConstructionState.empty(island.getId()));
            reservations.save(new OnboardingIsland(userId, island.getId()));
        }
        return Optional.of(new TelescopeItemView(island.getId(), island.getName(), "", 0,
                island.getMaxMembers(), false, IslandSummaries.STATUS_NONE, TelescopeService.SLOT_NEARBY,
                TelescopeService.NEARBY_SAILING_MINUTES, null, false, false, null, null, null, 0));
    }

    /** 사용자 → context → 목적지 잠금 뒤 호출한다. 생성 사건은 호출자가 나머지 도착 쓰기 뒤에 발행한다. */
    public boolean settleAtArrival(User user, Group island, UserIslandContext context) {
        Optional<OnboardingIsland> pending = reservations.findByIslandId(island.getId());
        if (pending.isEmpty()) {
            return false;
        }
        if (!pending.get().getUserId().equals(user.getId())) {
            throw new GroupException(GroupErrorCode.GROUP_NOT_FOUND);
        }
        if (!sessions.hasCompletedSeaArrival(user.getId(), island.getId())) {
            throw new GroupException(GroupErrorCode.ISLAND_NOT_ARRIVED);
        }
        // 앱의 항해 화면에는 가입 동작이 없다. 별도 API 요청으로 소속이 생겼다면 첫 정착 조건도 다시 확인한다.
        if (!members.findActiveGroupIdsByUserId(user.getId()).isEmpty()) {
            throw new GroupException(GroupErrorCode.ISLAND_JOIN_UNAVAILABLE);
        }
        guards.requireNoLiveFocusSession(user);
        guards.requireDepartureUnlocked(context);
        guards.requireJoinedIslandLimit(user);
        members.save(GroupMember.builder().user(user).group(island).role(GroupMemberRole.OWNER).build());
        island.updateIsPrivate(false);
        island.updateName("새로운 섬");
        context.moveTo(island.getId());
        reservations.delete(pending.get());
        return true;
    }
}
