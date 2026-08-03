package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeMember;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeMemberRepository;
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
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.entry;

/**
 * 판정 소스 해석기({@link GroupBetJudge})의 실 DB 검증 — 특히 <b>창 마감 시각 계산</b>.
 *
 * <p>{@code GroupBetServiceTest} 는 판정 소스를 모킹해 가드 분기만 보므로, "실제 창이 언제 닫히는가"
 * 와 그것이 날짜 게이트와 어떻게 맞물리는가는 그 테스트로 드러나지 않는다(PR #446 리뷰). 여기서
 * 실제 창 행으로 계산해 경계를 고정한다.
 *
 * <p>시각 표기: 창 Instant 는 Asia/Seoul 벽시계 시각(time-of-day)만 의미가 있고(GROMO-1100), 날짜 D 의
 * 실제 창은 D(KST)에 그 시각을 얹는다. 예) 09:00~12:00 창의 2026-08-01 실제 경계는 KST 09:00 =
 * {@code 2026-08-01T00:00Z}.
 */
class GroupBetJudgeIntegrationTest extends RepositoryTestBase {

    @Autowired
    GroupBetJudge groupBetJudge;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeDurationRepository groupChallengeDurationRepository;
    @Autowired
    GroupChallengeWindowRepository groupChallengeWindowRepository;
    @Autowired
    GroupChallengeMemberRepository groupChallengeMemberRepository;
    @Autowired
    UserRepository userRepository;

    private static final LocalDate DATE = LocalDate.of(2026, 8, 1);
    private static final int GOAL_MINUTES = 120;

    private GroupChallenge saveChallenge(MissionCategory category, MissionType type) {
        Group group = groupRepository.save(Group.builder().name("판정검증").maxMembers(10).build());
        return groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(category).type(type).build());
    }

    private GroupChallenge saveWindowChallenge(MissionCategory category, String start, String end,
            Integer goalMinutes) {
        GroupChallenge challenge = saveChallenge(category, MissionType.TIME_WINDOW);
        groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(challenge)
                .windowStartAt(Instant.parse("2026-01-01T" + start + "+09:00"))
                .windowEndAt(Instant.parse("2026-01-01T" + end + "+09:00"))
                .durationMinutes(goalMinutes)
                .build());
        return challenge;
    }

    // ── 대상 해석(게이트) ────────────────────────────────────────────────

    @Test
    @DisplayName("DURATION 은 일 목표를, 창형은 창 목표분을 대상 목표로 잡는다")
    void resolvesGoalPerType() {
        GroupChallenge duration = saveChallenge(MissionCategory.SCREEN_TIME, MissionType.DURATION);
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(duration).durationMinutes(GOAL_MINUTES).build());
        GroupChallenge window = saveWindowChallenge(MissionCategory.FOCUS, "09:00:00", "12:00:00", 90);

        assertThat(groupBetJudge.resolve(duration))
                .get().extracting(GroupBetJudge.Target::goalMinutes, GroupBetJudge.Target::windowed)
                .containsExactly(GOAL_MINUTES, false);
        assertThat(groupBetJudge.resolve(window))
                .get().extracting(GroupBetJudge.Target::goalMinutes, GroupBetJudge.Target::windowed)
                .containsExactly(90, true);
    }

    @Test
    @DisplayName("목표분 없는 구 창 챌린지·상세 유실 DURATION 은 대상이 아니다 — 내기 게이트가 여기서 닫힌다")
    void rejectsChallengesWithoutGoal() {
        GroupChallenge goallessWindow = saveWindowChallenge(MissionCategory.FOCUS, "09:00:00", "12:00:00", null);
        GroupChallenge orphanDuration = saveChallenge(MissionCategory.FOCUS, MissionType.DURATION);

        assertThat(groupBetJudge.resolve(goallessWindow)).isEmpty();
        assertThat(groupBetJudge.resolve(orphanDuration)).isEmpty();
    }

    // ── 창 마감 시각 ─────────────────────────────────────────────────────

    @Test
    @DisplayName("같은 날 창(09:00~12:00) 의 마감은 그날 12:00 KST — 참가 가드가 실제로 닫는 경우")
    void sameDayWindowClosesOnSameDate() {
        GroupChallenge challenge = saveWindowChallenge(
                MissionCategory.FOCUS, "09:00:00", "12:00:00", GOAL_MINUTES);
        GroupBetJudge.Target target = groupBetJudge.resolve(challenge).orElseThrow();

        // 2026-08-01 12:00 KST = 2026-08-01T03:00Z
        assertThat(groupBetJudge.windowClosesAt(target, DATE))
                .contains(Instant.parse("2026-08-01T03:00:00Z"));
    }

    @Test
    @DisplayName("자정 걸침 창(22:00~01:00) 의 D일 마감은 D+1 01:00 KST — 그래서 D 당일엔 가드가 닫지 않는다")
    void midnightCrossingWindowClosesNextDay() {
        GroupChallenge challenge = saveWindowChallenge(
                MissionCategory.FOCUS, "22:00:00", "01:00:00", GOAL_MINUTES);
        GroupBetJudge.Target target = groupBetJudge.resolve(challenge).orElseThrow();

        // 2026-08-02 01:00 KST = 2026-08-01T16:00Z — 날짜 D(08-01) 의 어느 시각보다도 뒤다.
        Instant closesAt = groupBetJudge.windowClosesAt(target, DATE).orElseThrow();
        assertThat(closesAt).isEqualTo(Instant.parse("2026-08-01T16:00:00Z"));

        // D 의 마지막 순간(23:59:59 KST = 14:59:59Z)조차 마감보다 이르다 → 개설·참가 가드
        // (requireWindowStillOpen)는 betDate == 오늘 인 동안 절대 걸리지 않는다. 실질 마감은
        // 자정에 날짜 게이트가 넘어가면서 처리되므로, 창의 마지막 1시간은 새 참가를 받지 않는다.
        assertThat(Instant.parse("2026-08-01T14:59:59Z")).isBefore(closesAt);
    }

    @Test
    @DisplayName("DURATION 은 창이 없어 마감 시각도 없다 — 날짜 게이트만으로 마감한다")
    void durationHasNoWindowClose() {
        GroupChallenge duration = saveChallenge(MissionCategory.FOCUS, MissionType.DURATION);
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(duration).durationMinutes(GOAL_MINUTES).build());
        GroupBetJudge.Target target = groupBetJudge.resolve(duration).orElseThrow();

        assertThat(groupBetJudge.windowClosesAt(target, DATE)).isEqualTo(Optional.empty());
    }

    // ── 클라 보고값 소스 ─────────────────────────────────────────────────

    @Test
    @DisplayName("스크린타임 창 보고값은 (챌린지, 유저, 날짜) 로 정확히 걸러진다 — 남의 보고·다른 날짜 무시")
    void readsReportedWindowUsageScopedToChallengeUserAndDate() {
        GroupChallenge challenge = saveWindowChallenge(
                MissionCategory.SCREEN_TIME, "09:00:00", "12:00:00", GOAL_MINUTES);
        GroupBetJudge.Target target = groupBetJudge.resolve(challenge).orElseThrow();
        User participant = userRepository.save(User.builder().nickname("참가자").isGuest(false).build());
        User stranger = userRepository.save(User.builder().nickname("비참가자").isGuest(false).build());

        groupChallengeMemberRepository.save(GroupChallengeMember.builder()
                .groupChallenge(challenge).user(participant).usageDate(DATE).progressMinutes(30).build());
        groupChallengeMemberRepository.save(GroupChallengeMember.builder()
                .groupChallenge(challenge).user(participant).usageDate(DATE.minusDays(1))
                .progressMinutes(999).build());
        groupChallengeMemberRepository.save(GroupChallengeMember.builder()
                .groupChallenge(challenge).user(stranger).usageDate(DATE).progressMinutes(5).build());
        // 같은 유저·같은 날짜지만 다른 챌린지의 보고 — 챌린지 축이 실제로 갈리는지 확인한다(PR #446 재리뷰).
        // 같은 그룹에 창형이 하나뿐이라는 제약(V20)과 무관하게, 판정은 challengeId 로 걸러져야 한다.
        GroupChallenge otherChallenge = saveWindowChallenge(
                MissionCategory.SCREEN_TIME, "13:00:00", "15:00:00", GOAL_MINUTES);
        groupChallengeMemberRepository.save(GroupChallengeMember.builder()
                .groupChallenge(otherChallenge).user(participant).usageDate(DATE)
                .progressMinutes(777).build());

        assertThat(groupBetJudge.progressMinutes(target, DATE, List.of(participant)))
                .containsExactly(entry(participant.getId(), 30));
        // 반대 방향도 고정 — 다른 챌린지 대상으로는 그쪽 보고값만 보인다(교차 오염 없음).
        assertThat(groupBetJudge.progressMinutes(
                groupBetJudge.resolve(otherChallenge).orElseThrow(), DATE, List.of(participant)))
                .containsExactly(entry(participant.getId(), 777));
    }

    @Test
    @DisplayName("보고가 없으면 키가 없고, 그 상태는 SCREEN_TIME 에서 미달성으로 확정된다")
    void missingReportIsFailureForScreenTime() {
        GroupChallenge challenge = saveWindowChallenge(
                MissionCategory.SCREEN_TIME, "09:00:00", "12:00:00", GOAL_MINUTES);
        GroupBetJudge.Target target = groupBetJudge.resolve(challenge).orElseThrow();
        User silent = userRepository.save(User.builder().nickname("미보고").isGuest(false).build());

        assertThat(groupBetJudge.progressMinutes(target, DATE, List.of(silent))).isEmpty();
        assertThat(GroupBetJudge.isAchieved(target, null)).isFalse();
        // 같은 null 이 FOCUS 창형에서는 "0분 집중"으로 해석된다 — 목표가 0 이 아니면 역시 미달성이다.
        GroupBetJudge.Target focusWindow = groupBetJudge.resolve(saveWindowChallenge(
                MissionCategory.FOCUS, "09:00:00", "12:00:00", GOAL_MINUTES)).orElseThrow();
        assertThat(GroupBetJudge.isAchieved(focusWindow, null)).isFalse();
        assertThat(GroupBetJudge.isAchieved(focusWindow, GOAL_MINUTES - 5)).isTrue();
    }

    @Test
    @DisplayName("잔여 배분 방향은 카테고리로 갈린다 — FOCUS 최대 / SCREEN_TIME 최소")
    void remainderRuleFollowsCategory() {
        GroupBetJudge.Target focus = groupBetJudge.resolve(saveWindowChallenge(
                MissionCategory.FOCUS, "09:00:00", "12:00:00", GOAL_MINUTES)).orElseThrow();
        GroupBetJudge.Target screenTime = groupBetJudge.resolve(saveWindowChallenge(
                MissionCategory.SCREEN_TIME, "13:00:00", "15:00:00", GOAL_MINUTES)).orElseThrow();

        assertThat(GroupBetJudge.remainderRule(focus))
                .isEqualTo(GroupBetPayoutCalculator.RemainderRule.HIGHEST_PROGRESS);
        assertThat(GroupBetJudge.remainderRule(screenTime))
                .isEqualTo(GroupBetPayoutCalculator.RemainderRule.LOWEST_PROGRESS);
    }
}
