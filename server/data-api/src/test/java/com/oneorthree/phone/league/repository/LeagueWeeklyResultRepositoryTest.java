package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LeagueWeeklyResultRepositoryTest extends RepositoryTestBase {

    private static final Instant WEEK_START = Instant.parse("2026-07-05T15:00:00Z");
    private static final Instant OTHER_WEEK_START = Instant.parse("2026-06-28T15:00:00Z");
    private static final Instant ACK_AT = Instant.parse("2026-07-10T00:00:00Z");
    private static final Instant LATER_ACK_AT = Instant.parse("2026-07-11T00:00:00Z");

    @Autowired
    LeagueWeeklyResultRepository leagueWeeklyResultRepository;
    @Autowired
    UserRepository userRepository;

    private LeagueWeeklyResult result(User user, LeagueWeeklyResultType resultType) {
        int previousTierLevel = 2;
        int newTierLevel = switch (resultType) {
            case PROMOTED -> previousTierLevel + 1;
            case STAY -> previousTierLevel;
            case RELEGATED -> previousTierLevel - 1;
        };
        return LeagueWeeklyResult.builder()
                .user(user)
                .weekStartAt(WEEK_START)
                .previousTierLevel(previousTierLevel)
                .newTierLevel(newTierLevel)
                .result(resultType)
                .focusSeconds(101_000)
                .build();
    }

    @Test
    @DisplayName("주간 결과 타입별 새 티어를 승격 +1·유지 0·강등 -1로 계산")
    void resultCalculatesNewTierLevelByType() {
        User user = User.builder().build();

        assertThat(result(user, LeagueWeeklyResultType.PROMOTED).getNewTierLevel()).isEqualTo(3);
        assertThat(result(user, LeagueWeeklyResultType.STAY).getNewTierLevel()).isEqualTo(2);
        assertThat(result(user, LeagueWeeklyResultType.RELEGATED).getNewTierLevel()).isEqualTo(1);
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
        assertThat(leagueWeeklyResultRepository.findResultPageAfter(
                WEEK_START,
                List.of(LeagueWeeklyResultType.PROMOTED, LeagueWeeklyResultType.RELEGATED),
                null,
                PageRequest.ofSize(200)))
                .containsExactly(saved);
    }

    @Test
    @DisplayName("id keyset 으로 결과를 페이지 단위로 끊어 조회하고 커서 이후만 반환한다")
    void findsResultPageAfterCursor() {
        List<LeagueWeeklyResultType> types = List.of(
                LeagueWeeklyResultType.PROMOTED,
                LeagueWeeklyResultType.STAY,
                LeagueWeeklyResultType.RELEGATED);
        leagueWeeklyResultRepository.saveAll(List.of(
                result(userRepository.save(User.builder().nickname("keyset-1").build()),
                        LeagueWeeklyResultType.STAY),
                result(userRepository.save(User.builder().nickname("keyset-2").build()),
                        LeagueWeeklyResultType.PROMOTED),
                result(userRepository.save(User.builder().nickname("keyset-3").build()),
                        LeagueWeeklyResultType.RELEGATED)));
        leagueWeeklyResultRepository.flush();

        List<LeagueWeeklyResult> firstPage = leagueWeeklyResultRepository.findResultPageAfter(
                WEEK_START, types, null, PageRequest.ofSize(2));
        assertThat(firstPage).hasSize(2);

        UUID cursor = firstPage.get(1).getId();
        List<LeagueWeeklyResult> secondPage = leagueWeeklyResultRepository.findResultPageAfter(
                WEEK_START, types, cursor, PageRequest.ofSize(2));
        assertThat(secondPage).hasSize(1);
        assertThat(secondPage.get(0).getId()).isGreaterThan(cursor);
        assertThat(firstPage).doesNotContain(secondPage.get(0));
    }

    @Test
    @DisplayName("ack - 해당 주차 미확인 행에 acknowledgedAt 세팅(1행 반환)")
    void acknowledgeSetsTimestampOnUnacknowledgedRow() {
        User user = userRepository.save(User.builder().nickname("ack-user").build());
        LeagueWeeklyResult saved = leagueWeeklyResultRepository.saveAndFlush(
                result(user, LeagueWeeklyResultType.PROMOTED));

        int updated = leagueWeeklyResultRepository.acknowledge(user.getId(), WEEK_START, ACK_AT);

        assertThat(updated).isEqualTo(1);
        assertThat(leagueWeeklyResultRepository.findById(saved.getId()))
                .get()
                .extracting(LeagueWeeklyResult::getAcknowledgedAt)
                .isEqualTo(ACK_AT);
    }

    @Test
    @DisplayName("ack - 이미 확인된 행 재호출 시 0행·기존 시각 불변(멱등·선점)")
    void acknowledgeIsIdempotentFirstWins() {
        User user = userRepository.save(User.builder().nickname("ack-idem-user").build());
        LeagueWeeklyResult saved = leagueWeeklyResultRepository.saveAndFlush(
                result(user, LeagueWeeklyResultType.STAY));

        assertThat(leagueWeeklyResultRepository.acknowledge(user.getId(), WEEK_START, ACK_AT)).isEqualTo(1);
        assertThat(leagueWeeklyResultRepository.acknowledge(user.getId(), WEEK_START, LATER_ACK_AT)).isZero();

        assertThat(leagueWeeklyResultRepository.findById(saved.getId()))
                .get()
                .extracting(LeagueWeeklyResult::getAcknowledgedAt)
                .isEqualTo(ACK_AT);
    }

    @Test
    @DisplayName("ack - 다른 주차를 지정하면 그 주차 행이 없어 0행(유저가 못 본 결과를 삼키지 않음)")
    void acknowledgeOnlyTargetsGivenWeek() {
        User user = userRepository.save(User.builder().nickname("ack-week-user").build());
        LeagueWeeklyResult saved = leagueWeeklyResultRepository.saveAndFlush(
                result(user, LeagueWeeklyResultType.PROMOTED));

        int updated = leagueWeeklyResultRepository.acknowledge(user.getId(), OTHER_WEEK_START, ACK_AT);

        assertThat(updated).isZero();
        assertThat(leagueWeeklyResultRepository.findById(saved.getId()))
                .get()
                .extracting(LeagueWeeklyResult::getAcknowledgedAt)
                .isNull();
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
