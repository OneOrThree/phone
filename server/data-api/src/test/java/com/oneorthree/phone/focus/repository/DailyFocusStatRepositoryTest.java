package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.focus.repository.FocusAverageAggregate;
import com.oneorthree.phone.user.repository.domain.Occupation;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 평균 집중 API(GROMO-753) 집계 쿼리 3종의 정확성 검증 (Testcontainers PostgreSQL).
 * COUNT(DISTINCT user) 모수·COALESCE(SUM,0)·기간 경계·탈퇴 유저 제외를 실제 SQL 로 확인한다.
 */
class DailyFocusStatRepositoryTest extends RepositoryTestBase {

    @Autowired
    DailyFocusStatRepository dailyFocusStatRepository;
    @Autowired
    UserRepository userRepository;

    private static final LocalDate FROM = LocalDate.of(2026, 7, 1);
    private static final LocalDate TO = LocalDate.of(2026, 7, 7);

    private User saveUser(String nickname, Occupation occupation) {
        return userRepository.save(User.builder().nickname(nickname).occupation(occupation).build());
    }

    private void saveStat(User user, LocalDate date, int seconds) {
        dailyFocusStatRepository.save(DailyFocusStat.builder()
                .user(user).date(date).totalFocusSeconds(seconds).sessionCount(1).build());
    }

    // ── sumAndActiveCountByUsersInPeriod (FRIENDS) ────────────────────────

    @Test
    @DisplayName("byUsers — 집합 유저의 기간 내 초 합·활동 유저 수(DISTINCT). 같은 유저 여러 날은 1명으로 카운트")
    void byUsers_sumsAndCountsDistinctActiveUsers() {
        User a = saveUser("a", null);
        User b = saveUser("b", null);
        User c = saveUser("c", null);
        // a: 기간 내 2일(3000+2000=5000), b: 기간 내 1일(1000), c: 무활동
        saveStat(a, LocalDate.of(2026, 7, 2), 3000);
        saveStat(a, LocalDate.of(2026, 7, 4), 2000);
        saveStat(b, LocalDate.of(2026, 7, 3), 1000);
        dailyFocusStatRepository.flush();

        FocusAverageAggregate agg = dailyFocusStatRepository
                .sumAndActiveCountByUsersInPeriod(List.of(a, b, c), FROM, TO);

        // 합 = 6000, 활동 유저 = a,b 2명 (c 는 row 없어 미포함)
        assertThat(agg.totalSeconds()).isEqualTo(6000L);
        assertThat(agg.activeUserCount()).isEqualTo(2L);
    }

    @Test
    @DisplayName("byUsers — 기간 밖(경계 초과) row 는 제외 (BETWEEN from AND to)")
    void byUsers_excludesOutOfRange() {
        User a = saveUser("a", null);
        saveStat(a, FROM, 1000);                          // 경계 시작(포함)
        saveStat(a, TO, 500);                             // 경계 끝(포함)
        saveStat(a, FROM.minusDays(1), 9999);             // 기간 이전(제외)
        saveStat(a, TO.plusDays(1), 8888);                // 기간 이후(제외)
        dailyFocusStatRepository.flush();

        FocusAverageAggregate agg = dailyFocusStatRepository
                .sumAndActiveCountByUsersInPeriod(List.of(a), FROM, TO);

        assertThat(agg.totalSeconds()).isEqualTo(1500L);
        assertThat(agg.activeUserCount()).isEqualTo(1L);
    }

    @Test
    @DisplayName("byUsers — 집합에 든 유저 중 활동 없음 → 합 0, 활동 유저 0 (COALESCE 로 null 아닌 0)")
    void byUsers_noActivityReturnsZero() {
        User a = saveUser("a", null);
        FocusAverageAggregate agg = dailyFocusStatRepository
                .sumAndActiveCountByUsersInPeriod(List.of(a), FROM, TO);

        assertThat(agg.totalSeconds()).isZero();
        assertThat(agg.activeUserCount()).isZero();
    }

    // ── sumAndActiveCountAllInPeriod (TOTAL) ──────────────────────────────

    @Test
    @DisplayName("all — 전체 유저 기간 내 초 합·활동 유저 수. 탈퇴(user=null) row 는 제외")
    void all_sumsAllExcludingWithdrawn() {
        User a = saveUser("a", null);
        User b = saveUser("b", null);
        saveStat(a, LocalDate.of(2026, 7, 2), 4000);
        saveStat(b, LocalDate.of(2026, 7, 3), 2000);
        dailyFocusStatRepository.flush();

        // 탈퇴 유저 시뮬레이션: user_id = null 인 고아 집계 row (nullifyUser 결과와 동일 상태)
        User withdrawn = saveUser("withdrawn", null);
        saveStat(withdrawn, LocalDate.of(2026, 7, 4), 9999);
        dailyFocusStatRepository.flush();
        dailyFocusStatRepository.nullifyUser(withdrawn.getId());
        dailyFocusStatRepository.flush();

        FocusAverageAggregate agg = dailyFocusStatRepository.sumAndActiveCountAllInPeriod(FROM, TO);

        // 합 = 6000 (탈퇴 9999 제외), 활동 유저 = a,b 2명 (null user 미포함)
        assertThat(agg.totalSeconds()).isEqualTo(6000L);
        assertThat(agg.activeUserCount()).isEqualTo(2L);
    }

    @Test
    @DisplayName("all — 활동 유저 전무 → 합 0, 활동 유저 0")
    void all_noActivityReturnsZero() {
        saveUser("idle", null); // row 없음
        FocusAverageAggregate agg = dailyFocusStatRepository.sumAndActiveCountAllInPeriod(FROM, TO);

        assertThat(agg.totalSeconds()).isZero();
        assertThat(agg.activeUserCount()).isZero();
    }

    // ── sumAndActiveCountByOccupationInPeriod (CATEGORY) ──────────────────

    @Test
    @DisplayName("byOccupation — 같은 occupation 유저만 집계. 다른 occupation·null occupation 은 제외")
    void byOccupation_filtersByOccupation() {
        User coder1 = saveUser("coder1", Occupation.CODING);
        User coder2 = saveUser("coder2", Occupation.CODING);
        User csat = saveUser("csat", Occupation.CSAT);
        User noOcc = saveUser("noOcc", null);
        saveStat(coder1, LocalDate.of(2026, 7, 2), 3000);
        saveStat(coder2, LocalDate.of(2026, 7, 3), 1000);
        saveStat(csat, LocalDate.of(2026, 7, 4), 5000);   // 다른 직군(제외)
        saveStat(noOcc, LocalDate.of(2026, 7, 5), 7000);  // occupation null(제외)
        dailyFocusStatRepository.flush();

        FocusAverageAggregate agg = dailyFocusStatRepository
                .sumAndActiveCountByOccupationInPeriod(Occupation.CODING, FROM, TO);

        // CODING 만: 3000+1000=4000, 활동 유저 2명
        assertThat(agg.totalSeconds()).isEqualTo(4000L);
        assertThat(agg.activeUserCount()).isEqualTo(2L);
    }

    @Test
    @DisplayName("byOccupation — 해당 occupation 활동 유저 없음 → 합 0, 활동 유저 0")
    void byOccupation_noActivityReturnsZero() {
        saveUser("coder", Occupation.CODING); // row 없음
        FocusAverageAggregate agg = dailyFocusStatRepository
                .sumAndActiveCountByOccupationInPeriod(Occupation.CODING, FROM, TO);

        assertThat(agg.totalSeconds()).isZero();
        assertThat(agg.activeUserCount()).isZero();
    }

    // ── findUserIdsWithFocusOnDate (GROMO-841 오늘 미집중) ─────────────────

    @Test
    @DisplayName("focusOnDate — 해당 날짜 집중>0 인 유저 id만. 0초·다른 날짜·집합 밖 유저는 제외")
    void focusOnDate_returnsUsersWithPositiveFocusThatDay() {
        User focused = saveUser("focused", null);
        User zero = saveUser("zero", null);
        User otherDay = saveUser("otherDay", null);
        User outOfSet = saveUser("outOfSet", null);
        LocalDate day = LocalDate.of(2026, 7, 3);
        saveStat(focused, day, 1200);               // 당일 집중>0 → 포함
        saveStat(zero, day, 0);                     // 당일 0초 → 제외
        saveStat(otherDay, day.minusDays(1), 3000); // 다른 날짜 → 제외
        saveStat(outOfSet, day, 5000);              // 집합 밖 → 제외
        dailyFocusStatRepository.flush();

        List<UUID> result = dailyFocusStatRepository.findUserIdsWithFocusOnDate(
                List.of(focused.getId(), zero.getId(), otherDay.getId()), day);

        assertThat(result).containsExactly(focused.getId());
    }

    // ── findByUserIdInAndDate (GROMO-822 FocusLiveInfoLookup 공용) ─────────

    @Test
    @DisplayName("byUserIdInAndDate — userId 집합의 당일 집계만 반환. 다른 날짜·집합 밖 유저는 제외")
    void byUserIdInAndDate_returnsStatsForUserIdsOnDate() {
        User a = saveUser("a", null);
        User b = saveUser("b", null);
        User outOfSet = saveUser("outOfSet", null);
        LocalDate day = LocalDate.of(2026, 7, 3);
        saveStat(a, day, 2520);                 // 당일 → 포함
        saveStat(b, day.minusDays(1), 3000);    // 다른 날짜 → 제외
        saveStat(outOfSet, day, 5000);          // 집합 밖 → 제외
        dailyFocusStatRepository.flush();

        List<DailyFocusStat> result = dailyFocusStatRepository.findByUserIdInAndDate(
                List.of(a.getId(), b.getId()), day);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getUser().getId()).isEqualTo(a.getId());
        assertThat(result.get(0).getTotalFocusSeconds()).isEqualTo(2520);
    }
}
