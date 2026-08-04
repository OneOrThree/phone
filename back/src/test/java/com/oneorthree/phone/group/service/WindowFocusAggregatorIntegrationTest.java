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
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * FOCUS 창 클리핑 집계의 실 SQL 검증 (Testcontainers PostgreSQL).
 *
 * <p>창 경계 클리핑(LEAST/GREATEST)·상태 필터(CANCELED/AUTO_CLOSED/ACTIVE 제외)·자정 걸침 창의
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

    /** 창 상세 저장 — 앱 송신 형식 그대로 {@code +09:00} 오프셋 Instant 로 저장한다(KST 벽시계 시각 = 창 시각). */
    private GroupChallengeWindow saveWindow(String startTime, String endTime, Integer goalMinutes) {
        Group group = groupRepository.save(Group.builder().name("창검증").maxMembers(10).build());
        GroupChallenge challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).type(MissionType.TIME_WINDOW).category(MissionCategory.FOCUS)
                .status(GroupChallengeStatus.ACTIVE).build());
        return groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(challenge)
                .windowStartAt(Instant.parse("2026-01-01T" + startTime + "+09:00"))
                .windowEndAt(Instant.parse("2026-01-01T" + endTime + "+09:00"))
                .durationMinutes(goalMinutes)
                .build());
    }

    private void saveSession(User user, String startedAt, String endedAt, FocusSessionStatus status) {
        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .startedAt(Instant.parse(startedAt))
                .endedAt(endedAt != null ? Instant.parse(endedAt) : null)
                .status(status)
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
    @DisplayName("자정 걸침 창(22:00~01:00) — 날짜 D 의 창은 D 22:00 ~ D+1 01:00 로 앵커된다")
    void anchorsMidnightCrossingWindowAcrossDates() {
        // given: 22:00~01:00 창. 2026-08-01(KST) 의 실제 경계는 [13:00Z, 16:00Z).
        GroupChallengeWindow window = saveWindow("22:00:00", "01:00:00", 120);
        User user = saveUser("자정걸침");
        // 23:30 KST ~ 이튿날 00:30 KST → 자정을 넘겨도 60분 전체가 같은 날짜 D 의 창에 계수된다
        saveSession(user, "2026-08-01T14:30:00Z", "2026-08-01T15:30:00Z", FocusSessionStatus.COMPLETED);
        // 창 시작 전 21:00~21:30 KST → 0분
        saveSession(user, "2026-08-01T12:00:00Z", "2026-08-01T12:30:00Z", FocusSessionStatus.COMPLETED);

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
    @DisplayName("GROMO-1100 회귀 — 자정 걸침 창(22:00~02:00 KST)의 앵커는 D 22:00 ~ D+1 02:00 (KST)")
    void anchorsMidnightCrossingWindowAtKstWallClock() {
        // given: 22:00~02:00 KST 창 — 시작 > 종료라 자정 걸침으로 해석돼야 한다
        GroupChallengeWindow window = saveWindow("22:00:00", "02:00:00", 120);

        // then: D 의 시작 22:00 KST, 종료는 D+1 의 02:00 KST
        assertThat(windowFocusAggregator.windowStartOn(DATE, window))
                .isEqualTo(Instant.parse("2026-08-01T22:00:00+09:00"));
        assertThat(windowFocusAggregator.windowEndOn(DATE, window))
                .isEqualTo(Instant.parse("2026-08-02T02:00:00+09:00"));
    }

    @Test
    @DisplayName("달성 관용치 경계 — 목표−5 는 달성, 목표−6 은 미달성")
    void toleranceBoundary() {
        assertThat(WindowFocusAggregator.isAchieved(115, 120)).isTrue();
        assertThat(WindowFocusAggregator.isAchieved(114, 120)).isFalse();
        assertThat(WindowFocusAggregator.WINDOW_FOCUS_TOLERANCE_MINUTES).isEqualTo(5);
    }
}
