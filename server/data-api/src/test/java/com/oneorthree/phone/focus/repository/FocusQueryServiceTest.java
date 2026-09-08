package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 집중 세션 조회 계층 (GROMO-1655). 규약 §3 이 요구하는 세 가지를 단언한다 —
 * 부재 시 예외 코드, 던지는 것과 안 던지는 것의 구분, <b>어떤 리포지토리 메서드를 부르는가</b>.
 *
 * <p>세 번째가 특히 필요하다. 이 계층은 <b>락 없는 조회</b>인데, 같은 리포지토리에 소유자까지 접은
 * 배타 락 조회({@code findByIdAndUserForUpdate})가 있다. 실수로 그쪽을 부르면 락 등급과 소유자
 * 검증이 동시에 바뀌는데 호출부 테스트는 계층을 목으로 세우므로 아무것도 눈치채지 못한다.
 */
@ExtendWith(MockitoExtension.class)
class FocusQueryServiceTest {

    private static final UUID SESSION_ID = UUID.randomUUID();

    @Mock
    private FocusSessionRepository focusSessionRepository;

    @InjectMocks
    private FocusQueryService focusQueryService;

    @Mock
    private FocusSession session;

    @Test
    @DisplayName("세션이 없으면 SESSION_NOT_FOUND")
    void getFocusSessionThrowsWhenAbsent() {
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> focusQueryService.getFocusSession(SESSION_ID))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.SESSION_NOT_FOUND);
    }

    @Test
    @DisplayName("락 없는 조회를 쓴다 — 소유자를 접은 배타 락 조회로 갈아타면 안 된다")
    void getFocusSessionUsesUnlockedReadWithoutOwnerFilter() {
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));

        assertThat(focusQueryService.getFocusSession(SESSION_ID)).isSameAs(session);
        verify(focusSessionRepository).findById(SESSION_ID);
        verify(focusSessionRepository, never()).findByIdAndUserForUpdate(any(), any());
    }
}
