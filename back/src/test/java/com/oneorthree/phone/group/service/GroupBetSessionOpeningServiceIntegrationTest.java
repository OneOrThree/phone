package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.scheduler.GroupBetScheduler;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 회차 자동 개설 회귀(N35 — GROMO-1411 배치) — {@code ensureSession} 단일 진입점의 게이트를
 * 실 DB 로 고정한다: 스냅샷 박제 개설 · 멱등(UPSERT) · 참가 마감 지난 창형 스킵 · 내기 미설정/
 * 비활성 챌린지 스킵. 활성 요일(repeat_days) 게이트는 B1 스택 합류 시 배선된다(이 브랜치 base
 * 에는 반복 요일 스키마가 없어 매일 활성).
 */
class GroupBetSessionOpeningServiceIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupBetSessionOpeningService groupBetSessionOpeningService;
    @Autowired
    GroupBetScheduler groupBetScheduler;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeDurationRepository groupChallengeDurationRepository;
    @Autowired
    GroupChallengeWindowRepository groupChallengeWindowRepository;
    @Autowired
    GroupChallengeBetRepository groupChallengeBetRepository;
    @Autowired
    GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int GOAL_MINUTES = 120;
    private static final int STAKE = 300;

    private Group group;

    private final List<GroupChallengeBet> configs = new ArrayList<>();
    private final List<GroupChallenge> challenges = new ArrayList<>();
    private final List<GroupChallengeBetSession> betSessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
    }

    @AfterEach
    void tearDown() {
        groupChallengeBetSessionRepository.deleteAll(betSessions);
        groupChallengeBetRepository.deleteAll(configs);
        challenges.forEach(c -> {
            groupChallengeDurationRepository.findById(c.getId())
                    .ifPresent(groupChallengeDurationRepository::delete);
            groupChallengeWindowRepository.findById(c.getId())
                    .ifPresent(groupChallengeWindowRepository::delete);
        });
        groupChallengeRepository.deleteAll(challenges);
        groupRepository.delete(group);

        configs.clear();
        challenges.clear();
        betSessions.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    private GroupChallenge durationChallenge() {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.FOCUS).type(MissionType.DURATION).build());
        challenges.add(saved);
        // category 는 V36 이후 NOT NULL — 복합 FK 가 부모 챌린지 카테고리와의 일치를 강제한다.
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(saved).category(MissionCategory.FOCUS).durationMinutes(GOAL_MINUTES).build());
        return saved;
    }

    /**
     * 창 시작 시각을 제어하는 창형 챌린지 — 참가 마감(= 창 시작) 게이트 검증용.
     *
     * <p>V35(GROMO-1406) 이후 창 시각은 KST 벽시계 {@code LocalTime} 이고 <b>{@code windowStart <
     * windowEnd} 를 DB CHECK 가 강제</b>한다(자정 걸침 금지 §A6-1). 시작 시각이 실제 벽시계에서
     * 파생되므로 늦은 밤에는 {@code start + 3h} 가 자정을 넘어 CHECK 에 걸린다 — 그때는 종료를
     * 그날 23:59 로 자른다. 이 테스트가 보는 것은 "참가 마감이 지났으면 개설하지 않는다" 뿐이라
     * 창 길이는 판정에 영향을 주지 않는다(개설 경로는 목표분 ≤ 창 길이를 검증하지 않는다 —
     * 그 검증은 챌린지 생성 시점의 몫이다).
     */
    private GroupChallenge windowChallengeStartingAt(LocalTime start) {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.FOCUS).type(MissionType.TIME_WINDOW).build());
        challenges.add(saved);
        LocalTime end = start.isBefore(LocalTime.of(20, 59))
                ? start.plusHours(3)
                : LocalTime.of(23, 59);
        groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(saved)
                .windowStart(start)
                .windowEnd(end)
                .durationMinutes(GOAL_MINUTES)
                .build());
        return saved;
    }

    private GroupChallengeBet betConfig(GroupChallenge challenge, boolean enabled) {
        GroupChallengeBet saved = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(challenge).stake(STAKE).enabled(enabled).build());
        configs.add(saved);
        return saved;
    }

    private Optional<GroupChallengeBetSession> ensure(GroupChallenge challenge, LocalDate date) {
        Optional<GroupChallengeBetSession> session =
                groupBetSessionOpeningService.ensureSession(challenge.getId(), date);
        session.ifPresent(betSessions::add);
        return session;
    }

    // ── 테스트 ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("하루형 오늘 회차를 스냅샷 박제로 개설하고, 재호출은 같은 회차를 돌려준다(멱등)")
    void opensTodaySessionOnceWithSnapshot() {
        LocalDate today = LocalDate.now(KST);
        GroupChallenge challenge = durationChallenge();
        betConfig(challenge, true);

        Optional<GroupChallengeBetSession> opened = ensure(challenge, today);

        assertThat(opened).isPresent();
        GroupChallengeBetSession session = opened.orElseThrow();
        assertThat(session.getStatus()).isEqualTo(GroupBetStatus.OPEN);
        assertThat(session.getSessionDate()).isEqualTo(today);
        assertThat(session.getStake()).isEqualTo(STAKE);
        assertThat(session.getGoalMinutes()).isEqualTo(GOAL_MINUTES);
        assertThat(session.getMissionCategory()).isEqualTo(MissionCategory.FOCUS);
        // 하루형 참가 마감 = 회차 종료(익일 00:00 KST).
        assertThat(session.getJoinClosesAt())
                .isEqualTo(today.plusDays(1).atStartOfDay(KST).toInstant());

        // 멱등 — 두 번째 호출은 새 행을 만들지 않고 기존 회차를 돌려준다.
        Optional<GroupChallengeBetSession> again = ensure(challenge, today);
        assertThat(again).isPresent();
        assertThat(again.orElseThrow().getId()).isEqualTo(session.getId());
    }

    @Test
    @DisplayName("참가 마감(창 시작)이 지난 창형은 오늘 개설하지 않는다 — 늦은 캐치업이 죽은 회차를 세우지 않는다")
    void skipsWindowedChallengeWhoseJoinDeadlinePassedToday() {
        ZonedDateTime nowKst = ZonedDateTime.now(KST);
        // 자정 직후에는 "오늘 이미 지난 창 시작"을 만들 수 없다 — 그 경계 시간대만 건너뛴다.
        Assumptions.assumeTrue(nowKst.toLocalTime().isAfter(LocalTime.of(0, 30)));
        LocalDate today = nowKst.toLocalDate();
        GroupChallenge passed = windowChallengeStartingAt(
                nowKst.toLocalTime().minusMinutes(20).withSecond(0).withNano(0));
        betConfig(passed, true);

        assertThat(ensure(passed, today)).isEmpty();
        assertThat(groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(configs.get(0).getId(), today)).isEmpty();
    }

    @Test
    @DisplayName("내기 미설정·비활성 설정·삭제된 챌린지는 개설 대상이 아니다")
    void skipsChallengesWithoutOpenableBet() {
        LocalDate today = LocalDate.now(KST);

        GroupChallenge noBet = durationChallenge();
        assertThat(ensure(noBet, today)).isEmpty();

        GroupChallenge disabled = durationChallenge();
        betConfig(disabled, false);
        assertThat(ensure(disabled, today)).isEmpty();

        GroupChallenge deleted = durationChallenge();
        betConfig(deleted, true);
        deleted.softDelete();
        groupChallengeRepository.save(deleted);
        assertThat(ensure(deleted, today)).isEmpty();
    }

    @Test
    @DisplayName("보증 스캔 — 내기 켜진 활성 챌린지의 오늘 회차를 일괄 개설한다")
    void ensureTodaySessionsOpensAllEligible() {
        GroupChallenge eligible = durationChallenge();
        GroupChallengeBet config = betConfig(eligible, true);
        GroupChallenge disabled = durationChallenge();
        betConfig(disabled, false);

        // 스캔 루프는 스케줄러 빈에 있다 — 서비스 안 루프는 자기 호출로 @Transactional 을 우회한다.
        int opened = groupBetScheduler.ensureTodaySessions();

        LocalDate today = LocalDate.now(KST);
        Optional<GroupChallengeBetSession> session =
                groupChallengeBetSessionRepository.findByBetIdAndSessionDate(config.getId(), today);
        assertThat(session).isPresent();
        session.ifPresent(betSessions::add);
        assertThat(opened).isGreaterThanOrEqualTo(1);
        assertThat(groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(configs.get(1).getId(), today)).isEmpty();

        // 재스캔은 새로 만들지 않는다(캐치업 멱등).
        int reopened = groupBetScheduler.ensureTodaySessions();
        assertThat(groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(config.getId(), today).orElseThrow().getId())
                .isEqualTo(session.orElseThrow().getId());
        assertThat(reopened).isLessThanOrEqualTo(opened);
    }
}
