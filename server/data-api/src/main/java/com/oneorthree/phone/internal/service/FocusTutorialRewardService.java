package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.construction.service.IslandWalletEvents;
import com.oneorthree.phone.construction.service.IslandWalletService;
import com.oneorthree.phone.focus.dto.session.FocusTutorialRewardView;
import com.oneorthree.phone.focus.dto.session.TutorialExperienceRewardView;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.FocusRewardAccrualRepository;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.FocusTutorialRewardRepository;
import com.oneorthree.phone.focus.repository.domain.FocusRewardAccrual;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.repository.domain.FocusTutorialReward;
import com.oneorthree.phone.focus.support.FocusIntervalMath;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;

/** 최초 5초 집중 보상. 사용자 → 섬 → 멤버십 → 세션 → 지갑 순서로 잠근다. */
@Service
@RequiredArgsConstructor
public class FocusTutorialRewardService {
    private final UserQueryService users;
    private final FocusSessionDetailRepository details;
    private final FocusSessionIntervalRepository intervals;
    private final FocusSessionRepository sessions;
    private final GroupMembershipMutationLocks membershipLocks;
    private final GroupMemberRepository memberships;
    private final FocusTutorialRewardRepository rewards;
    private final FocusRewardAccrualRepository accruals;
    private final IslandWalletService wallet;
    private final IslandWalletEvents events;
    private final Clock clock;

    /** 5초는 앱의 체험 연출이다. 서버는 소속과 계정별 1회 지급만 검증하며 집중을 만들지 않는다. */
    @Transactional
    public TutorialExperienceRewardView claimExperience(UUID userId, UUID islandId) {
        users.getCallerForUpdate(userId);
        membershipLocks.lockGroup(islandId);
        memberships.findActiveByUserIdAndGroupIdForShare(userId, islandId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.ISLAND_MEMBERSHIP_REQUIRED));
        var claimed = rewards.findByUserId(userId);
        if (claimed.isPresent()) {
            var receipt = claimed.get();
            boolean sameExperience = receipt.getSessionId() == null && islandId.equals(receipt.getIslandId());
            return new TutorialExperienceRewardView(islandId, sameExperience ? "granted" : "unavailable");
        }
        rewards.save(FocusTutorialReward.builder().userId(userId).islandId(islandId)
                .claimedAt(clock.instant()).build());
        wallet.contribute(islandId, userId, 1, "tutorial:" + userId);
        events.changed(islandId, userId, "TUTORIAL_REWARD");
        return new TutorialExperienceRewardView(islandId, "granted");
    }

    @Transactional
    public FocusTutorialRewardView claim(UUID userId, UUID sessionId) {
        // 사용자 배타 잠금은 서로 다른 섬·세션으로 동시에 청구해도 한 번만 지급하기 위한 것이다.
        users.getCallerForUpdate(userId);
        var owner = details.findOwnershipBySessionId(sessionId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.SESSION_NOT_FOUND));
        if (!userId.equals(owner.userId())) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }
        membershipLocks.lockGroup(owner.islandId());
        var membership = memberships.findActiveByUserIdAndGroupIdForShare(userId, owner.islandId())
                .orElseThrow(() -> new FocusException(FocusErrorCode.ISLAND_MEMBERSHIP_REQUIRED));
        var detail = details.findBySessionIdForUpdate(sessionId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.SESSION_NOT_FOUND));
        if (membership.getMembershipEpoch() != detail.getMembershipEpochAtStart()) {
            throw new FocusException(FocusErrorCode.ISLAND_MEMBERSHIP_REQUIRED);
        }
        var claimed = rewards.findByUserId(userId);
        if (claimed.isPresent()) {
            return new FocusTutorialRewardView(sessionId,
                    sessionId.equals(claimed.get().getSessionId()) ? "granted" : "unavailable");
        }
        // 휴식 중(PAUSED)인 세션은 아직 정산 전이라 청구할 수 있다 — 5초 뒤 바로 쉬어도 늦게 도착한 청구를 잃지 않는다.
        boolean claimable = detail.getLifecycle() == FocusSessionLifecycle.ACTIVE
                || detail.getLifecycle() == FocusSessionLifecycle.PAUSED;
        if (!claimable || sessions.findEndedAtById(sessionId).isPresent()) {
            throw new FocusException(FocusErrorCode.SESSION_STATE_CONFLICT);
        }
        var now = clock.instant();
        if (FocusIntervalMath.activeSecondsAsOf(
                intervals.findBySessionIdOrderByOrdinalAsc(sessionId), now) < 5) {
            return new FocusTutorialRewardView(sessionId, "pending");
        }
        // 시간·분당 적립 워터마크는 바꾸지 않는다. 일반 보상과 별도인 실제 1마리다.
        rewards.save(FocusTutorialReward.builder().userId(userId).sessionId(sessionId).claimedAt(now).build());
        wallet.contribute(owner.islandId(), userId, 1, "tutorial:" + userId);
        LocalDate day = LocalDate.ofInstant(now, ZoneOffset.UTC);
        accruals.findBySessionIdAndAccruedOn(sessionId, day)
                .ifPresentOrElse(row -> row.addTutorial(), () -> accruals.save(FocusRewardAccrual.builder()
                        .sessionId(sessionId).accruedOn(day).tutorialFish(1).build()));
        events.changed(owner.islandId(), userId, "TUTORIAL_REWARD");
        return new FocusTutorialRewardView(sessionId, "granted");
    }
}
