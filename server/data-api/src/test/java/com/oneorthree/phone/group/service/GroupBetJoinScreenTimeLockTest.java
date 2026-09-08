package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * SCREEN_TIME 참여 가드가 <b>공유 락 판</b>을 고르는지 못박는다 (GROMO-1409·N50, GROMO-1655).
 *
 * <p><b>왜 별도 파일인가.</b> 조회 계층이 생기면서 락 등급은 두 겹이 됐다 —
 * ① 계층 메서드가 어떤 리포지토리 쿼리를 타는가(그건
 * {@code UserQueryServiceTest} 가 지킨다)와 ② <b>호출부가 어떤 계층 메서드를 고르는가</b>다.
 * ②는 계층 테스트가 지킬 수 없다. 짝인 배타 락 쪽({@code UserService.updateScreenTimePermission})
 * 에는 {@code UserServiceTest} 에 가드가 있는데 이쪽 공유 락에는 없어 비대칭이었다.
 *
 * <p><b>무엇을 막는가.</b> {@code GroupBetJoinService.requireScreenTimePermission} 이
 * {@code findScreenTimeSettingsForShare} 대신 무락 {@code findScreenTimeSettings} 로 갈아타면,
 * 권한 확인과 참가비 차감 사이에 권한 회수(배타 락)가 끼어들 수 있다. 그러면 <b>보고하지 못하는
 * 유료 참가</b>가 남는다 — 돈은 나갔는데 그 유저는 스크린타임을 보고할 수 없어 자동 실패한다.
 * 무락으로 바꿔도 기능 테스트는 전부 초록이므로 이 단언이 유일한 증인이다.
 *
 * <p>참여 흐름 전체가 아니라 <b>권한 가드에 도달하는 최소 경로</b>만 세운다. 가드가 거절하는
 * 순간 예외가 나가므로 그 뒤(회차 잠금·차감·참가 기록)는 스텁이 필요 없다.
 */
@ExtendWith(MockitoExtension.class)
class GroupBetJoinScreenTimeLockTest {

    private static final UUID GROUP_ID = UUID.randomUUID();
    private static final UUID SESSION_ID = UUID.randomUUID();
    private static final UUID CHALLENGE_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();

    @Mock
    private GroupChallengeRepository groupChallengeRepository;
    @Mock
    private GroupChallengeBetRepository groupChallengeBetRepository;
    @Mock
    private GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @Mock
    private GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Mock
    private GroupQueryService groupQueryService;
    @Mock
    private UserQueryService userQueryService;
    @Mock
    private CurrencyLedgerService currencyLedgerService;
    @Mock
    private GroupBetJudge groupBetJudge;
    @Mock
    private GroupBetService groupBetService;

    @InjectMocks
    private GroupBetJoinService groupBetJoinService;

    @Mock
    private User user;
    @Mock
    private Group group;
    @Mock
    private GroupChallenge challenge;
    @Mock
    private GroupChallengeBetSession preRead;
    @Mock
    private GroupBetJudge.Target target;

    /** 권한 가드 직전까지만 세운다 — 가드가 거절하면 그 뒤 경로는 실행되지 않는다. */
    private void givenScreenTimeChallengeReadyToJoin() {
        given(groupBetService.requireActiveUser(USER_ID)).willReturn(user);
        given(groupBetService.requireGroupMembershipForShare(user, GROUP_ID)).willReturn(group);
        given(group.getId()).willReturn(GROUP_ID);
        given(preRead.getGroup()).willReturn(group);
        given(preRead.getChallenge()).willReturn(challenge);
        given(challenge.getId()).willReturn(CHALLENGE_ID);
        given(groupChallengeBetSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(preRead));
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNullForShare(CHALLENGE_ID, group))
                .willReturn(Optional.of(challenge));
        given(challenge.getStatus()).willReturn(GroupChallengeStatus.ACTIVE);
        given(challenge.getCategory()).willReturn(MissionCategory.SCREEN_TIME);
        given(groupBetJudge.resolve(challenge)).willReturn(Optional.of(target));
        given(user.getId()).willReturn(USER_ID);
    }

    @Test
    @DisplayName("SCREEN_TIME 참여 가드는 공유 락 판을 쓴다 — 무락·배타 락으로 갈아타면 안 된다")
    void screenTimeGuardUsesSharedLockRead() {
        givenScreenTimeChallengeReadyToJoin();
        given(userQueryService.findScreenTimeSettingsForShare(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> groupBetJoinService.joinSession(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.BET_SCREENTIME_PERMISSION_REQUIRED);

        // 락 등급이 이 한 줄에만 있다 — 대상이 바뀌면 권한 회수와의 직렬화가 사라진다.
        verify(userQueryService).findScreenTimeSettingsForShare(USER_ID);
        verify(userQueryService, never()).findScreenTimeSettings(any());
        verify(userQueryService, never()).getScreenTimeSettings(any());
        verify(userQueryService, never()).getScreenTimeSettingsForUpdate(any());
    }
}
