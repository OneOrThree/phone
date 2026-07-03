package com.oneorthree.phone.user.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserStreak;
import com.oneorthree.phone.user.repository.UserStreakRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * UserStreakService 단위 테스트.
 *
 * <p>세션 완료 시 스트릭 갱신 규칙(UTC 날짜, endedAt 기준):
 * row 없음/최초 → started, 연속(+1일) → extended, 하루 이상 건너뜀 → reset,
 * 같은 날·과거 세션 소급 → 무변화(이벤트 미발행).
 */
@ExtendWith(MockitoExtension.class)
class UserStreakServiceTest {

    @InjectMocks
    private UserStreakService userStreakService;

    @Mock
    private UserStreakRepository userStreakRepository;

    @Mock
    private UserActivityEventLogger userActivityEventLogger;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final User USER = User.builder().id(USER_ID).build();
    private static final LocalDate TODAY = LocalDate.of(2026, 7, 1);

    private UserStreak streak(int count, int longest, LocalDate lastSessionDate) {
        return UserStreak.builder()
                .id(UUID.randomUUID())
                .user(USER)
                .streakCount(count)
                .longestStreak(longest)
                .lastSessionDate(lastSessionDate)
                .build();
    }

    @Test
    @DisplayName("첫 세션(row 없음) → row 생성(count=1, longest=1, lastSessionDate=오늘) + change=started 발행")
    void firstSessionWithoutRowCreatesAndStarts() {
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.empty());
        given(userStreakRepository.save(any(UserStreak.class))).willAnswer(inv -> inv.getArgument(0));

        userStreakService.updateOnSessionComplete(USER, TODAY);

        ArgumentCaptor<UserStreak> captor = ArgumentCaptor.forClass(UserStreak.class);
        verify(userStreakRepository).save(captor.capture());
        UserStreak saved = captor.getValue();
        assertThat(saved.getUser()).isEqualTo(USER);
        assertThat(saved.getStreakCount()).isEqualTo(1);
        assertThat(saved.getLongestStreak()).isEqualTo(1);
        assertThat(saved.getLastSessionDate()).isEqualTo(TODAY);
        verify(userActivityEventLogger).log(UserActivityEvent.STREAK_UPDATED,
                Map.of("streak_count", 1, "longest_streak", 1, "change", "started"));
    }

    @Test
    @DisplayName("row 있으나 lastSessionDate=null → count=1 로 시작, change=started (신규 save 없음)")
    void rowWithoutLastSessionDateStarts() {
        UserStreak existing = streak(0, 0, null);
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        userStreakService.updateOnSessionComplete(USER, TODAY);

        assertThat(existing.getStreakCount()).isEqualTo(1);
        assertThat(existing.getLongestStreak()).isEqualTo(1);
        assertThat(existing.getLastSessionDate()).isEqualTo(TODAY);
        // 기존 row 는 더티 체킹으로 반영 — save 미호출
        verify(userStreakRepository, never()).save(any(UserStreak.class));
        verify(userActivityEventLogger).log(UserActivityEvent.STREAK_UPDATED,
                Map.of("streak_count", 1, "longest_streak", 1, "change", "started"));
    }

    @Test
    @DisplayName("다음날 연속 세션 → count+1, longest 동시 갱신, change=extended")
    void nextDayExtendsStreak() {
        UserStreak existing = streak(3, 3, TODAY.minusDays(1));
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        userStreakService.updateOnSessionComplete(USER, TODAY);

        assertThat(existing.getStreakCount()).isEqualTo(4);
        assertThat(existing.getLongestStreak()).isEqualTo(4);
        assertThat(existing.getLastSessionDate()).isEqualTo(TODAY);
        verify(userActivityEventLogger).log(UserActivityEvent.STREAK_UPDATED,
                Map.of("streak_count", 4, "longest_streak", 4, "change", "extended"));
    }

    @Test
    @DisplayName("같은 날 두 번째 세션 → 무변화·이벤트 미발행")
    void sameDaySecondSessionNoChange() {
        UserStreak existing = streak(3, 5, TODAY);
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        userStreakService.updateOnSessionComplete(USER, TODAY);

        assertThat(existing.getStreakCount()).isEqualTo(3);
        assertThat(existing.getLongestStreak()).isEqualTo(5);
        assertThat(existing.getLastSessionDate()).isEqualTo(TODAY);
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), any());
    }

    @Test
    @DisplayName("하루 이상 건너뜀 → count=1 리셋, longest 유지, change=reset")
    void skippedDayResetsStreak() {
        UserStreak existing = streak(5, 5, TODAY.minusDays(2));
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        userStreakService.updateOnSessionComplete(USER, TODAY);

        assertThat(existing.getStreakCount()).isEqualTo(1);
        assertThat(existing.getLongestStreak()).isEqualTo(5);
        assertThat(existing.getLastSessionDate()).isEqualTo(TODAY);
        verify(userActivityEventLogger).log(UserActivityEvent.STREAK_UPDATED,
                Map.of("streak_count", 1, "longest_streak", 5, "change", "reset"));
    }

    @Test
    @DisplayName("과거 날짜 세션 소급 저장 → 무변화·이벤트 미발행 (방어)")
    void pastSessionDateNoChange() {
        UserStreak existing = streak(3, 5, TODAY);
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        userStreakService.updateOnSessionComplete(USER, TODAY.minusDays(3));

        assertThat(existing.getStreakCount()).isEqualTo(3);
        assertThat(existing.getLongestStreak()).isEqualTo(5);
        assertThat(existing.getLastSessionDate()).isEqualTo(TODAY);
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), any());
    }

    @Test
    @DisplayName("longest 경계 — count 가 longest 를 넘지 않으면 longest 는 그대로")
    void longestKeptWhenCountBelowLongest() {
        UserStreak existing = streak(2, 5, TODAY.minusDays(1));
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        userStreakService.updateOnSessionComplete(USER, TODAY);

        assertThat(existing.getStreakCount()).isEqualTo(3);
        assertThat(existing.getLongestStreak()).isEqualTo(5);
        verify(userActivityEventLogger).log(UserActivityEvent.STREAK_UPDATED,
                Map.of("streak_count", 3, "longest_streak", 5, "change", "extended"));
    }
}
