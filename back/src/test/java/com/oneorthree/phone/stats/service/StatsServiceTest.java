package com.oneorthree.phone.stats.service;

import com.oneorthree.phone.focus.domain.DailyFocusStat;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.exception.StatsException;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserStreak;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserStreakRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;

@ExtendWith(MockitoExtension.class)
class StatsServiceTest {

    @InjectMocks
    private StatsService statsService;

    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;
    @Mock
    private UserStreakRepository userStreakRepository;
    @Mock
    private UserRepository userRepository;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    // ── getHeatmap ────────────────────────────────────────────────────────

    @Test
    @DisplayName("히트맵 — Dense: 범위 내 모든 날짜 반환, 데이터 없는 날은 0 셀")
    void getHeatmapDenseFill() {
        LocalDate from = LocalDate.of(2026, 6, 1);
        LocalDate to = LocalDate.of(2026, 6, 3);
        User user = User.builder().id(USER_ID).build();
        DailyFocusStat mid = DailyFocusStat.builder()
                .user(user).date(LocalDate.of(2026, 6, 2))
                .totalFocusMinutes(120).sessionCount(2)
                .focusGoalAchieved(true).actualScreenTimeMinutes(30).screenTimeGoalAchieved(false)
                .build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(dailyFocusStatRepository.findByUserAndDateBetweenOrderByDateAsc(user, from, to))
                .willReturn(List.of(mid));

        List<HeatmapCellResponse> cells = statsService.getHeatmap(USER_ID, from, to);

        assertThat(cells).hasSize(3);
        assertThat(cells.get(0).date()).isEqualTo(from);
        assertThat(cells.get(0).totalFocusMinutes()).isZero();
        assertThat(cells.get(0).focusGoalAchieved()).isFalse();
        assertThat(cells.get(1).date()).isEqualTo(LocalDate.of(2026, 6, 2));
        assertThat(cells.get(1).totalFocusMinutes()).isEqualTo(120);
        assertThat(cells.get(1).sessionCount()).isEqualTo(2);
        assertThat(cells.get(1).focusGoalAchieved()).isTrue();
        assertThat(cells.get(1).actualScreenTimeMinutes()).isEqualTo(30);
        assertThat(cells.get(2).date()).isEqualTo(to);
        assertThat(cells.get(2).totalFocusMinutes()).isZero();
    }

    @Test
    @DisplayName("히트맵 — from > to → StatsException")
    void getHeatmapReversedRange() {
        assertThatThrownBy(() ->
                statsService.getHeatmap(USER_ID, LocalDate.of(2026, 6, 3), LocalDate.of(2026, 6, 1)))
                .isInstanceOf(StatsException.class);
    }

    @Test
    @DisplayName("히트맵 — 범위 366일 초과 → StatsException")
    void getHeatmapRangeTooLarge() {
        LocalDate from = LocalDate.of(2025, 1, 1);
        LocalDate to = from.plusDays(366); // 367일

        assertThatThrownBy(() -> statsService.getHeatmap(USER_ID, from, to))
                .isInstanceOf(StatsException.class);
    }

    // ── getStreak ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("스트릭 — 기록 있으면 매핑")
    void getStreakMapped() {
        User user = User.builder().id(USER_ID).build();
        UserStreak streak = UserStreak.builder()
                .user(user).streakCount(5).longestStreak(10).lastSessionDate(LocalDate.of(2026, 6, 28))
                .build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(userStreakRepository.findByUser(user)).willReturn(Optional.of(streak));

        StreakResponse response = statsService.getStreak(USER_ID);

        assertThat(response.currentStreak()).isEqualTo(5);
        assertThat(response.longestStreak()).isEqualTo(10);
        assertThat(response.lastSessionDate()).isEqualTo(LocalDate.of(2026, 6, 28));
    }

    @Test
    @DisplayName("스트릭 — 기록 없으면 0/0/null")
    void getStreakNoRow() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(userStreakRepository.findByUser(user)).willReturn(Optional.empty());

        StreakResponse response = statsService.getStreak(USER_ID);

        assertThat(response.currentStreak()).isZero();
        assertThat(response.longestStreak()).isZero();
        assertThat(response.lastSessionDate()).isNull();
    }
}
