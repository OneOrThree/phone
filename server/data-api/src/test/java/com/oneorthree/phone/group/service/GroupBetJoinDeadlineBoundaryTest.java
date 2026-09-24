package com.oneorthree.phone.group.service;

import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 참가 마감 가드({@code requireJoinStillOpen}, GROMO-2133)의 <b>±1초 경계</b>를 못박는다.
 *
 * <p><b>왜 별도 테스트인가.</b> 기존 통합 테스트({@code GroupBetJoinServiceIntegrationTest})는 실제
 * 시스템 시계를 쓰고 정확한 초를 고정하지 않는다 — 판정이 {@code isBefore}(미만)인지
 * {@code isAfter}(이하 허용)인지를 갈라내지 못한다. 마감 정각에 참가가 통과하는 회귀는 이 파일이
 * 유일한 증인이다.
 *
 * <p>{@link GroupBetJoinScreenTimeLockTest} 와 같은 최소 경로 원칙 — 가드에 도달할 때까지만
 * 세우고, FOCUS 챌린지로 스크린타임 가드(N50)는 건너뛴다.
 */
@ExtendWith(MockitoExtension.class)
class GroupBetJoinDeadlineBoundaryTest {

    private static final UUID GROUP_ID = UUID.randomUUID();
    private static final UUID SESSION_ID = UUID.randomUUID();
    private static final UUID CHALLENGE_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    /** 참가 마감 — KST 8/2 00:00. */
    private static final Instant JOIN_CLOSES_AT = Instant.parse("2026-08-01T15:00:00Z");

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
    @Mock
    private Clock clock;

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

    /** 참가 마감 가드 직전까지만 세운다 — 가드 판정 자체는 각 테스트가 {@code clock} 으로 가른다. */
    private void givenSessionReadyForJoinGuard() {
        given(groupBetService.requireActiveUser(USER_ID)).willReturn(user);
        given(groupBetService.requireGroupMembershipForShare(user, GROUP_ID)).willReturn(group);
        given(group.getId()).willReturn(GROUP_ID);
        given(preRead.getGroup()).willReturn(group);
        given(preRead.getChallenge()).willReturn(challenge);
        given(preRead.getId()).willReturn(SESSION_ID);
        given(challenge.getId()).willReturn(CHALLENGE_ID);
        given(groupQueryService.findBetSession(SESSION_ID)).willReturn(Optional.of(preRead));
        given(groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNullForShare(CHALLENGE_ID, group))
                .willReturn(Optional.of(challenge));
        given(challenge.getStatus()).willReturn(GroupChallengeStatus.ACTIVE);
        given(challenge.getCategory()).willReturn(MissionCategory.FOCUS);
        given(groupBetJudge.resolve(challenge)).willReturn(Optional.of(target));

        GroupChallengeBetSession lockedSession = GroupChallengeBetSession.builder()
                .id(SESSION_ID)
                .status(GroupBetStatus.OPEN)
                .joinClosesAt(JOIN_CLOSES_AT)
                .build();
        given(groupQueryService.getBetSessionForUpdate(SESSION_ID)).willReturn(lockedSession);
    }

    @Test
    @DisplayName("마감 1초 전(14:59:59Z) — 가드를 통과해 다음 협력자 호출로 넘어간다")
    void oneSecondBeforeDeadlineGuardPasses() {
        givenSessionReadyForJoinGuard();
        given(clock.instant()).willReturn(JOIN_CLOSES_AT.minusSeconds(1));
        // 가드 통과의 증인은 다음 협력자 호출이다 — 여기서 멈추면 BET_CLOSED 가 아니라
        // BET_ALREADY_JOINED 가 난다.
        given(groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(SESSION_ID, USER_ID))
                .willReturn(true);

        assertThatThrownBy(() -> groupBetJoinService.joinSession(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.BET_ALREADY_JOINED);

        verify(groupChallengeBetParticipantRepository).existsBySessionIdAndUserId(SESSION_ID, USER_ID);
    }

    @Test
    @DisplayName("마감 정각(15:00:00Z) — BET_CLOSED (isBefore 는 이하도 막는다)")
    void atDeadlineThrowsBetClosed() {
        givenSessionReadyForJoinGuard();
        given(clock.instant()).willReturn(JOIN_CLOSES_AT);

        assertThatThrownBy(() -> groupBetJoinService.joinSession(GROUP_ID, SESSION_ID, USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.BET_CLOSED);

        verify(groupChallengeBetParticipantRepository, never()).existsBySessionIdAndUserId(any(), any());
    }
}
