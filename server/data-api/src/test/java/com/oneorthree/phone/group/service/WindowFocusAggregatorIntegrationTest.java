package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.FocusSessionStatus;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * FOCUS 창 클리핑 집계의 실 SQL 검증 (Testcontainers PostgreSQL).
 *
 * <p>창 경계 클리핑(LEAST/GREATEST)·상태 필터(CANCELED/AUTO_CLOSED/ACTIVE 제외)·심야 창의
 * KST 날짜 앵커 조합을 실제 focus_sessions 행으로 확인한다. 관용치 판정(isAchieved)은 순수 함수라
 * 여기서 경계값만 함께 고정한다.
 *
 * <p>시각 표기: 창 Instant 는 Asia/Seoul 벽시계 시각(time-of-day)만 의미가 있고(GROMO-1100), 날짜 D 의
 * 실제 창은 D(KST)에 그 시각을 얹는다. 예) 09:00~12:00 창의 2026-08-01 실제 경계는 KST 09:00 =
 * {@code 2026-08-01T00:00Z}.
 */
class WindowFocusAggregatorIntegrationTest extends RepositoryTestBase {

    @Autowired
    WindowFocusAggregator windowFocusAggregator;
    @Autowired
    FocusSessionRepository focusSessionRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeWindowRepository groupChallengeWindowRepository;

    private static final LocalDate DATE = LocalDate.of(2026, 8, 1);

    private User saveUser(String nickname) {
        return userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
    }

    /** 창 상세 저장 — KST 벽시계 time 그대로 저장한다(V35, 시작 < 종료 불변식). */
    private GroupChallengeWindow saveWindow(String startTime, String endTime, Integer goalMinutes) {
        Group group = groupRepository.save(Group.builder().name("창검증").maxMembers(10).build());
        GroupChallenge challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).type(MissionType.TIME_WINDOW).category(MissionCategory.FOCUS)
                .status(GroupChallengeStatus.ACTIVE).build());
        return groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(challenge)
                .windowStart(LocalTime.parse(startTime))
                .windowEnd(LocalTime.parse(endTime))
                .durationMinutes(goalMinutes)
                .build());
    }

    private void saveSession(User user, String startedAt, String endedAt, FocusSessionStatus status) {
        saveSession(user, startedAt, endedAt, null, status, 0);
    }

    /** statEndAt=null 이면 레거시 행(마이그레이션 이전) — 집계가 endedAt 으로 폴백해야 한다. */
    private void saveSession(User user, String startedAt, String endedAt, String statEndAt,
                             FocusSessionStatus status) {
        saveSession(user, startedAt, endedAt, statEndAt, status, 0);
    }

    /** 방해(일시정지) 초가 있는 세션 — GROMO-1214 코드리뷰 ⑥ 차감 검증용. */
    private void saveSession(User user, String startedAt, String endedAt, FocusSessionStatus status,
            int totalDistractionSeconds) {
        saveSession(user, startedAt, endedAt, null, status, totalDistractionSeconds);
    }

    private void saveSession(User user, String startedAt, String endedAt, String statEndAt,
                             FocusSessionStatus status, int totalDistractionSeconds) {
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse(startedAt))
                .endedAt(endedAt != null ? Instant.parse(endedAt) : null)
                .statEndAt(statEndAt != null ? Instant.parse(statEndAt) : null)
                .status(status)
                .totalDistractionSeconds(totalDistractionSeconds)
                .build());
        focusSessionRepository.flush();
    }

    @Test
    @DisplayName("창 경계 클리핑 — 걸친 세션은 겹친 구간만, 완전 포함 세션은 전체가 계수된다")
    void clipsSessionsToWindowBounds() {
        // given: 09:00~12:00 창. 2026-08-01(KST) 의 실제 경계는 [00:00Z, 03:00Z).
        GroupChallengeWindow window = saveWindow("09:00:00", "12:00:00", 120);
        User straddler = saveUser("경계걸침");
        User inside = saveUser("완전포함");
        User outside = saveUser("창밖");
        // 시작 걸침 08:30~09:30 KST → 30분 + 종료 걸침 11:50~12:30 KST → 10분 = 40분
        saveSession(straddler, "2026-07-31T23:30:00Z", "2026-08-01T00:30:00Z", FocusSessionStatus.COMPLETED);
        saveSession(straddler, "2026-08-01T02:50:00Z", "2026-08-01T03:30:00Z", FocusSessionStatus.COMPLETED);
        // 완전 포함 09:30~10:30 KST → 60분
        saveSession(inside, "2026-08-01T00:30:00Z", "2026-08-01T01:30:00Z", FocusSessionStatus.COMPLETED);
        // 창 밖 13:00~14:00 KST → 0분 (키 자체가 없다)
        saveSession(outside, "2026-08-01T04:00:00Z", "2026-08-01T05:00:00Z", FocusSessionStatus.COMPLETED);

        // when
        Map<UUID, Integer> minutes = windowFocusAggregator.focusMinutesWithin(
                List.of(straddler.getId(), inside.getId(), outside.getId()), DATE, window);

        // then
        assertThat(minutes)
                .containsEntry(straddler.getId(), 40)
                .containsEntry(inside.getId(), 60)
                .doesNotContainKey(outside.getId());
    }

    @Test
    @DisplayName("CANCELED·AUTO_CLOSED·ACTIVE(미종료) 세션은 창 집계에서 제외된다")
    void excludesNonCountableSessions() {
        // given: 09:00~12:00 창 안에 통째로 들어가는 세션들 — 상태만 다르다
        GroupChallengeWindow window = saveWindow("09:00:00", "12:00:00", 120);
        User user = saveUser("상태필터");
        saveSession(user, "2026-08-01T00:10:00Z", "2026-08-01T00:40:00Z", FocusSessionStatus.CANCELED);
        saveSession(user, "2026-08-01T01:00:00Z", "2026-08-01T01:30:00Z", FocusSessionStatus.AUTO_CLOSED);
        saveSession(user, "2026-08-01T02:00:00Z", null, FocusSessionStatus.ACTIVE);
        // 유일한 정상 완료 20분 — 레거시 완료(endedAt 채워진 ACTIVE)도 포함되는 NOT IN 관례 확인용
        saveSession(user, "2026-08-01T02:20:00Z", "2026-08-01T02:40:00Z", FocusSessionStatus.ACTIVE);

        // when
        Map<UUID, Integer> minutes = windowFocusAggregator.focusMinutesWithin(List.of(user.getId()), DATE, window);

        // then: CANCELED 30분·AUTO_CLOSED 30분·미종료는 빠지고, 레거시 완료 20분만 남는다
        assertThat(minutes).containsEntry(user.getId(), 20);
    }

    @Test
    @DisplayName("심야 창(22:00~23:59) — 날짜 D 의 창은 D 안에서 닫히고, 자정 이후 세션은 계수되지 않는다")
    void anchorsLateNightWindowWithinSameDate() {
        // given: 자정 걸침 금지(§A6-1) 아래의 심야 창. 2026-08-01(KST) 의 실제 경계는 [13:00Z, 14:59Z).
        GroupChallengeWindow window = saveWindow("22:00:00", "23:59:00", 60);
        User user = saveUser("심야창");
        // 22:30~23:30 KST → 60분 전체가 날짜 D 의 창에 계수된다
        saveSession(user, "2026-08-01T13:30:00Z", "2026-08-01T14:30:00Z", FocusSessionStatus.COMPLETED);
        // 이튿날 00:00~00:30 KST → 창 종료(23:59) 이후라 0분 — D+1 로 넘어가는 꼬리가 없다
        saveSession(user, "2026-08-01T15:00:00Z", "2026-08-01T15:30:00Z", FocusSessionStatus.COMPLETED);

        // when
        Map<UUID, Integer> minutes = windowFocusAggregator.focusMinutesWithin(List.of(user.getId()), DATE, window);

        // then
        assertThat(minutes).containsEntry(user.getId(), 60);
    }

    @Test
    @DisplayName("GROMO-1100 회귀 — +09:00 오프셋 창의 집계 앵커가 KST 벽시계 시각 그대로다 (9시간 어긋남 없음)")
    void anchorsPlusNineOffsetWindowAtKstWallClock() {
        // given: 앱이 보내는 형식 그대로 09:00~12:00 KST 창 (+09:00 오프셋 → 저장 Instant 는 00:00Z~03:00Z)
        GroupChallengeWindow window = saveWindow("09:00:00", "12:00:00", 120);

        // then: 2026-08-01 의 실제 경계 = KST 09:00~12:00 (종전 버그면 KST 18:00~21:00 = 9시간 밀림)
        assertThat(windowFocusAggregator.windowStartOn(DATE, window))
                .isEqualTo(Instant.parse("2026-08-01T09:00:00+09:00"));
        assertThat(windowFocusAggregator.windowEndOn(DATE, window))
                .isEqualTo(Instant.parse("2026-08-01T12:00:00+09:00"));
    }

    @Test
    @DisplayName("GROMO-1406 — 심야 창(22:00~23:59)의 종료 앵커도 항상 회차일 D 다 (D+1 분기 제거)")
    void anchorsLateNightWindowEndOnSameDate() {
        // given: 자정 앞에서 끊는 심야 창 — 걸침(시작 > 종료)은 §A6-1 로 생성 자체가 불가하다
        GroupChallengeWindow window = saveWindow("22:00:00", "23:59:00", 60);

        // then: 시작·종료 모두 D(2026-08-01) 안 — 시간 모델 어디에도 D+1 이 없다
        assertThat(windowFocusAggregator.windowStartOn(DATE, window))
                .isEqualTo(Instant.parse("2026-08-01T22:00:00+09:00"));
        assertThat(windowFocusAggregator.windowEndOn(DATE, window))
                .isEqualTo(Instant.parse("2026-08-01T23:59:00+09:00"));
    }

    /**
     * 1214-⑥: 창 집계도 방해 초를 뺀 순수 집중 시간을 센다.
     *
     * <p>⑤에서 {@code daily_focus_stats.total_focus_seconds} 가 방해 초를 뺀 값이 되면서, 원시 겹침
     * 길이를 쓰던 이 창 집계는 일시정지가 낀 세션에서 일별 총합보다 커졌다.
     * ⚠️ 이 값이 챌린지 달성 판정 → 내기 정산을 가른다 — 일시정지 시간으로 창을 통과하던 게 잘못이었다.
     */
    @Test
    @DisplayName("1214-⑥: 창 안 세션의 방해 초가 차감된다 — 60분 세션 + 방해 15분 → 45분")
    void subtractsDistractionFromWindowOverlap() {
        GroupChallengeWindow window = saveWindow("09:00:00", "12:00:00", 120);
        User paused = saveUser("일시정지");
        User clean = saveUser("정지없음");
        // 둘 다 09:30~10:30 KST(60분) 완전 포함 — 방해 초만 다르다
        saveSession(paused, "2026-08-01T00:30:00Z", "2026-08-01T01:30:00Z", FocusSessionStatus.COMPLETED, 900);
        saveSession(clean, "2026-08-01T00:30:00Z", "2026-08-01T01:30:00Z", FocusSessionStatus.COMPLETED, 0);

        Map<UUID, Integer> minutes = windowFocusAggregator.focusMinutesWithin(
                List.of(paused.getId(), clean.getId()), DATE, window);

        assertThat(minutes)
                .containsEntry(paused.getId(), 45)
                // 방해 0 이면 종전과 완전히 동일 — 회귀 방지
                .containsEntry(clean.getId(), 60);
    }

    @Test
    @DisplayName("1214-⑥: 창에 절반만 걸친 세션 → 방해 초도 겹침에 비례해서만 깎인다(정수 절삭 없음)")
    void proratesDistractionToWindowOverlap() {
        GroupChallengeWindow window = saveWindow("09:00:00", "12:00:00", 120);
        User user = saveUser("경계걸침방해");
        // 08:30~09:30 KST = 60분 세션 중 창 겹침은 30분. 방해 12분(20%) → 30 × 0.8 = 24분.
        // 비율은 클리핑 전 세션 전체 길이 기준(방해 초에 타임스탬프가 없어 고르게 퍼졌다고 본다).
        saveSession(user, "2026-07-31T23:30:00Z", "2026-08-01T00:30:00Z", FocusSessionStatus.COMPLETED, 720);

        Map<UUID, Integer> minutes = windowFocusAggregator.focusMinutesWithin(List.of(user.getId()), DATE, window);

        assertThat(minutes).containsEntry(user.getId(), 24);
    }

    @Test
    @DisplayName("1214-⑥: 방해 초가 세션 길이보다 커도 음수가 아니라 0")
    void distractionNeverPushesWindowOverlapNegative() {
        GroupChallengeWindow window = saveWindow("09:00:00", "12:00:00", 120);
        User user = saveUser("과잉방해");
        // 60분 세션에 방해 90분(있을 수 없는 조합이지만 하한 0 을 잠근다)
        saveSession(user, "2026-08-01T00:30:00Z", "2026-08-01T01:30:00Z", FocusSessionStatus.COMPLETED, 5400);

        Map<UUID, Integer> minutes = windowFocusAggregator.focusMinutesWithin(List.of(user.getId()), DATE, window);

        assertThat(minutes).containsEntry(user.getId(), 0);
    }

    /**
     * GROMO-1252 6차 ① — 돈 경로 회귀. 미래 endedAt 으로 위조한 세션의 '아직 경과하지 않은 꼬리'가
     * 창 집계(→ 내기 정산·챌린지 달성)에 계상되면 안 된다. 완료 시점에 고정한 stat_end_at 까지만 센다.
     */
    @Test
    @DisplayName("미래 endedAt 위조 세션 — 창 집계는 stat_end_at 까지만 계수한다(미경과 꼬리 배제)")
    void clipsForgedFutureEndAtStatEndAt() {
        // given: 09:00~12:00 창(2026-08-01 KST → [00:00Z, 03:00Z)).
        GroupChallengeWindow window = saveWindow("09:00:00", "12:00:00", 120);
        User forger = saveUser("미래종료위조");
        User legacy = saveUser("레거시폴백");
        // 09:00 시작, endedAt 은 창을 통째로 덮는 12:00(=03:00Z)로 위조 — 실제 완료는 09:30(=00:30Z).
        saveSession(forger, "2026-08-01T00:00:00Z", "2026-08-01T03:00:00Z", "2026-08-01T00:30:00Z",
                FocusSessionStatus.COMPLETED);
        // 같은 구간이지만 stat_end_at 이 없는 레거시 행 — 종전대로 endedAt(=창 끝)까지 180분.
        saveSession(legacy, "2026-08-01T00:00:00Z", "2026-08-01T03:00:00Z", FocusSessionStatus.COMPLETED);

        // when
        Map<UUID, Integer> minutes = windowFocusAggregator.focusMinutesWithin(
                List.of(forger.getId(), legacy.getId()), DATE, window);

        // then: 위조 세션은 실제 경과한 30분만(종전엔 180분 = 달성 판정·정산 오염), 레거시는 폴백해 180분
        assertThat(minutes)
                .containsEntry(forger.getId(), 30)
                .containsEntry(legacy.getId(), 180);
    }

    @Test
    @DisplayName("stat_end_at 이 창 시작 이전이면 세션 자체가 제외된다(음수 겹침 없음)")
    void excludesSessionWhoseStatEndPrecedesWindow() {
        // given: 09:00~12:00 창. 08:00 시작·08:30 실제 완료인데 endedAt 만 13:00 으로 위조된 세션.
        GroupChallengeWindow window = saveWindow("09:00:00", "12:00:00", 120);
        User user = saveUser("창전종료");
        saveSession(user, "2026-07-31T23:00:00Z", "2026-08-01T04:00:00Z", "2026-07-31T23:30:00Z",
                FocusSessionStatus.COMPLETED);
        // 같은 유저의 정상 세션 10:00~10:20 KST = 20분 — 음수 겹침이 여기서 차감되면 20분이 깨진다.
        saveSession(user, "2026-08-01T01:00:00Z", "2026-08-01T01:20:00Z", "2026-08-01T01:20:00Z",
                FocusSessionStatus.COMPLETED);

        // when
        Map<UUID, Integer> minutes = windowFocusAggregator.focusMinutesWithin(List.of(user.getId()), DATE, window);

        // then
        assertThat(minutes).containsEntry(user.getId(), 20);
    }

    @Test
    @DisplayName("미래 started_at 세션 — 음수 겹침이 같은 유저의 다른 세션 합을 깎지 않는다")
    void clampsNegativeOverlapToZero() {
        // given: 09:00~12:00 창. started_at 이 11:00 인데 stat_end_at 은 서버 now 클램프로 10:00 인 세션
        // (started_at > ended_at 은 400 으로 막히지만 '미래 started_at' 은 통과한다 → 겹침이 음수).
        GroupChallengeWindow window = saveWindow("09:00:00", "12:00:00", 120);
        User user = saveUser("미래시작");
        saveSession(user, "2026-08-01T02:00:00Z", "2026-08-01T05:00:00Z", "2026-08-01T01:00:00Z",
                FocusSessionStatus.COMPLETED);
        // 정상 세션 09:10~09:40 KST = 30분
        saveSession(user, "2026-08-01T00:10:00Z", "2026-08-01T00:40:00Z", "2026-08-01T00:40:00Z",
                FocusSessionStatus.COMPLETED);

        // when
        Map<UUID, Integer> minutes = windowFocusAggregator.focusMinutesWithin(List.of(user.getId()), DATE, window);

        // then: 음수(-60분) 없이 정상 세션 30분만
        assertThat(minutes).containsEntry(user.getId(), 30);
    }

    @Test
    @DisplayName("달성 관용치 경계 — 목표−5 는 달성, 목표−6 은 미달성")
    void toleranceBoundary() {
        assertThat(WindowFocusAggregator.isAchieved(115, 120)).isTrue();
        assertThat(WindowFocusAggregator.isAchieved(114, 120)).isFalse();
        assertThat(WindowFocusAggregator.WINDOW_FOCUS_TOLERANCE_MINUTES).isEqualTo(5);
    }
}
