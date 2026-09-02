package com.oneorthree.phone.screentime.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.screentime.repository.domain.DailyScreenTimeStat;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 그룹 챌린지 진행률이 쓰는 배치 조회(findByUserInAndDate)를 실 SQL 로 검증한다.
 * 서비스 단위 테스트는 이 쿼리를 모킹하므로 IN 절·날짜 매칭 오류는 여기서만 잡힌다.
 */
class DailyScreenTimeStatRepositoryTest extends RepositoryTestBase {

    @Autowired
    DailyScreenTimeStatRepository dailyScreenTimeStatRepository;
    @Autowired
    UserRepository userRepository;

    private static final LocalDate DATE = LocalDate.of(2026, 8, 1);

    private User saveUser(String nickname) {
        return userRepository.save(User.builder().nickname(nickname).build());
    }

    private void saveStat(User user, LocalDate date, int minutes) {
        dailyScreenTimeStatRepository.save(DailyScreenTimeStat.builder()
                .user(user).date(date).totalScreenTimeMinutes(minutes).build());
    }

    @Test
    @DisplayName("findByUserInAndDate — 지정 유저·해당 날짜 행만 반환하고, 통계 없는 유저는 행 자체가 없다")
    void findByUserInAndDateReturnsOnlyRequestedUsersOnThatDate() {
        // given: 당일 통계가 있는 유저 2명 + 없는 유저 1명 + IN 집합 밖 유저 1명 + 전날 통계
        User withStat = saveUser("있음");
        User alsoWithStat = saveUser("있음2");
        User withoutStat = saveUser("없음");
        User outsider = saveUser("남");

        saveStat(withStat, DATE, 120);
        saveStat(alsoWithStat, DATE, 30);
        saveStat(withStat, DATE.minusDays(1), 999);   // 다른 날짜 — 잡히면 안 됨
        saveStat(outsider, DATE, 500);                // IN 집합 밖 — 잡히면 안 됨
        dailyScreenTimeStatRepository.flush();

        // when
        List<DailyScreenTimeStat> stats = dailyScreenTimeStatRepository
                .findByUserInAndDate(List.of(withStat, alsoWithStat, withoutStat), DATE);

        // then: 요청 유저 중 당일 행이 있는 2건만
        assertThat(stats).hasSize(2);
        assertThat(stats).allSatisfy(stat -> assertThat(stat.getDate()).isEqualTo(DATE));
        assertThat(stats)
                .extracting(stat -> stat.getUser().getId())
                .containsExactlyInAnyOrder(withStat.getId(), alsoWithStat.getId());
        assertThat(stats)
                .extracting(DailyScreenTimeStat::getTotalScreenTimeMinutes)
                .containsExactlyInAnyOrder(120, 30);
    }
}
