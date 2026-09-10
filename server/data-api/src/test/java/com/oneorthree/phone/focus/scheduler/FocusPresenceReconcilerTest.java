package com.oneorthree.phone.focus.scheduler;

import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 기동 시 DB 정본에서 프레즌스를 재구축하는지.
 *
 * <p>이게 없으면 {@code focus.presence.enabled} 를 «처음 켜는» 순간 이미 진행 중이던 집중은 리스가
 * 없어, 그 사람들은 세션이 끝날 때까지 집중 중에도 채팅에 들어가고 발신할 수 있다 — 롤아웃 창 전체가
 * 규칙 밖이 된다. Redis 가 비었을 때도 같다.
 *
 * <p>목표 아키텍처 A19 의 「Redis 는 사본이라 소유자가 DB 정본에서 재구축할 수 있어야 한다」가
 * 프레즌스 쪽에서 구현된 자리이기도 하다.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class FocusPresenceReconcilerTest {

    private static final Instant NOW = Instant.parse("2026-09-11T00:00:00Z");

    @Mock
    private FocusSessionRepository focusSessionRepository;

    @Mock
    private FocusPresencePort focusPresencePort;

    private FocusPresenceReconciler reconciler() {
        return new FocusPresenceReconciler(focusSessionRepository, focusPresencePort,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    @DisplayName("진행 중인 세션 전부에 리스를 다시 놓는다 — 각자 «자기» 세션 id 로")
    void restoresLeasesForOpenMarkers() {
        UUID firstUser = UUID.randomUUID();
        UUID secondUser = UUID.randomUUID();
        FocusSession first = openMarker(firstUser);
        FocusSession second = openMarker(secondUser);
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtBefore(any())).willReturn(List.of(first, second));

        reconciler().restoreLeasesOnStartup();

        verify(focusPresencePort).focusStarted(firstUser, first.getId());
        verify(focusPresencePort).focusStarted(secondUser, second.getId());
    }

    @Test
    @DisplayName("유저가 없는(탈퇴로 끊긴) 행은 건너뛴다 — 누구의 리스인지 알 수 없다")
    void skipsRowsWithoutUser() {
        FocusSession orphaned = FocusSession.builder()
                .id(UUID.randomUUID())
                .startedAt(NOW.minusSeconds(60))
                .build();
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtBefore(any())).willReturn(List.of(orphaned));

        reconciler().restoreLeasesOnStartup();

        verify(focusPresencePort, never()).focusStarted(any(), any());
    }

    @Test
    @DisplayName("진행 중인 세션이 없으면 아무것도 하지 않는다")
    void doesNothingWhenNoOpenMarkers() {
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtBefore(any())).willReturn(List.of());

        reconciler().restoreLeasesOnStartup();

        verify(focusPresencePort, never()).focusStarted(any(), any());
    }

    @Test
    @DisplayName("재구축이 실패해도 «기동»을 막지 않는다 — Redis 때문에 코어 API 가 못 뜨면 안 된다")
    void failureDoesNotBlockStartup() {
        willThrow(new IllegalStateException("redis down"))
                .given(focusSessionRepository).findByEndedAtIsNullAndStartedAtBefore(any());

        assertThatCode(() -> reconciler().restoreLeasesOnStartup()).doesNotThrowAnyException();
    }

    private FocusSession openMarker(UUID userId) {
        return FocusSession.builder()
                .id(UUID.randomUUID())
                .user(User.builder().id(userId).build())
                .startedAt(NOW.minusSeconds(600))
                .build();
    }
}
