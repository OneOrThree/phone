package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.focus.repository.domain.UserStreak;
import com.oneorthree.phone.focus.repository.UserStreakRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
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

    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;

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

        userStreakService.updateOnSessionComplete(USER, List.of(TODAY));

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

        userStreakService.updateOnSessionComplete(USER, List.of(TODAY));

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

        userStreakService.updateOnSessionComplete(USER, List.of(TODAY));

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

        userStreakService.updateOnSessionComplete(USER, List.of(TODAY));

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

        userStreakService.updateOnSessionComplete(USER, List.of(TODAY));

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

        userStreakService.updateOnSessionComplete(USER, List.of(TODAY.minusDays(4)));

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

        userStreakService.updateOnSessionComplete(USER, List.of(TODAY.minusDays(1)));

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

        userStreakService.updateOnSessionComplete(USER, List.of(TODAY.minusDays(1)));

        assertThat(existing.getStreakCount()).isEqualTo(3);
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), any());
    }

    @Test
    @DisplayName("1252-③: 자정 걸친 세션은 어제→오늘·오늘→어제 어느 순서로 들어와도 결과가 같다")
    void midnightSplitStreakIsOrderIndependent() {
        UserStreak ascending = streak(0, 0, null);
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(ascending));
        userStreakService.updateOnSessionComplete(USER, List.of(TODAY.minusDays(1)));
        userStreakService.updateOnSessionComplete(USER, List.of(TODAY));

        UserStreak descending = streak(0, 0, null);
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(descending));
        userStreakService.updateOnSessionComplete(USER, List.of(TODAY));
        userStreakService.updateOnSessionComplete(USER, List.of(TODAY.minusDays(1)));

        assertThat(descending.getStreakCount()).isEqualTo(ascending.getStreakCount()).isEqualTo(2);
        assertThat(descending.getLastSessionDate()).isEqualTo(ascending.getLastSessionDate()).isEqualTo(TODAY);
    }

    /**
     * 1252-③(코드리뷰 3차): 한 세션이 <b>두 날</b>을 소급 기여하는 경우. 종전엔 오름차순 낱개 호출이라
     * 오래된 쪽이 유실됐다 — 구간 [TODAY-1, TODAY] 인 상태에서 TODAY-3·TODAY-2 지연 세션이 오면
     * TODAY-3 이 먼저 들어가 무시되고(그때 구간 시작은 TODAY-1), TODAY-2 가 구간을 늘린 뒤엔
     * TODAY-3 이 다시 고려되지 않아 3 에 멈췄다(4 여야 함).
     */
    @Test
    @DisplayName("1252-③: 두 날을 소급 기여하는 세션 → 최신→과거 순 반영으로 둘 다 이어진다(4)")
    void multiDayBackfillExtendsRunTwice() {
        UserStreak existing = streak(2, 2, TODAY);   // 구간 = [TODAY-1, TODAY]
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        // 오름차순으로 넘겨도(호출부 관례) 서비스가 소급 그룹을 최신→과거로 뒤집어 반영한다.
        userStreakService.updateOnSessionComplete(USER, List.of(TODAY.minusDays(3), TODAY.minusDays(2)));

        assertThat(existing.getStreakCount()).isEqualTo(4);
        assertThat(existing.getLongestStreakCount()).isEqualTo(4);
        // 구간의 '끝'은 그대로 — 앞당겨진 건 시작뿐.
        assertThat(existing.getLastSessionDate()).isEqualTo(TODAY);
    }

    /** 1252-③: 미래 방향(연장)은 종전 규칙 그대로 — 과거→최신 순이라야 첫 날짜가 reset 으로 끊기지 않는다. */
    @Test
    @DisplayName("1252-③: 자정 걸친 미래 두 날 → 연장으로 이어진다(reset 없음)")
    void multiDayForwardExtendsRun() {
        UserStreak existing = streak(1, 1, TODAY.minusDays(2));
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        userStreakService.updateOnSessionComplete(USER, List.of(TODAY.minusDays(1), TODAY));

        assertThat(existing.getStreakCount()).isEqualTo(3);
        assertThat(existing.getLastSessionDate()).isEqualTo(TODAY);
    }

    /**
     * 1252-③(코드리뷰 5차): 같은 두 날이 <b>서로 다른 요청</b>으로 나뉘어 올라오는 경우(오프라인 큐 FIFO).
     * orderForApply 는 한 호출 안의 날짜만 정렬하므로, 8~9 스트릭에 6 → 7 순서로 오면 6 은 그때 이어지지
     * 않아 무시되고 7 이 구간을 7~9 로 늘린 뒤에도 6 이 다시 고려되지 않아 3 에 멈췄다(4 여야 함).
     * 이제 소급이 성사되면 DailyFocusStat 에서 이미 자격을 갖춘 인접 과거를 훑어 구간을 재구성한다.
     */
    @Test
    @DisplayName("1252-③: 소급이 요청별로 나뉘어 와도 먼저 온 과거 날짜가 살아난다(3 → 4)")
    void splitRequestBackfillIsRebuiltFromDailyStats() {
        LocalDate aug6 = TODAY.minusDays(3);
        LocalDate aug7 = TODAY.minusDays(2);
        UserStreak existing = streak(2, 2, TODAY);   // 구간 = [TODAY-1, TODAY] (= 8~9)
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        // 1) Aug6 먼저 — Aug7 공백이 남아 있어 스트릭은 그대로(단, DailyFocusStat 은 이 날을 인정한다).
        userStreakService.updateOnSessionComplete(USER, List.of(aug6));
        assertThat(existing.getStreakCount()).isEqualTo(2);

        // 2) Aug7 도착 — 구간 시작이 Aug7 로 앞당겨진 뒤(3), 이미 자격을 갖춘 Aug6 까지 재구성된다(4).
        given(dailyFocusStatRepository.findQualifiedDates(eq(USER), any(LocalDate.class), eq(aug6), eq(600)))
                .willReturn(List.of(aug6));
        userStreakService.updateOnSessionComplete(USER, List.of(aug7));

        assertThat(existing.getStreakCount()).isEqualTo(4);
        assertThat(existing.getLongestStreakCount()).isEqualTo(4);
        // 구간의 '끝'은 그대로 — 앞당겨진 건 시작뿐.
        assertThat(existing.getLastSessionDate()).isEqualTo(TODAY);
        verify(userActivityEventLogger).log(UserActivityEvent.STREAK_UPDATED,
                Map.of("streak_count", 4, "longest_streak", 4, "change", "backfilled"));
    }

    @Test
    @DisplayName("1252-③: 재구성 스캔은 자격 없는 날에서 멈춘다(공백 너머는 잇지 않는다)")
    void rebuildStopsAtFirstUnqualifiedDay() {
        UserStreak existing = streak(1, 1, TODAY);
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));
        // TODAY-2 는 자격이 있지만 그 사이 TODAY-3 이 비어 있다 → TODAY-1 소급 후 TODAY-2 까지만 이어진다.
        given(dailyFocusStatRepository.findQualifiedDates(
                eq(USER), any(LocalDate.class), eq(TODAY.minusDays(2)), eq(600)))
                .willReturn(List.of(TODAY.minusDays(2), TODAY.minusDays(4)));

        userStreakService.updateOnSessionComplete(USER, List.of(TODAY.minusDays(1)));

        assertThat(existing.getStreakCount()).isEqualTo(3);
    }

    @Test
    @DisplayName("1252-③: 소급이 없으면(연장·리셋만) DailyFocusStat 조회를 하지 않는다")
    void forwardOnlyUpdateSkipsRebuildQuery() {
        UserStreak existing = streak(2, 2, TODAY.minusDays(1));
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        userStreakService.updateOnSessionComplete(USER, List.of(TODAY));

        verify(dailyFocusStatRepository, never())
                .findQualifiedDates(any(), any(), any(), anyInt());
    }

    @Test
    @DisplayName("longest 경계 — count 가 longest 를 넘지 않으면 longest 는 그대로")
    void longestKeptWhenCountBelowLongest() {
        UserStreak existing = streak(2, 5, TODAY.minusDays(1));
        given(userStreakRepository.findByUser(USER)).willReturn(Optional.of(existing));

        userStreakService.updateOnSessionComplete(USER, List.of(TODAY));

        assertThat(existing.getStreakCount()).isEqualTo(3);
        assertThat(existing.getLongestStreakCount()).isEqualTo(5);
        verify(userActivityEventLogger).log(UserActivityEvent.STREAK_UPDATED,
                Map.of("streak_count", 3, "longest_streak", 5, "change", "extended"));
    }
}
