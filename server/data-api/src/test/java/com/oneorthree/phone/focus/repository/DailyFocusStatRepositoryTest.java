package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 당일 집중 집계의 사용자·날짜 필터를 실제 PostgreSQL에서 검증한다. */
class DailyFocusStatRepositoryTest extends RepositoryTestBase {

    @Autowired
    DailyFocusStatRepository dailyFocusStatRepository;
    @Autowired
    UserRepository userRepository;

    private User saveUser(String nickname) {
        return userRepository.save(User.builder().nickname(nickname).build());
    }

    private void saveStat(User user, LocalDate date, int seconds) {
        dailyFocusStatRepository.save(DailyFocusStat.builder()
                .user(user).date(date).totalFocusSeconds(seconds).sessionCount(1).build());
    }

    // ── findByUserIdInAndDate (GROMO-822 FocusLiveInfoLookup 공용) ─────────

    @Test
    @DisplayName("byUserIdInAndDate — userId 집합의 당일 집계만 반환. 다른 날짜·집합 밖 유저는 제외")
    void byUserIdInAndDate_returnsStatsForUserIdsOnDate() {
        User a = saveUser("a");
        User b = saveUser("b");
        User outOfSet = saveUser("outOfSet");
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
