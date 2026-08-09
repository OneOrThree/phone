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
 * <p>세션 완료 시 스트릭 갱신 규칙(유저 존 로컬 날짜, endedAt 기준):
 * row 없음/최초 → started, 연속(+1일) → extended, 하루 이상 건너뜀 → reset,
 * 연속 구간 안(같은 날 포함) → 무변화, 구간 시작 바로 앞날 소급 → backfilled(GROMO-1252 ③),
 * 그보다 더 과거 → 무변화(이벤트 미발행).
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
                .user(USER)
                .streakCount(count)
                .longestStreakCount(longest)
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
        assertThat(saved.getLongestStreakCount()).isEqualTo(1);
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
        assertThat(existing.getLongestStreakCount()).isEqualTo(1);
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
        assertThat(existing.getLongestStreakCount()).isEqualTo(4);
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
        assertThat(existing.getLongestStreakCount()).isEqualTo(5);
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
        assertThat(existing.getLongestStreakCount()).isEqualTo(5);
        assertThat(existing.getLastSessionDate()).isEqualTo(TODAY);
        verify(userActivityEventLogger).log(UserActivityEvent.STREAK_UPDATED,
                Map.of("streak_count", 1, "longest_streak", 5, "change", "reset"));
    }

    @Test
    @DisplayName("연속 구간보다 더 과거인 소급 저장 → 공백이 남아 무변화·이벤트 미발행")
    void pastSessionDateBeforeRunNoChange() {
        // 구간 = [TODAY-2, TODAY]. TODAY-4 는 TODAY-3 공백을 사이에 두고 있어 이어지지 않는다.
        UserStreak existing = streak(3, 5, TODAY);
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        userStreakService.updateOnSessionComplete(USER, TODAY.minusDays(4));

        assertThat(existing.getStreakCount()).isEqualTo(3);
        assertThat(existing.getLongestStreakCount()).isEqualTo(5);
        assertThat(existing.getLastSessionDate()).isEqualTo(TODAY);
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), any());
    }

    /**
     * 1252-③: 오프라인 지연 업로드로 종료일이 이미 기록된 뒤, 자정을 걸친 세션의 <b>어제 조각</b>이 도착하는
     * 케이스. 종전엔 lastSessionDate 이하라고 통째로 무시해 DailyFocusStat 만 어제를 인정하고 스트릭은
     * 복구되지 않았다. 이제 연속 구간 시작 바로 앞날이면 구간이 하루 뒤로 늘어난다.
     */
    @Test
    @DisplayName("1252-③: 오늘이 이미 기록된 상태에서 어제 조각 도착 → 소급 연장(count+1), lastSessionDate 유지")
    void yesterdaySliceBackfillsRunStart() {
        UserStreak existing = streak(1, 1, TODAY);
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        userStreakService.updateOnSessionComplete(USER, TODAY.minusDays(1));

        assertThat(existing.getStreakCount()).isEqualTo(2);
        assertThat(existing.getLongestStreakCount()).isEqualTo(2);
        // 구간의 '끝'은 그대로 — 조회 만료 판정(currentStreakAsOf)이 끝 날짜 기준이라 앞당기면 안 된다.
        assertThat(existing.getLastSessionDate()).isEqualTo(TODAY);
        verify(userActivityEventLogger).log(UserActivityEvent.STREAK_UPDATED,
                Map.of("streak_count", 2, "longest_streak", 2, "change", "backfilled"));
    }

    @Test
    @DisplayName("1252-③: 이미 연속 구간 안에 든 날짜의 소급 도착 → 이중 가산 없이 무변화")
    void backfillInsideRunIsNoChange() {
        // 구간 = [TODAY-2, TODAY]. 어제(TODAY-1)는 이미 계수돼 있다.
        UserStreak existing = streak(3, 5, TODAY);
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        userStreakService.updateOnSessionComplete(USER, TODAY.minusDays(1));

        assertThat(existing.getStreakCount()).isEqualTo(3);
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), any());
    }

    @Test
    @DisplayName("1252-③: 자정 걸친 세션은 어제→오늘·오늘→어제 어느 순서로 들어와도 결과가 같다")
    void midnightSplitStreakIsOrderIndependent() {
        UserStreak ascending = streak(0, 0, null);
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(ascending));
        userStreakService.updateOnSessionComplete(USER, TODAY.minusDays(1));
        userStreakService.updateOnSessionComplete(USER, TODAY);

        UserStreak descending = streak(0, 0, null);
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(descending));
        userStreakService.updateOnSessionComplete(USER, TODAY);
        userStreakService.updateOnSessionComplete(USER, TODAY.minusDays(1));

        assertThat(descending.getStreakCount()).isEqualTo(ascending.getStreakCount()).isEqualTo(2);
        assertThat(descending.getLastSessionDate()).isEqualTo(ascending.getLastSessionDate()).isEqualTo(TODAY);
    }

    @Test
    @DisplayName("longest 경계 — count 가 longest 를 넘지 않으면 longest 는 그대로")
    void longestKeptWhenCountBelowLongest() {
        UserStreak existing = streak(2, 5, TODAY.minusDays(1));
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        userStreakService.updateOnSessionComplete(USER, TODAY);

        assertThat(existing.getStreakCount()).isEqualTo(3);
        assertThat(existing.getLongestStreakCount()).isEqualTo(5);
        verify(userActivityEventLogger).log(UserActivityEvent.STREAK_UPDATED,
                Map.of("streak_count", 3, "longest_streak", 5, "change", "extended"));
    }
}
