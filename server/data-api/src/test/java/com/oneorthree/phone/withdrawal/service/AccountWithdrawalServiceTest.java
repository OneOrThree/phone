package com.oneorthree.phone.withdrawal.service;

import com.oneorthree.phone.focus.service.FocusService;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.screentime.service.ScreenTimeService;
import com.oneorthree.phone.stats.service.StatsService;
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

/**
 * 탈퇴 절차의 <b>순서</b>를 못박는다 (GROMO-1656).
 *
 * <p><b>왜 순서만 보는가.</b> 각 단계가 무엇을 하는지는 그 도메인의 테스트가 지킨다
 * ({@code GroupMemberServiceTest} · {@code FriendServiceTest} · {@code UserServiceTest}), 그리고
 * 여섯 단계가 실제 DB 에서 함께 성립하는지는 {@code UserWithdrawGroupCleanupIntegrationTest} 가
 * 본다. 이 클래스가 유일하게 지키는 것은 <b>부르는 차례</b>다 — 종전엔 한 메서드 안의 줄 순서라
 * 눈에 보였지만, 호출로 흩어진 지금은 누구든 한 줄을 위아래로 옮길 수 있고 <b>그래도 전부 초록</b>이다.
 *
 * <p>순서가 깨지면 나는 일:
 * <ul>
 *   <li>지갑 삭제가 그룹 정리보다 앞서면 → 내기 해제 환불이 {@code NOT_FOUND} 로 터진다</li>
 *   <li>익명화가 그룹 정리보다 앞서면 → 판정 근거 박제가 이미 사라진 통계를 읽는다</li>
 *   <li>PII 파기·소셜 삭제가 마지막이 아니면 → 그 뒤 단계의 엔티티 변경이 <b>조용히 유실</b>된다
 *       (소셜 벌크 DELETE 가 영속성 컨텍스트를 비운다). 예외도 실패도 없이 커밋만 안 된다</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
class AccountWithdrawalServiceTest {

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Mock
    private UserQueryService userQueryService;
    @Mock
    private GroupMemberService groupMemberService;
    @Mock
    private FocusService focusService;
    @Mock
    private StatsService statsService;
    @Mock
    private ScreenTimeService screenTimeService;
    @Mock
    private UserService userService;
    @Mock
    private FriendService friendService;

    @InjectMocks
    private AccountWithdrawalService accountWithdrawalService;

    private User givenLoadedForUpdate() {
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);
        return user;
    }

    @Test
    @DisplayName("여섯 단계가 정해진 차례로 불린다 — 한 줄만 옮겨도 이 단언이 깨져야 한다")
    void callsEveryStepInTheContractedOrder() {
        User user = givenLoadedForUpdate();

        accountWithdrawalService.withdraw(USER_ID);

        InOrder order = inOrder(userQueryService, groupMemberService, focusService, statsService,
                screenTimeService, userService, friendService);
        // 배타 락 로드가 맨 앞 — 이후 정리와 새 관계 생성을 직렬화한다
        order.verify(userQueryService).getCallerForUpdate(USER_ID);
        // 그룹(해제 환불·근거 박제)이 지갑 삭제와 익명화보다 앞
        order.verify(groupMemberService).detachWithdrawnUser(user);
        order.verify(focusService).anonymizeWithdrawnUser(USER_ID);
        order.verify(statsService).anonymizeWithdrawnUser(USER_ID);
        order.verify(screenTimeService).anonymizeWithdrawnUser(USER_ID);
        order.verify(userService).deleteWalletAndSettings(USER_ID);
        order.verify(friendService).detachWithdrawnUser(eq(USER_ID), any(Instant.class));
        // PII 파기·소셜 삭제는 반드시 맨 끝 — 뒤에 무엇이 오든 커밋되지 않는다
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

        verify(focusService, never()).anonymizeWithdrawnUser(any());
        verify(statsService, never()).anonymizeWithdrawnUser(any());
        verify(screenTimeService, never()).anonymizeWithdrawnUser(any());
        verify(userService, never()).deleteWalletAndSettings(any());
        verify(friendService, never()).detachWithdrawnUser(any(), any());
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
