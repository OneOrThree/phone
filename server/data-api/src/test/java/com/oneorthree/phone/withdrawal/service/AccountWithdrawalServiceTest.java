package com.oneorthree.phone.withdrawal.service;

import com.oneorthree.phone.appearance.service.AppearanceService;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.currency.repository.UserFishWalletRepository;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.FocusStatisticsSnapshotRepository;
import com.oneorthree.phone.focus.service.FocusPresenceProjection;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.quest.service.IslandQuestService;
import com.oneorthree.phone.screentime.repository.ScreenTimeObservationRepository;
import com.oneorthree.phone.user.service.UserSatelliteCommandService;

import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.service.UserService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/** 탈퇴 잠금·관계 정리·개인정보 파기의 순서를 검증한다. */
@ExtendWith(MockitoExtension.class)
class AccountWithdrawalServiceTest {

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");



    @Mock
    private UserQueryService userQueryService;
    @Mock
    private GroupMemberService groupMemberService;
    /** v0.3 집중 세션(GROMO-1764) 상세·구간 — 레거시와 달리 자유 입력 subject 까지 남는다. */
    @Mock
    private com.oneorthree.phone.focus.repository.FocusSessionDetailRepository focusSessionDetailRepository;
    @Mock
    private com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository focusSessionIntervalRepository;
    @Mock
    private com.oneorthree.phone.focus.repository.FocusStatisticsSnapshotRepository focusStatisticsSnapshotRepository;
    @Mock
    private com.oneorthree.phone.screentime.repository.ScreenTimeObservationRepository screenTimeObservationRepository;
    @Mock
    private UserService userService;
    @Mock
    private FriendService friendService;

    /** 세션 축 폐기 (A22 ㋞·㊹) — 탈퇴는 전 세션이 끝나는 사건이다. */
    @Mock
    private com.oneorthree.phone.auth.service.AuthSessionService authSessionService;
    /** 기기 토큰 삭제 명령 (A22 ㊲·㊨) — 토큰을 지우기 «전에» 적어야 한다. */
    @Mock
    private com.oneorthree.phone.user.service.UserSatelliteCommandService userSatelliteCommandService;
    /** 탈퇴 사건을 알림 위성에 전달한다. */
    @Mock
    private WithdrawalSatelliteCommandService withdrawalSatelliteCommandService;
    /** 이미 박힌 초대 귀속 익명화 (A22 ⓐ) + 발급자 연결 파기 (GROMO-1801). */
    @Mock
    private com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository groupInviteLinks;
    /** 계정 LLD §4 파생 개인 이력 파기 (GROMO-1801). */
    @Mock
    private com.oneorthree.phone.outbox.service.PublicCommandService publicCommandService;
    /** 섬 개인 외양·보유품과 퀘스트 cohort·정산 수령자 파기 (GROMO-1950). */
    @Mock
    private com.oneorthree.phone.appearance.service.AppearanceService appearanceService;
    /** 고양이 잡지 받음 상태 파기 (GROMO-2289) — 개인 열람 기록이라 지운다. */
    @Mock
    private com.oneorthree.phone.magazine.repository.MagazineReceiptRepository magazineReceiptRepository;
    /** 바다 한마디 파기 (GROMO-2299). */
    @Mock
    private com.oneorthree.phone.focus.service.SeaRemarkService seaRemarkService;
    @Mock
    private com.oneorthree.phone.quest.service.IslandQuestService islandQuestService;

    @Mock
    private com.oneorthree.phone.focus.repository.FocusSessionRepository focusSessions;
    @Mock
    private com.oneorthree.phone.focus.repository.DailyFocusStatRepository dailyFocusStats;
    @Mock
    private com.oneorthree.phone.focus.service.FocusPresenceProjection focusPresence;

    @Mock
    private com.oneorthree.phone.currency.repository.UserFishWalletRepository fishWallets;

    @InjectMocks
    private AccountWithdrawalService accountWithdrawalService;

    private User givenLoadedForUpdate() {
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);
        return user;
    }

    @Test
    void closesMembershipAndSessionBeforeErasingPersonalData() {
        User user = givenLoadedForUpdate();
        accountWithdrawalService.withdraw(USER_ID);
        InOrder order = inOrder(userQueryService, groupMemberService, authSessionService,
                focusSessions, dailyFocusStats, focusSessionIntervalRepository, focusSessionDetailRepository,
                appearanceService, magazineReceiptRepository, seaRemarkService, islandQuestService,
                userService, friendService, publicCommandService);
        order.verify(userQueryService).getCallerForUpdate(USER_ID);
        order.verify(groupMemberService).lockGroupsForAccountWithdrawal(user);
        order.verify(authSessionService).revokeAll(USER_ID, "WITHDRAW");
        order.verify(groupMemberService).detachWithdrawnUser(user);
        order.verify(groupMemberService).eraseWithdrawnUserRecords(user);
        order.verify(focusSessions).nullifyUser(USER_ID);
        order.verify(dailyFocusStats).nullifyUser(USER_ID);
        order.verify(focusSessionIntervalRepository).closeOpenIntervalsOfUser(eq(USER_ID), any(Instant.class));
        order.verify(focusSessionDetailRepository).abandonProgressingOfUser(eq(USER_ID), any(Instant.class));
        order.verify(focusSessionDetailRepository).anonymizeWithdrawnUser(USER_ID);
        order.verify(appearanceService).eraseWithdrawnUser(USER_ID);
        order.verify(magazineReceiptRepository).deleteAllOfUser(USER_ID);
        order.verify(seaRemarkService).eraseWithdrawnUser(USER_ID);
        order.verify(islandQuestService).eraseWithdrawnUser(USER_ID);
        order.verify(userService).deleteSettings(USER_ID);
        order.verify(friendService).detachWithdrawnUser(USER_ID);
        order.verify(publicCommandService).forgetReceiptsOf(USER_ID);
        order.verify(userService).erasePersonalData(user);
    }

    @Test
    @DisplayName("배타 락으로 로드한다 — 무락으로 읽으면 정리 스캔 이후 낀 친구요청·핀이 유령으로 남는다")
    void loadsUserWithExclusiveLock() {
        givenLoadedForUpdate();

        accountWithdrawalService.withdraw(USER_ID);

        verify(userQueryService).getCallerForUpdate(USER_ID);
        verify(userQueryService, never()).getTarget(any());
        verify(userQueryService, never()).getTargetForShare(any());
    }

    @Test
    @DisplayName("방장 그룹이 남으면 HOST_WITHDRAW — 뒤의 어떤 정리도 시작되지 않는다")
    void hostWithdrawStopsEverythingAfterIt() {
        User user = givenLoadedForUpdate();
        willThrow(new GroupException(GroupErrorCode.HOST_WITHDRAW))
                .given(groupMemberService).detachWithdrawnUser(user);

        assertThatThrownBy(() -> accountWithdrawalService.withdraw(USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.HOST_WITHDRAW);

        verify(focusSessionDetailRepository, never()).anonymizeWithdrawnUser(any());
        verify(userService, never()).deleteSettings(any());
        verify(friendService, never()).detachWithdrawnUser(any());
        verify(groupMemberService, never()).eraseWithdrawnUserRecords(any());
        verify(userService, never()).erasePersonalData(any());
        assertThat(user.isDeleted()).isFalse();
    }

    @Test
    @DisplayName("없거나 이미 탈퇴한 유저면 NOT_FOUND — 아무 도메인도 건드리지 않는다")
    void missingUserTouchesNothing() {
        given(userQueryService.getCallerForUpdate(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> accountWithdrawalService.withdraw(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);

        verify(groupMemberService, never()).detachWithdrawnUser(any());
        verify(userService, never()).erasePersonalData(any());
    }
}
