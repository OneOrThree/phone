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
import com.oneorthree.phone.group.support.IslandInputPolicy;
import com.oneorthree.phone.internal.dto.TelescopeItemView;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.time.Instant;
import java.nio.charset.StandardCharsets;

/**
 * 무인도 후보는 시간 버킷별 독립 추첨 결과일 뿐 DB 행이 아니다. 성공한 항해 완료 때만 실제 섬을 만든다.
 * 기존 예약으로 출항한 세션의 도착 처리는 롤링 배포 호환을 위해 유지한다.
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

    /** 망원경 일반 목록과 무관한 20% 추첨. 첫 정착에 갈 수 있는 섬이 없으면 반드시 보여 준다. */
    public Optional<TelescopeItemView> destination(UUID userId, List<UUID> joined,
                                                   List<TelescopeItemView> items, Instant bucketStart) {
        if (joined.size() >= IslandInputPolicy.MAX_JOINED_ISLANDS) {
            return Optional.empty();
        }
        boolean firstSettlementNeeded = joined.isEmpty() && items.stream()
                .noneMatch(item -> !item.full() && !TelescopeService.SLOT_JOINED.equals(item.slot()));
        UUID candidate = UUID.nameUUIDFromBytes(("uninhabited:" + userId + ":" + bucketStart.getEpochSecond())
                .getBytes(StandardCharsets.UTF_8));
        if (!firstSettlementNeeded && Math.floorMod(candidate.getLeastSignificantBits(), 100) >= 20) {
            return Optional.empty();
        }
        return Optional.of(new TelescopeItemView(candidate, "무인도", "", 0,
                Group.DEFAULT_MAX_MEMBERS, false, IslandSummaries.STATUS_NONE, TelescopeService.SLOT_UNINHABITED,
                TelescopeService.NEARBY_SAILING_MINUTES, null, false, false, null, null, null, 0));
    }

    /** 종료 마커가 닫힌 뒤 같은 트랜잭션에서 호출한다. 실패·재시도는 전부 롤백 또는 완료 세션 재생으로 처리된다. */
    public Group materializeAtFinish(User user, UserIslandContext context) {
        guards.requireJoinedIslandLimit(user);
        Group island = groups.save(Group.builder().name("새로운 섬").description("")
                .maxMembers(Group.DEFAULT_MAX_MEMBERS).isPrivate(false).approvalRequired(false).build());
        wallets.save(IslandWallet.empty(island.getId()));
        construction.save(IslandConstructionState.empty(island.getId()));
        members.save(GroupMember.builder().user(user).group(island).role(GroupMemberRole.OWNER).build());
        // 이미 완료한 15분 항해가 이동 경로다. 일반 즉시 전환의 출발 섬 전망대 조건은 적용하지 않는다.
        context.moveTo(island.getId());
        return island;
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
