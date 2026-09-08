package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * User 조회 계층 (GROMO-1655) — 종전엔 19개 service 에 흩어져 있던 "활성 유저 한 명" 판정이
 * 여기 한 곳으로 접혔다. 이 테스트가 그 판정의 정본이다.
 */
@ExtendWith(MockitoExtension.class)
class UserQueryServiceTest {

    @Mock
    private UserRepository userRepository;
    @Mock
    private UserWalletRepository userWalletRepository;
    @Mock
    private UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    @Mock
    private UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;

    @InjectMocks
    private UserQueryService userQueryService;

    private static final UUID ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    private User active() {
        return User.builder().id(ID).nickname("활성").build();
    }

    // ── 탈퇴 필터 — 계층이 존재하는 이유 ──────────────────────────────

    @Test
    @DisplayName("탈퇴 유저는 쿼리 단계에서 걸러져 빈 값이 된다 — 호출측이 isDeleted 를 다시 볼 일이 없다")
    void findActive_filtersDeletedAtQueryLevel() {
        given(userRepository.findByIdAndIsDeletedFalse(ID)).willReturn(Optional.empty());

        assertThat(userQueryService.findActive(ID)).isEmpty();
    }

    @Test
    @DisplayName("지목된 유저가 없거나 탈퇴했으면 NOT_FOUND")
    void getTarget_throwsNotFound() {
        given(userRepository.findByIdAndIsDeletedFalse(ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userQueryService.getTarget(ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── 예외가 두 갈래인 이유 (GROMO-1247) ────────────────────────────

    @Test
    @DisplayName("요청자 본인 부재는 USER_NOT_FOUND — 앱이 재로그인으로 분기하는 코드라 NOT_FOUND 와 합치면 안 된다")
    void getCaller_throwsUserNotFound() {
        given(userRepository.findByIdAndIsDeletedFalse(ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userQueryService.getCaller(ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    @Test
    @DisplayName("같은 부재라도 지목 대상과 요청자 본인의 에러코드가 다르다")
    void targetAndCaller_useDifferentErrorCodes() {
        given(userRepository.findByIdAndIsDeletedFalse(ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userQueryService.getTarget(ID))
                .extracting("errorCode").isEqualTo(UserErrorCode.NOT_FOUND);
        assertThatThrownBy(() -> userQueryService.getCaller(ID))
                .extracting("errorCode").isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    // ── 락 종류별로 다른 쿼리를 탄다 ──────────────────────────────────

    @Test
    @DisplayName("공유 락 조회는 ForShare 쿼리를 탄다 — 락 없는 조회로 대체되면 '빈 결과 = 탈퇴 확정' 전제가 깨진다")
    void forShare_usesShareLockQuery() {
        given(userRepository.findActiveByIdForShare(ID)).willReturn(Optional.of(active()));

        assertThat(userQueryService.getTargetForShare(ID).getId()).isEqualTo(ID);
        assertThat(userQueryService.getCallerForShare(ID).getId()).isEqualTo(ID);
    }

    @Test
    @DisplayName("배타 락 조회는 ForUpdate 쿼리를 탄다 — users 를 변경하는 트랜잭션이 쓴다")
    void forUpdate_usesExclusiveLockQuery() {
        given(userRepository.findActiveByIdForUpdate(ID)).willReturn(Optional.of(active()));

        assertThat(userQueryService.getTargetForUpdate(ID).getId()).isEqualTo(ID);
    }

    @Test
    @DisplayName("락 조회도 부재면 각자의 에러코드로 던진다")
    void lockedLookups_throwOwnErrorCodes() {
        given(userRepository.findActiveByIdForShare(ID)).willReturn(Optional.empty());
        given(userRepository.findActiveByIdForUpdate(ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userQueryService.getTargetForShare(ID))
                .extracting("errorCode").isEqualTo(UserErrorCode.NOT_FOUND);
        assertThatThrownBy(() -> userQueryService.getCallerForShare(ID))
                .extracting("errorCode").isEqualTo(UserErrorCode.USER_NOT_FOUND);
        assertThatThrownBy(() -> userQueryService.getTargetForUpdate(ID))
                .extracting("errorCode").isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── 탈퇴 포함 조회 (GROMO-801) ────────────────────────────────────

    @Test
    @DisplayName("getAny 는 탈퇴자도 그대로 돌려준다 — 관계 해제가 탈퇴 순간 막히면 안 된다")
    void getAny_returnsWithdrawnUser() {
        User withdrawn = User.builder().id(ID).nickname("탈퇴").isDeleted(true).build();
        given(userRepository.findById(ID)).willReturn(Optional.of(withdrawn));

        User found = userQueryService.getAny(ID);

        assertThat(found.isDeleted()).isTrue();
    }

    @Test
    @DisplayName("getAny 도 행 자체가 없으면 NOT_FOUND — '탈퇴 허용'이 '부재 허용'은 아니다")
    void getAny_stillThrowsWhenRowAbsent() {
        given(userRepository.findById(ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userQueryService.getAny(ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── 부재가 정상 흐름인 락 조회 ────────────────────────────────────

    @Test
    @DisplayName("findActiveForUpdate 는 배타 락 쿼리를 타고 부재를 빈 값으로 돌려준다 — 던지면 정산 배치가 죽는다")
    void findActiveForUpdate_returnsEmptyInsteadOfThrowing() {
        given(userRepository.findActiveByIdForUpdate(ID)).willReturn(Optional.empty());

        assertThat(userQueryService.findActiveForUpdate(ID)).isEmpty();
    }

    @Test
    @DisplayName("findActiveForUpdate 는 활성 유저를 배타 락으로 가져온다")
    void findActiveForUpdate_returnsActiveUser() {
        given(userRepository.findActiveByIdForUpdate(ID)).willReturn(Optional.of(active()));

        assertThat(userQueryService.findActiveForUpdate(ID)).get()
                .extracting("id").isEqualTo(ID);
    }

    // ── 배치 ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("배치 조회는 탈퇴·부재분을 빼고 돌려준다 — 요청 수와 결과 수가 다를 수 있다")
    void findAllActive_dropsMissingAndDeleted() {
        UUID other = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(userRepository.findAllByIdInAndIsDeletedFalse(List.of(ID, other)))
                .willReturn(List.of(active()));

        assertThat(userQueryService.findAllActive(List.of(ID, other))).hasSize(1);
    }
    // ── 지갑·설정 — 같은 부재를 두 가지 뜻으로 쓰던 갈래 ────────────────

    @Test
    @DisplayName("지갑 부재는 NOT_FOUND — 가입 시 함께 만들어지므로 사실상 데이터 손상이다")
    void getWallet_throwsNotFound() {
        given(userWalletRepository.findById(ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userQueryService.getWallet(ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("지갑 변경 경로는 배타 락 쿼리를 탄다 — 락 없는 조회로 내려가면 잔액 경합이 열린다")
    void getWalletForUpdate_usesExclusiveLock() {
        UserWallet wallet = UserWallet.builder().userId(ID).build();
        given(userWalletRepository.findByIdForUpdate(ID)).willReturn(Optional.of(wallet));

        assertThat(userQueryService.getWalletForUpdate(ID)).isSameAs(wallet);
        verify(userWalletRepository).findByIdForUpdate(ID);
        verify(userWalletRepository, never()).findById(ID);
    }

    @Test
    @DisplayName("스크린타임 설정 — get 은 부재에 던지고 find 는 빈 값을 준다(호출부가 기본값을 정한다)")
    void screenTimeSettings_getThrowsButFindDoesNot() {
        given(userScreenTimeSettingsRepository.findById(ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userQueryService.getScreenTimeSettings(ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
        assertThat(userQueryService.findScreenTimeSettings(ID)).isEmpty();

        // 무락 두 메서드가 정말 무락 쿼리를 타는지 못박는다. 이게 없으면 어느 한쪽이 락 판으로
        // 갈아타도 테스트가 초록이다 — 스텁 안 된 락 메서드가 Mockito 기본값 Optional.empty() 를
        // 돌려주고, 그게 위 두 단언을 그대로 통과시킨다.
        verify(userScreenTimeSettingsRepository, times(2)).findById(ID);
        verify(userScreenTimeSettingsRepository, never()).findByIdForShare(ID);
        verify(userScreenTimeSettingsRepository, never()).findByIdForUpdate(ID);
    }

    @Test
    @DisplayName("스크린타임 공유 락은 ForShare 쿼리를 탄다 — 권한 회수와의 직렬화가 여기 걸려 있다")
    void findScreenTimeSettingsForShare_usesSharedLock() {
        UserScreenTimeSettings settings = UserScreenTimeSettings.builder().userId(ID).build();
        given(userScreenTimeSettingsRepository.findByIdForShare(ID)).willReturn(Optional.of(settings));

        assertThat(userQueryService.findScreenTimeSettingsForShare(ID)).contains(settings);
        verify(userScreenTimeSettingsRepository).findByIdForShare(ID);
        verify(userScreenTimeSettingsRepository, never()).findById(ID);
        verify(userScreenTimeSettingsRepository, never()).findByIdForUpdate(ID);
    }

    @Test
    @DisplayName("스크린타임 배타 락은 ForUpdate 쿼리를 타고 부재에 던진다")
    void getScreenTimeSettingsForUpdate_usesExclusiveLockAndThrows() {
        given(userScreenTimeSettingsRepository.findByIdForUpdate(ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userQueryService.getScreenTimeSettingsForUpdate(ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
        verify(userScreenTimeSettingsRepository).findByIdForUpdate(ID);
        verify(userScreenTimeSettingsRepository, never()).findByIdForShare(ID);
        verify(userScreenTimeSettingsRepository, never()).findById(ID);
    }

    @Test
    @DisplayName("집중 시간 설정 — get 은 던지고 find 는 빈 값을 준다")
    void focusTimeSettings_getThrowsButFindDoesNot() {
        given(userFocusTimeSettingsRepository.findById(ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userQueryService.getFocusTimeSettings(ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
        assertThat(userQueryService.findFocusTimeSettings(ID)).isEmpty();
    }

    @Test
    @DisplayName("알림 설정 — get 은 던지고 find 는 빈 값을 준다(발송 경로는 소리 켬으로 본다)")
    void notificationSettings_getThrowsButFindDoesNot() {
        given(userNotificationSettingsRepository.findById(ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userQueryService.getNotificationSettings(ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
        assertThat(userQueryService.findNotificationSettings(ID)).isEmpty();
    }

    @Test
    @DisplayName("설정 배치 조회는 부재분을 빼고 돌려준다 — 요청 수와 결과 수가 다를 수 있다")
    void findAllSettings_dropsMissingRows() {
        UserScreenTimeSettings screen = UserScreenTimeSettings.builder().userId(ID).build();
        UserNotificationSettings notify = UserNotificationSettings.builder().userId(ID).build();
        List<UUID> ids = List.of(ID, UUID.randomUUID());
        given(userScreenTimeSettingsRepository.findAllById(ids)).willReturn(List.of(screen));
        given(userNotificationSettingsRepository.findAllById(ids)).willReturn(List.of(notify));

        assertThat(userQueryService.findAllScreenTimeSettings(ids)).containsExactly(screen);
        assertThat(userQueryService.findAllNotificationSettings(ids)).containsExactly(notify);
    }
}
