package com.oneorthree.phone.withdrawal.service;

import com.oneorthree.phone.appearance.service.AppearanceService;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.currency.repository.UserFishWalletRepository;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.service.FocusPresenceProjection;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusStatisticsSnapshotRepository;
import com.oneorthree.phone.focus.service.SeaRemarkService;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.magazine.repository.MagazineReceiptRepository;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.quest.service.IslandQuestService;
import com.oneorthree.phone.screentime.repository.ScreenTimeObservationRepository;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.dto.DeviceTokenDeletionRequest;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.service.UserSatelliteCommandService;
import com.oneorthree.phone.user.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/**
 * 계정 탈퇴를 한 트랜잭션으로 처리한다.
 * 섬 잠금·세션 폐기·위성 명령 기록 후 개인 기록을 정리하고, 개인정보와 소셜 연동은 마지막에 파기한다.
 */
@Service
@RequiredArgsConstructor
public class AccountWithdrawalService {

    private final UserFishWalletRepository fishWallets;
    private final FocusSessionRepository focusSessions;
    private final DailyFocusStatRepository dailyFocusStats;
    private final FocusPresenceProjection focusPresence;

    private final UserQueryService userQueryService;
    private final GroupMemberService groupMemberService;
    private final FocusSessionDetailRepository focusSessionDetailRepository;
    private final FocusSessionIntervalRepository focusSessionIntervalRepository;
    private final FocusStatisticsSnapshotRepository focusStatisticsSnapshotRepository;
    private final ScreenTimeObservationRepository screenTimeObservationRepository;
    private final MagazineReceiptRepository magazineReceiptRepository;
    private final UserService userService;
    private final FriendService friendService;
    private final AuthSessionService authSessionService;
    private final UserSatelliteCommandService userSatelliteCommandService;
    private final WithdrawalSatelliteCommandService withdrawalSatelliteCommandService;
    private final GroupInviteLinkRepository groupInviteLinks;
    private final PublicCommandService publicCommandService;
    private final AppearanceService appearanceService;
    private final SeaRemarkService seaRemarkService;
    private final IslandQuestService islandQuestService;

    /**
     * 회원 탈퇴 — 행을 지우지 않고 PII 를 파기한 뒤 비활성 표시를 한다.
     *
     * <p>혼자 있는 소유 그룹은 자동 종료되지만, 다른 멤버가 남은 그룹의 방장이면 위임 전까지
     * 탈퇴할 수 없다.
     *
     * @param userId 탈퇴할 본인. 이미 탈퇴했거나 없으면 404
     * @throws UserException  대상이 없거나 이미 탈퇴한 경우 {@code NOT_FOUND}
     * @throws GroupException 위임하지 않은 방장 그룹이 남아 있을 때 {@code HOST_WITHDRAW}
     */
    @Transactional
    public void withdraw(UUID userId) {
        User user = userQueryService.getCallerForUpdate(userId);
        groupMemberService.lockGroupsForAccountWithdrawal(user);

        long authGeneration = user.bumpAuthGeneration();
        authSessionService.revokeAll(userId, "WITHDRAW");
        authSessionService.publishGenerationBumped(userId, authGeneration, "WITHDRAW");
        userSatelliteCommandService.recordDeviceTokenDeletion(
                userId,
                new DeviceTokenDeletionRequest(null, null, authGeneration),
                "withdraw:" + userId);
        authSessionService.eraseWithdrawnCredentials(userId);
        groupInviteLinks.detachInviter(userId);
        withdrawalSatelliteCommandService.recordWithdrawn(userId, authGeneration);

        groupMemberService.detachWithdrawnUser(user);
        groupMemberService.eraseWithdrawnUserRecords(user);

        focusSessions.nullifyUser(userId);
        dailyFocusStats.nullifyUser(userId);
        focusPresence.userWithdrawn(userId);
        Instant anonymizedAt = Instant.now();
        focusSessionIntervalRepository.closeOpenIntervalsOfUser(userId, anonymizedAt);
        focusSessionDetailRepository.abandonProgressingOfUser(userId, anonymizedAt);
        focusSessionDetailRepository.anonymizeWithdrawnUser(userId);
        screenTimeObservationRepository.deleteAllOfUser(userId);
        focusStatisticsSnapshotRepository.deleteAllOfUser(userId);

        // 개인 외양·보유품·잡지 열람 상태·바다 한마디를 파기한다.
        appearanceService.eraseWithdrawnUser(userId);
        magazineReceiptRepository.deleteAllOfUser(userId);
        seaRemarkService.eraseWithdrawnUser(userId);
        islandQuestService.eraseWithdrawnUser(userId);

        fishWallets.deleteById(userId);
        userService.deleteSettings(userId);

        friendService.detachWithdrawnUser(userId);
        publicCommandService.forgetReceiptsOf(userId);

        userService.erasePersonalData(user);
    }
}
