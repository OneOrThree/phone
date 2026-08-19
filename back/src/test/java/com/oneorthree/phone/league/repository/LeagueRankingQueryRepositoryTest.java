package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.focus.domain.DefaultTag;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.UserFocusTag;
import com.oneorthree.phone.focus.repository.DefaultTagRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.UserFocusTagRepository;
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

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class LeagueRankingQueryRepositoryTest extends RepositoryTestBase {

    private static final LocalDate MONDAY = LocalDate.of(2026, 7, 13);
    private static final LocalDate TUESDAY = LocalDate.of(2026, 7, 14);
    // 라이브 경과 산정 기준 시각 — TUESDAY 12:00 KST. 진행 중 세션 픽스처는 이 시각에서 역산한다.
    private static final Instant NOW = TUESDAY.atTime(12, 0).atZone(ZonePolicy.KST).toInstant();
    // 주 경계 클램프가 실제로 걸리는 유일한 구간 — 월요일 오전. 라이브 창이 12시간이라 주 시작
    // 이전에 시작한 세션이 아직 살아 있으려면 지금이 월요일 00~12시(KST)여야 한다.
    private static final Instant MONDAY_MORNING = MONDAY.atTime(3, 0).atZone(ZonePolicy.KST).toInstant();
    private static final Instant WEEK_START = MONDAY.atStartOfDay(ZonePolicy.KST).toInstant();

    @Autowired
    LeagueRankingQueryRepository leagueRankingQueryRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    DailyFocusStatRepository dailyFocusStatRepository;
    @Autowired
    FocusSessionRepository focusSessionRepository;
    @Autowired
    DefaultTagRepository defaultTagRepository;
    @Autowired
    UserFocusTagRepository userFocusTagRepository;

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

        List<LeagueRankingRow> result = leagueRankingQueryRepository.findTop(MONDAY, TUESDAY, null, 100, NOW);

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
                MONDAY, TUESDAY, Occupation.CODING, 100, NOW);

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
        List<LeagueRankingRow> expected = leagueRankingQueryRepository.findTop(MONDAY, TUESDAY, null, 10, NOW);

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
        List<LeagueRankingRow> ranking = leagueRankingQueryRepository.findTop(MONDAY, TUESDAY, null, 100, NOW);
        User target = ranking.get(2).userId().equals(firstTie.getId()) ? firstTie : secondTie;

        LeagueRankingPosition position = leagueRankingQueryRepository
                .findRankOf(target.getId(), MONDAY, TUESDAY, NOW)
                .orElseThrow();

        assertThat(position.rank()).isEqualTo(3);
        assertThat(position.totalFocusSeconds()).isEqualTo(120);
    }

    @Test
    @DisplayName("내 순위는 존재하지 않거나 탈퇴한 유저를 반환하지 않는다")
    void findRankOfExcludesMissingAndDeletedUser() {
        User deleted = saveUser("deletedTarget", Occupation.CODING, true);
        flushFixtures();

        assertThat(leagueRankingQueryRepository.findRankOf(deleted.getId(), MONDAY, TUESDAY, NOW)).isEmpty();
        assertThat(leagueRankingQueryRepository.findRankOf(UUID.randomUUID(), MONDAY, TUESDAY, NOW)).isEmpty();
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
    @DisplayName("리그 모수는 nickname 기준 — 닉네임 있는 게스트는 편입, 온보딩 미완주(null·공백)는 제외")
    void includesGuestWithNicknameAndExcludesUsersWithoutNickname() {
        // 게스트라도 온보딩을 완주해 닉네임을 등록했으면 리그 모수다 (GROMO-1508).
        User guestWithNickname = userRepository.save(User.builder()
                .nickname("닉네임게스트")
                .occupation(Occupation.CODING)
                .tierLevel(3)
                .isGuest(true)
                .build());
        // 소셜 로그인 후 온보딩을 이탈한 유령 유저 — 이름 없는 랭킹 행·0초 STAY 정산의 원인이었다.
        User onboardingDropout = userRepository.save(User.builder()
                .occupation(Occupation.CODING)
                .tierLevel(3)
                .build());
        // GROMO-1215 이전 PATCH 경로가 저장한 공백-only 레거시 행 — NULL 이 아니라 술어를 통과하면
        // 같은 이름 없는 행이 그대로 남는다 (코드리뷰 반영).
        User blankNicknameLegacy = userRepository.save(User.builder()
                .nickname("   ")
                .occupation(Occupation.CODING)
                .tierLevel(3)
                .build());
        // 유니코드 공백-only — Java isBlank() 는 걸러도 btrim 은 통과시키던 값. 두 판정이 어긋나면
        // 티어는 미배정인데 랭킹엔 뜨는 상태가 된다 (코드리뷰 반영).
        User unicodeBlankLegacy = userRepository.save(User.builder()
                .nickname("\u2003\u2003")
                .occupation(Occupation.CODING)
                .tierLevel(3)
                .build());
        saveStat(guestWithNickname, MONDAY, 50);
        saveStat(onboardingDropout, MONDAY, 9999);
        saveStat(blankNicknameLegacy, MONDAY, 8888);
        saveStat(unicodeBlankLegacy, MONDAY, 7777);
        flushFixtures();

        assertThat(leagueRankingQueryRepository.findTop(MONDAY, TUESDAY, null, 100, NOW))
                .extracting(LeagueRankingRow::userId)
                .containsExactly(guestWithNickname.getId());
        assertThat(leagueRankingQueryRepository.findWeeklyTotalsForSettlement(MONDAY, TUESDAY, null, 100))
                .extracting(LeagueRankingRow::userId)
                .containsExactly(guestWithNickname.getId());
        assertThat(leagueRankingQueryRepository.findRankOf(guestWithNickname.getId(), MONDAY, TUESDAY, NOW))
                .isPresent();
        assertThat(leagueRankingQueryRepository.findRankOf(onboardingDropout.getId(), MONDAY, TUESDAY, NOW))
                .isEmpty();
        assertThat(leagueRankingQueryRepository.findRankOf(blankNicknameLegacy.getId(), MONDAY, TUESDAY, NOW))
                .isEmpty();
        assertThat(leagueRankingQueryRepository.findRankOf(unicodeBlankLegacy.getId(), MONDAY, TUESDAY, NOW))
                .isEmpty();
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

        LeagueRankingRow row = leagueRankingQueryRepository.findTop(MONDAY, TUESDAY, null, 10, NOW).get(0);

        assertThat(row.userId()).isEqualTo(overseas.getId());
        assertThat(row.totalFocusSeconds()).isZero();
    }

    @Test
    @DisplayName("진행 중 세션의 경과분이 정렬에 반영된다 — 확정 집계가 적어도 위로 올라간다")
    void findTopRanksLiveElapsedAboveConfirmedTotals() {
        User confirmed = saveUser("confirmed", Occupation.CODING, false);
        User live = saveUser("live", Occupation.CODING, false);
        saveStat(confirmed, MONDAY, 3_000);
        saveStat(confirmed, TUESDAY, 500);
        saveStat(live, MONDAY, 600);
        // 1시간째 진행 중 — 확정 600초 + 라이브 3,600초 = 4,200초로 confirmed(3,500초)를 앞선다.
        saveLiveSession(live, NOW.minus(Duration.ofHours(1)));
        flushFixtures();

        List<LeagueRankingRow> result = leagueRankingQueryRepository.findTop(MONDAY, TUESDAY, null, 100, NOW);

        assertThat(result).extracting(LeagueRankingRow::userId)
                .containsExactly(live.getId(), confirmed.getId());
        // 응답 값은 확정 집계 그대로 — 여기에 경과분이 실리면 앱(LiveFocusTime)이 같은 구간을 또 더한다.
        assertThat(result.get(0).totalFocusSeconds()).isEqualTo(600);
        // 당일초는 조회 창 마지막 날(:toDate = TUESDAY) 몫만 — 주간 합계와 같은 문장(같은 스냅샷)에서 분리 집계.
        assertThat(rowOf(result, confirmed).todayFocusSeconds()).isEqualTo(500);
        assertThat(rowOf(result, live).todayFocusSeconds()).isZero();
        assertThat(leagueRankingQueryRepository.findRankOf(live.getId(), MONDAY, TUESDAY, NOW).orElseThrow())
                .satisfies(position -> {
                    assertThat(position.rank()).isEqualTo(1);
                    assertThat(position.totalFocusSeconds()).isEqualTo(600);
                });
        assertThat(leagueRankingQueryRepository.findRankOf(confirmed.getId(), MONDAY, TUESDAY, NOW).orElseThrow()
                .rank()).isEqualTo(2);
    }

    @Test
    @DisplayName("정렬에 쓴 라이브 앵커·태그명을 함께 돌려준다 — 주 경계 세션은 주 시작으로 클램프된 값")
    void findTopReturnsClampedLiveAnchor() {
        User crossing = saveUser("crossing", Occupation.CODING, false);
        User idle = saveUser("idle", Occupation.CODING, false);
        // 일요일 23시 시작, 월요일 03시 현재까지 진행 중 — 실제 경과 4시간, 이번 주 몫은 3시간.
        FocusSession live = saveLiveSession(crossing, WEEK_START.minus(Duration.ofHours(1)));
        attachTag(live, crossing, "수학");
        flushFixtures();

        List<LeagueRankingRow> result = leagueRankingQueryRepository.findTop(
                MONDAY, MONDAY, null, 100, MONDAY_MORNING);

        // 앵커는 실제 시작 시각이 아니라 주 시작 — 클라가 base + (now − 앵커) 를 그리면 정렬 점수와 같아진다.
        // 앵커를 안 깎으면 화면엔 4시간이 뜨는데 정렬은 3시간이라 이번 수정이 없애려던 불일치가 남는다.
        LeagueRankingRow crossingRow = rowOf(result, crossing);
        assertThat(crossingRow.liveStartedAt()).isEqualTo(WEEK_START);
        // 태그도 같은 행에서 — 앵커와 다른 조회에서 태그를 읽으면 세션 전환 경합 시 조합이 어긋난다.
        assertThat(crossingRow.liveTagName()).isEqualTo("수학");
        LeagueRankingRow idleRow = rowOf(result, idle);
        assertThat(idleRow.liveStartedAt()).isNull();
        assertThat(idleRow.liveTagName()).isNull();
    }

    @Test
    @DisplayName("세션이 끝나면 라이브 가산이 사라지고 확정 집계 기준 순위로 정정된다")
    void findTopDropsLiveElapsedOnceSessionEnded() {
        User confirmed = saveUser("confirmed", Occupation.CODING, false);
        User ended = saveUser("ended", Occupation.CODING, false);
        saveStat(confirmed, MONDAY, 3_000);
        // 1시간 집중했지만 방해(일시정지)를 빼고 600초만 확정 집계에 귀속된 세션.
        // 종료(endedAt 채움) 순간 라이브 가산이 사라지므로 confirmed 아래로 정정돼야 한다.
        saveStat(ended, MONDAY, 600);
        saveEndedSession(ended, NOW.minus(Duration.ofHours(1)), NOW.minus(Duration.ofMinutes(1)));
        flushFixtures();

        assertThat(leagueRankingQueryRepository.findTop(MONDAY, TUESDAY, null, 100, NOW))
                .extracting(LeagueRankingRow::userId)
                .containsExactly(confirmed.getId(), ended.getId());
        assertThat(leagueRankingQueryRepository.findRankOf(ended.getId(), MONDAY, TUESDAY, NOW).orElseThrow()
                .rank()).isEqualTo(2);
    }

    @Test
    @DisplayName("12시간을 넘긴 미종료(orphan) 세션은 라이브로 세지 않는다")
    void findTopIgnoresOrphanSessionsBeyondLiveWindow() {
        User confirmed = saveUser("confirmed", Occupation.CODING, false);
        User orphan = saveUser("orphan", Occupation.CODING, false);
        saveStat(confirmed, MONDAY, 100);
        // 13시간째 미종료 — 스윕 전 버려진 세션. 통계에도 반영되지 않으므로(FocusService.sweepOrphanSessions)
        // 순위에 세면 하루의 절반을 1위로 점거한다.
        saveLiveSession(orphan, NOW.minus(Duration.ofHours(13)));
        flushFixtures();

        assertThat(leagueRankingQueryRepository.findTop(MONDAY, TUESDAY, null, 100, NOW))
                .extracting(LeagueRankingRow::userId)
                .containsExactly(confirmed.getId(), orphan.getId());
    }

    @Test
    @DisplayName("주 경계를 걸쳐 진행 중인 세션은 주 시작 이후 몫만 센다")
    void findTopClampsLiveElapsedToWeekStart() {
        User crossing = saveUser("crossing", Occupation.CODING, false);
        User rival = saveUser("rival", Occupation.CODING, false);
        // 일요일 23시 시작, 월요일 03시 현재 진행 중 — 이번 주 몫 3시간(10,800초).
        saveLiveSession(crossing, WEEK_START.minus(Duration.ofHours(1)));
        // 클램프가 없으면 crossing 의 라이브가 4시간(14,400초)이라 rival 을 앞선다.
        saveStat(rival, MONDAY, 12_000);
        flushFixtures();

        assertThat(leagueRankingQueryRepository.findTop(MONDAY, MONDAY, null, 100, MONDAY_MORNING))
                .extracting(LeagueRankingRow::userId)
                .containsExactly(rival.getId(), crossing.getId());
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

    private LeagueRankingRow rowOf(List<LeagueRankingRow> rows, User user) {
        return rows.stream().filter(row -> row.userId().equals(user.getId())).findFirst().orElseThrow();
    }

    /** 진행 중(미종료) 세션 픽스처 — endedAt 이 비어 있는 라이브 마커. */
    private FocusSession saveLiveSession(User user, Instant startedAt) {
        return focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(startedAt)
                .build());
    }

    /** 세션에 채택 태그(user_focus_tags → default_tags)를 붙인다 — 라이브 태그명 조인 검증용. */
    private void attachTag(FocusSession session, User user, String tagName) {
        DefaultTag defaultTag = defaultTagRepository.save(DefaultTag.builder().name(tagName).build());
        UserFocusTag tag = userFocusTagRepository.save(UserFocusTag.builder()
                .user(user)
                .defaultTag(defaultTag)
                .build());
        focusSessionRepository.save(FocusSession.builder()
                .id(session.getId())
                .user(user)
                .startedAt(session.getStartedAt())
                .focusTag(tag)
                .build());
    }

    /** 종료된 세션 픽스처 — 라이브에서 빠지고 확정 집계(DailyFocusStat)만 남는 상태. */
    private void saveEndedSession(User user, Instant startedAt, Instant endedAt) {
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(startedAt)
                .endedAt(endedAt)
                .build());
    }

    private void flushFixtures() {
        userRepository.flush();
        dailyFocusStatRepository.flush();
        focusSessionRepository.flush();
    }
}
