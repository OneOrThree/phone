package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 사일런트 flush 대상 선정(GROMO-1281)의 실 DB 검증 — 술어가 SQL 안에 있어 목으로는 못 잡는다.
 *
 * <p>잠그는 성질 셋:
 * <ol>
 *   <li><b>FOCUS 하루형이 대상이다</b> — {@code settle_after} 가 KST 자정+1h 라 사일런트가 심야에
 *       나가는데, 조용한 시간(23–07)이 사일런트 예외인 이유가 정확히 이 케이스다(HLD §6).
 *       {@code missionType = TIME_WINDOW} 로만 좁히면 이 구제가 통째로 사라진다.</li>
 *   <li><b>SCREEN_TIME 하루형만 빠진다</b> — 11:30 별도 슬롯으로 이관된 유일한 조합(미구현·후속).</li>
 *   <li><b>창은 {@code settle_after} − 15분 ~ {@code settle_after}</b> — 16분 전(너무 이름)과
 *       정산 시각 이후(너무 늦음)는 잡히지 않는다. 그레이스 진입 직후도 이 창 밖이다.</li>
 * </ol>
 */
class SilentFlushTargetQueryIntegrationTest extends RepositoryTestBase {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final LocalDate DAY = LocalDate.of(2026, 6, 2);

    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeBetRepository groupChallengeBetRepository;
    @Autowired
    GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;

    private Group group;

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("사일런트그룹").build());
    }

    private GroupChallengeBetSession session(
            MissionCategory category, MissionType type, Instant closesAt, Instant settleAfter) {
        GroupChallenge challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(category).type(type).build());
        GroupChallengeBet config = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(challenge).stake(300).enabled(true).build());
        return groupChallengeBetSessionRepository.save(GroupChallengeBetSession.builder()
                .bet(config)
                .group(group)
                .challenge(challenge)
                .sessionDate(DAY)
                .stake(300)
                .goalMinutes(60)
                .missionCategory(category)
                .missionType(type)
                .status(GroupBetStatus.OPEN)
                .startsAt(DAY.atStartOfDay(KST).toInstant())
                .joinClosesAt(closesAt)
                .closesAt(closesAt)
                .settleAfter(settleAfter)
                .build());
    }

    /** 하루형 회차 — 종료는 자정, 정산은 카테고리 그레이스 뒤(FOCUS +1h / SCREEN_TIME +12h). */
    private GroupChallengeBetSession durationSession(MissionCategory category, Duration grace) {
        Instant midnight = DAY.plusDays(1).atStartOfDay(KST).toInstant();
        return session(category, MissionType.DURATION, midnight, midnight.plus(grace));
    }

    private List<UUID> targetsAt(Instant now) {
        return groupChallengeBetSessionRepository
                .findSilentFlushTargets(now, now.plus(SilentFlushPushService.SETTLE_LEAD))
                .stream()
                .map(GroupChallengeBetSession::getId)
                .toList();
    }

    @Test
    @DisplayName("FOCUS 하루형은 심야(자정+1h 정산의 −15분 = 00:45)에 대상으로 잡힌다")
    void focusDurationIsTargetedLateAtNight() {
        GroupChallengeBetSession focusDaily = durationSession(MissionCategory.FOCUS, Duration.ofHours(1));
        Instant settleAfter = focusDaily.getSettleAfter();

        // 정산 15분 전 — 조용한 시간 한복판이지만 사일런트는 그 필터의 예외다(HLD §6).
        assertThat(targetsAt(settleAfter.minus(Duration.ofMinutes(15)))).contains(focusDaily.getId());
        assertThat(targetsAt(settleAfter.minus(Duration.ofMinutes(1)))).contains(focusDaily.getId());
    }

    @Test
    @DisplayName("SCREEN_TIME 하루형만 제외된다 — 11:30 별도 슬롯 이관분(미구현·후속)")
    void screenTimeDurationIsExcluded() {
        GroupChallengeBetSession screenTimeDaily =
                durationSession(MissionCategory.SCREEN_TIME, Duration.ofHours(12));
        Instant settleAfter = screenTimeDaily.getSettleAfter();

        assertThat(targetsAt(settleAfter.minus(Duration.ofMinutes(15))))
                .doesNotContain(screenTimeDaily.getId());
        assertThat(targetsAt(settleAfter.minus(Duration.ofMinutes(5))))
                .doesNotContain(screenTimeDaily.getId());
    }

    @Test
    @DisplayName("창은 settle_after −15분부터 — 16분 전·정산 시각 이후·그레이스 진입 직후는 안 잡힌다")
    void windowIsExactlyFifteenMinutesBeforeSettle() {
        // 창 09:00~12:00(KST), settle_after = 12:30(창 끝 + 30분 그레이스).
        Instant closesAt = DAY.atTime(LocalTime.of(12, 0)).atZone(KST).toInstant();
        Instant settleAfter = DAY.atTime(LocalTime.of(12, 30)).atZone(KST).toInstant();
        GroupChallengeBetSession windowed =
                session(MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW, closesAt, settleAfter);

        // 그레이스 진입 직후(12:05) — 종전 구현이 발송하던 시점. 마지막 15분 버킷이 확정되기 전이라
        // 이제는 대상이 아니다(문서 셋의 settle_after − 15분 채택).
        assertThat(targetsAt(DAY.atTime(LocalTime.of(12, 5)).atZone(KST).toInstant()))
                .doesNotContain(windowed.getId());
        assertThat(targetsAt(settleAfter.minus(Duration.ofMinutes(16))))
                .doesNotContain(windowed.getId());
        assertThat(targetsAt(settleAfter.minus(Duration.ofMinutes(15)))).contains(windowed.getId());
        assertThat(targetsAt(settleAfter)).doesNotContain(windowed.getId());
    }

    @Test
    @DisplayName("정산이 끝난 회차(OPEN 아님)는 대상이 아니다")
    void settledSessionIsNotTargeted() {
        Instant closesAt = DAY.atTime(LocalTime.of(12, 0)).atZone(KST).toInstant();
        Instant settleAfter = DAY.atTime(LocalTime.of(12, 30)).atZone(KST).toInstant();
        GroupChallengeBetSession windowed =
                session(MissionCategory.SCREEN_TIME, MissionType.TIME_WINDOW, closesAt, settleAfter);
        groupChallengeBetSessionRepository.compareAndSetSettled(
                windowed.getId(), GroupBetStatus.SETTLED, null, Instant.now());

        assertThat(targetsAt(settleAfter.minus(Duration.ofMinutes(10))))
                .doesNotContain(windowed.getId());
    }
}
