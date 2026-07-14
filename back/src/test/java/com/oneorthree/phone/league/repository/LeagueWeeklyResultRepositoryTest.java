package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.league.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LeagueWeeklyResultRepositoryTest extends RepositoryTestBase {

    private static final Instant WEEK_START = Instant.parse("2026-07-05T15:00:00Z");

    @Autowired
    LeagueWeeklyResultRepository leagueWeeklyResultRepository;
    @Autowired
    UserRepository userRepository;

    private LeagueWeeklyResult result(User user, LeagueWeeklyResultType result) {
        return LeagueWeeklyResult.builder()
                .user(user)
                .weekStartAt(WEEK_START)
                .previousTierLevel(2)
                .newTierLevel(result == LeagueWeeklyResultType.PROMOTED ? 3 : 2)
                .result(result)
                .focusSeconds(101_000)
                .build();
    }

    @Test
    @DisplayName("주간 결과 저장 후 사용자 최신 결과와 주차·결과 조건으로 조회")
    void saveAndFindResult() {
        User user = userRepository.save(User.builder().nickname("result-user").tierLevel(3).build());
        LeagueWeeklyResult saved = leagueWeeklyResultRepository.saveAndFlush(
                result(user, LeagueWeeklyResultType.PROMOTED));

        assertThat(saved.getId()).isNotNull();
        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(leagueWeeklyResultRepository.findTopByUserIdOrderByCreatedAtDesc(user.getId()))
                .contains(saved);
        assertThat(leagueWeeklyResultRepository.findByWeekStartAtAndResultIn(
                WEEK_START, List.of(LeagueWeeklyResultType.PROMOTED, LeagueWeeklyResultType.RELEGATED)))
                .containsExactly(saved);
    }

    @Test
    @DisplayName("동일 사용자·주차 결과를 두 번 저장하면 유니크 제약 위반")
    void duplicateUserAndWeekRejected() {
        User user = userRepository.save(User.builder().nickname("duplicate-result-user").build());
        leagueWeeklyResultRepository.saveAndFlush(result(user, LeagueWeeklyResultType.STAY));

        assertThatThrownBy(() -> leagueWeeklyResultRepository.saveAndFlush(
                result(user, LeagueWeeklyResultType.STAY)))
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
