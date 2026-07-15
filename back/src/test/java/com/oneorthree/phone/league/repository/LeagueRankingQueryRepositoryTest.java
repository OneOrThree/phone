package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.league.domain.LeagueRankingPosition;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class LeagueRankingQueryRepositoryTest extends RepositoryTestBase {

    private static final LocalDate MONDAY = LocalDate.of(2026, 7, 13);
    private static final LocalDate TUESDAY = LocalDate.of(2026, 7, 14);

    @Autowired
    LeagueRankingQueryRepository leagueRankingQueryRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    DailyFocusStatRepository dailyFocusStatRepository;

    @Test
    @DisplayName("활성 유저 LEFT JOIN 집계는 0초 유저를 포함하고 total DESC/user.id ASC로 정렬한다")
    void findTopIncludesZeroAndUsesGlobalOrder() {
        User tiedA = saveUser("tiedA", Occupation.CODING, false);
        User tiedB = saveUser("tiedB", Occupation.UNIVERSITY, false);
        User zero = saveUser("zero", null, false);
        User deleted = saveUser("deleted", Occupation.CODING, true);
        saveStat(tiedA, MONDAY, 100);
        saveStat(tiedB, TUESDAY, 100);
        saveStat(tiedA, MONDAY.minusDays(1), 1000);
        saveStat(tiedB, TUESDAY.plusDays(1), 1000);
        saveStat(deleted, MONDAY, 9999);
        flushFixtures();

        List<LeagueRankingRow> result = leagueRankingQueryRepository.findTop(MONDAY, TUESDAY, null, 100);

        List<UUID> tiedIds = List.of(tiedA.getId(), tiedB.getId()).stream()
                // PostgreSQL uuid ASC는 16바이트 unsigned 순서이며 UUID.compareTo의 signed 순서와 다를 수 있다.
                .sorted(Comparator.comparing(UUID::toString))
                .toList();
        assertThat(result).hasSize(3);
        assertThat(result.subList(0, 2)).extracting(LeagueRankingRow::userId).containsExactlyElementsOf(tiedIds);
        assertThat(result.subList(0, 2)).extracting(LeagueRankingRow::totalFocusSeconds)
                .containsExactly(100, 100);
        assertThat(result.get(2).userId()).isEqualTo(zero.getId());
        assertThat(result.get(2).totalFocusSeconds()).isZero();
        assertThat(result).noneMatch(row -> row.userId().equals(deleted.getId()));
    }

    @Test
    @DisplayName("occupation 필터는 해당 직군 활성 유저만 모수로 삼아 0초 유저도 포함한다")
    void findTopFiltersOccupation() {
        User codingActive = saveUser("codingActive", Occupation.CODING, false);
        User codingZero = saveUser("codingZero", Occupation.CODING, false);
        User university = saveUser("university", Occupation.UNIVERSITY, false);
        saveStat(codingActive, MONDAY, 50);
        saveStat(university, MONDAY, 500);
        flushFixtures();

        List<LeagueRankingRow> result = leagueRankingQueryRepository.findTop(
                MONDAY, TUESDAY, Occupation.CODING, 100);

        assertThat(result).extracting(LeagueRankingRow::userId)
                .containsExactly(codingActive.getId(), codingZero.getId());
        assertThat(result).extracting(LeagueRankingRow::totalFocusSeconds).containsExactly(50, 0);
    }

    @Test
    @DisplayName("전역 순위 keyset 커서는 동점 user.id 경계에서도 중복·누락 없이 이어진다")
    void findGlobalRankingPageUsesScoreAndUserIdCursor() {
        User high = saveUser("high", Occupation.CODING, false);
        User tieA = saveUser("tieA", Occupation.CODING, false);
        User tieB = saveUser("tieB", Occupation.CODING, false);
        User zero = saveUser("zero", Occupation.CODING, false);
        saveStat(high, MONDAY, 300);
        saveStat(tieA, MONDAY, 100);
        saveStat(tieB, MONDAY, 100);
        flushFixtures();
        List<LeagueRankingRow> expected = leagueRankingQueryRepository.findTop(MONDAY, TUESDAY, null, 10);

        List<LeagueRankingRow> firstPage = leagueRankingQueryRepository.findGlobalRankingPage(
                MONDAY, TUESDAY, null, null, 2);
        LeagueRankingRow cursor = firstPage.get(1);
        List<LeagueRankingRow> secondPage = leagueRankingQueryRepository.findGlobalRankingPage(
                MONDAY, TUESDAY, cursor.totalFocusSeconds(), cursor.userId(), 2);

        assertThat(firstPage).containsExactlyElementsOf(expected.subList(0, 2));
        assertThat(secondPage).containsExactlyElementsOf(expected.subList(2, 4));
        assertThat(secondPage).extracting(LeagueRankingRow::userId).contains(zero.getId());
    }

    @Test
    @DisplayName("내 순위는 전역 total DESC/user.id ASC 정렬에서 앞선 유저 수 + 1이다")
    void findRankOfUsesSameGlobalOrder() {
        User higher = saveUser("higher", Occupation.UNIVERSITY, false);
        User firstTie = saveUser("firstTie", Occupation.CODING, false);
        User secondTie = saveUser("secondTie", Occupation.CODING, false);
        saveStat(higher, MONDAY, 300);
        saveStat(firstTie, MONDAY, 120);
        saveStat(secondTie, MONDAY, 120);
        flushFixtures();
        List<LeagueRankingRow> ranking = leagueRankingQueryRepository.findTop(MONDAY, TUESDAY, null, 100);
        User target = ranking.get(2).userId().equals(firstTie.getId()) ? firstTie : secondTie;

        LeagueRankingPosition position = leagueRankingQueryRepository
                .findRankOf(target.getId(), MONDAY, TUESDAY)
                .orElseThrow();

        assertThat(position.rank()).isEqualTo(3);
        assertThat(position.totalFocusSeconds()).isEqualTo(120);
    }

    @Test
    @DisplayName("내 순위는 존재하지 않거나 탈퇴한 유저를 반환하지 않는다")
    void findRankOfExcludesMissingAndDeletedUser() {
        User deleted = saveUser("deletedTarget", Occupation.CODING, true);
        flushFixtures();

        assertThat(leagueRankingQueryRepository.findRankOf(deleted.getId(), MONDAY, TUESDAY)).isEmpty();
        assertThat(leagueRankingQueryRepository.findRankOf(UUID.randomUUID(), MONDAY, TUESDAY)).isEmpty();
    }

    @Test
    @DisplayName("정산 집계는 user.id ASC 커서로 활성 유저를 중복·누락 없이 페이지 처리한다")
    void findWeeklyTotalsForSettlementUsesDeterministicCursor() {
        User first = saveUser("first", Occupation.CODING, false);
        User second = saveUser("second", Occupation.UNIVERSITY, false);
        User third = saveUser("third", null, false);
        User deleted = saveUser("deleted", null, true);
        saveStat(first, MONDAY, 10);
        saveStat(second, MONDAY, 20);
        saveStat(deleted, MONDAY, 999);
        flushFixtures();

        List<LeagueRankingRow> expected = List.of(first, second, third).stream()
                .sorted(Comparator.comparing(user -> user.getId().toString()))
                .map(user -> new LeagueRankingRow(user.getId(), user.getNickname(), user.getTierLevel(),
                        user.getId().equals(first.getId()) ? 10 : user.getId().equals(second.getId()) ? 20 : 0))
                .toList();
        List<LeagueRankingRow> firstPage = leagueRankingQueryRepository.findWeeklyTotalsForSettlement(
                MONDAY, TUESDAY, null, 2);
        List<LeagueRankingRow> secondPage = leagueRankingQueryRepository.findWeeklyTotalsForSettlement(
                MONDAY, TUESDAY, firstPage.get(1).userId(), 2);

        assertThat(firstPage).containsExactlyElementsOf(expected.subList(0, 2));
        assertThat(secondPage).containsExactlyElementsOf(expected.subList(2, 3));
    }

    @Test
    @DisplayName("게스트 유저는 랭킹·정산·내순위 집계에서 모두 제외된다")
    void excludesGuestUsers() {
        User active = saveUser("activeUser", Occupation.CODING, false);
        User guest = userRepository.save(User.builder()
                .occupation(Occupation.CODING)
                .tierLevel(3)
                .isGuest(true)
                .build());
        saveStat(active, MONDAY, 50);
        saveStat(guest, MONDAY, 9999);
        flushFixtures();

        assertThat(leagueRankingQueryRepository.findTop(MONDAY, TUESDAY, null, 100))
                .extracting(LeagueRankingRow::userId)
                .containsExactly(active.getId());
        assertThat(leagueRankingQueryRepository.findWeeklyTotalsForSettlement(MONDAY, TUESDAY, null, 100))
                .extracting(LeagueRankingRow::userId)
                .containsExactly(active.getId());
        assertThat(leagueRankingQueryRepository.findRankOf(guest.getId(), MONDAY, TUESDAY)).isEmpty();
    }

    @Test
    @DisplayName("MVP 제한: country 로컬 DailyFocusStat 날짜는 KST 리그 창과 최대 1일 어긋날 수 있다")
    void countryLocalBucketCanDifferFromKstLeagueDateByOneDay() {
        User overseas = saveUser("overseas", Occupation.CODING, false);
        overseas.setCountryCode("US");
        // 같은 Instant가 KST 월요일이어도 해외 유저의 country 로컬 버킷은 일요일일 수 있다.
        // GROMO-803 이후 저장된 버킷을 재해석하지 않는 MVP 계약이므로 KST 월요일 창에서는 0초로 집계한다.
        saveStat(overseas, MONDAY.minusDays(1), 300);
        flushFixtures();

        LeagueRankingRow row = leagueRankingQueryRepository.findTop(MONDAY, TUESDAY, null, 10).get(0);

        assertThat(row.userId()).isEqualTo(overseas.getId());
        assertThat(row.totalFocusSeconds()).isZero();
    }

    private User saveUser(String nickname, Occupation occupation, boolean deleted) {
        return userRepository.save(User.builder()
                .nickname(nickname)
                .occupation(occupation)
                .tierLevel(3)
                .isDeleted(deleted)
                .build());
    }

    private void saveStat(User user, LocalDate date, int seconds) {
        dailyFocusStatRepository.save(DailyFocusStat.builder()
                .user(user)
                .date(date)
                .totalFocusSeconds(seconds)
                .build());
    }

    private void flushFixtures() {
        userRepository.flush();
        dailyFocusStatRepository.flush();
    }
}
