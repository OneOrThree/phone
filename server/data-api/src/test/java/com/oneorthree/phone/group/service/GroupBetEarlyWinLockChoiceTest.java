package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 조기 확정 선잠금이 <b>던지지 않는 락 판</b>을 고르는지 못박는다 (GROMO-1655).
 *
 * <p><b>왜 별도 파일인가.</b> 조회 계층의 배타 락에는 판이 둘이다 —
 * {@link GroupQueryService#getBetSessionForUpdate}(부재 → {@code BET_NOT_FOUND})와
 * {@link GroupQueryService#findBetSessionForUpdate}(부재가 정상). 이 둘을 뒤바꾸면 보통은
 * <b>컴파일이 막아 준다</b>: 엔티티를 받는 자리에 {@code Optional} 을 넣거나 그 반대는 타입이
 * 안 맞는다.
 *
 * <p><b>딱 한 곳만 예외다.</b> {@code lockCandidateSessions} 의
 * {@code .forEach(groupQueryService::findBetSessionForUpdate)} 는 반환값을 버리는
 * {@code Consumer<UUID>} 자리라, {@code getBetSessionForUpdate} 로 바꿔도 깨끗하게 컴파일되고
 * 기존 테스트도 전부 초록으로 남는다 — 통합 테스트가 "회차 행이 반드시 존재하는" 상황만 세우기
 * 때문이다(사라지는 것은 참가 행이지 회차가 아니다).
 *
 * <p><b>바뀌면 무슨 일이 나는가.</b> 유저가 집중 세션을 끝내는 순간 같은 회차의 마지막 다른
 * 참가자가 철회해 회차 행이 사라질 수 있다. 지금은 빈 값으로 조용히 넘어가지만,
 * {@code get} 판이면 {@code BET_NOT_FOUND} 가 <b>집중 저장 트랜잭션 밖으로</b> 던져져 방금 한
 * 집중·통계·보상이 통째로 롤백된다. 그래서 이 단언이 유일한 증인이다.
 */
@ExtendWith(MockitoExtension.class)
class GroupBetEarlyWinLockChoiceTest {

    private static final UUID SESSION_A = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID SESSION_B = UUID.fromString("00000000-0000-0000-0000-0000000000b2");
    private static final UUID USER_ID = UUID.randomUUID();
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 8);

    @Mock
    private GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Mock
    private GroupQueryService groupQueryService;
    @Mock
    private GroupBetJudge groupBetJudge;
    @Mock
    private ApplicationEventPublisher eventPublisher;

    @InjectMocks
    private GroupBetEarlyWinConfirmer groupBetEarlyWinConfirmer;

    @Mock
    private User user;

    /** 회차 두 건을 <b>내림차순으로</b> 돌려준다 — 오름차순 정렬이 살아 있는지 보기 위해서다. */
    private void givenTwoUnconfirmedTargets() {
        given(user.getId()).willReturn(USER_ID);
        given(groupChallengeBetParticipantRepository
                .findUnconfirmedOpenFocusTargetsByUserAndDates(USER_ID, List.of(TODAY)))
                .willReturn(List.of(target(SESSION_B), target(SESSION_A)));
    }

    private GroupChallengeBetParticipantRepository.UnconfirmedFocusTarget target(UUID sessionId) {
        return new GroupChallengeBetParticipantRepository.UnconfirmedFocusTarget() {
            @Override
            public UUID getParticipantId() {
                return UUID.randomUUID();
            }

            @Override
            public UUID getSessionId() {
                return sessionId;
            }
        };
    }

    @Test
    @DisplayName("선잠금은 던지지 않는 배타 락 판을 쓴다 — get 판으로 바꾸면 집중 저장이 롤백된다")
    void lockCandidateSessionsUsesNonThrowingExclusiveLock() {
        givenTwoUnconfirmedTargets();
        given(groupQueryService.findBetSessionForUpdate(any())).willReturn(Optional.empty());

        // 잠금 대기 중 회차가 전부 사라져도 집중 저장 경로는 살아남아야 한다.
        assertThatCode(() -> groupBetEarlyWinConfirmer.lockCandidateSessions(user.getId(), List.of(TODAY)))
                .doesNotThrowAnyException();

        verify(groupQueryService).findBetSessionForUpdate(SESSION_A);
        verify(groupQueryService).findBetSessionForUpdate(SESSION_B);
        // 던지는 판으로 갈아타면 회차 소멸이 BET_NOT_FOUND 로 새어 나간다.
        verify(groupQueryService, never()).getBetSessionForUpdate(any());
        // 무락으로 내려가면 조기 확정과 정산이 같은 회차를 동시에 만질 수 있다.
        verify(groupQueryService, never()).findBetSession(any());
    }

    @Test
    @DisplayName("선잠금은 회차 id 오름차순이다 — 순서가 갈리면 정산 경로와 교착한다")
    void lockCandidateSessionsLocksInAscendingIdOrder() {
        givenTwoUnconfirmedTargets();
        given(groupQueryService.findBetSessionForUpdate(any())).willReturn(Optional.empty());

        groupBetEarlyWinConfirmer.lockCandidateSessions(user.getId(), List.of(TODAY));

        // 대상 조회가 B(뒤) → A(앞) 순으로 줘도 잠금은 A → B 여야 한다.
        var order = inOrder(groupQueryService);
        order.verify(groupQueryService).findBetSessionForUpdate(SESSION_A);
        order.verify(groupQueryService).findBetSessionForUpdate(SESSION_B);
    }
}
