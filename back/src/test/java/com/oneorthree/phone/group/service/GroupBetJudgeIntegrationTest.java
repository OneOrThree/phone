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
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
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
    @Autowired
    UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;

    private static final LocalDate DATE = LocalDate.of(2026, 8, 1);
    private static final int GOAL_MINUTES = 120;

    /**
     * 스크린타임 측정 권한을 가진 유저 — SCREEN_TIME 판정의 전제다(N50 · GROMO-1280). 권한이 없는
     * 유저는 커널이 아예 판정 대상에서 뺀다({@link #ignoresStatsOfUsersWithoutScreenTimePermission}).
     */
    private User saveUser(String nickname, boolean screenTimePermissionGranted) {
        User user = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        userScreenTimeSettingsRepository.save(UserScreenTimeSettings.builder()
                .userId(user.getId())
                .screenTimePermissionGranted(screenTimePermissionGranted)
                .build());
        return user;
    }

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
                .windowStart(LocalTime.parse(start))
                .windowEnd(LocalTime.parse(end))
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
                .challenge(duration).category(MissionCategory.SCREEN_TIME).durationMinutes(GOAL_MINUTES).build());
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
    @DisplayName("심야 창(22:00~23:59) 의 D일 마감도 D 안이다 — 자정 걸침 금지(GROMO-1406)로 D+1 마감은 없다")
    void lateNightWindowClosesOnSameDate() {
        GroupChallenge challenge = saveWindowChallenge(
                MissionCategory.FOCUS, "22:00:00", "23:59:00", GOAL_MINUTES);
        GroupBetJudge.Target target = groupBetJudge.resolve(challenge).orElseThrow();

        // 2026-08-01 23:59 KST = 2026-08-01T14:59Z — 마감이 날짜 D 를 벗어나지 않는다.
        Instant closesAt = groupBetJudge.windowClosesAt(target, DATE).orElseThrow();
        assertThat(closesAt).isEqualTo(Instant.parse("2026-08-01T14:59:00Z"));
    }

    @Test
    @DisplayName("DURATION 은 창이 없어 마감 시각도 없다 — 날짜 게이트만으로 마감한다")
    void durationHasNoWindowClose() {
        GroupChallenge duration = saveChallenge(MissionCategory.FOCUS, MissionType.DURATION);
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(duration).category(MissionCategory.FOCUS).durationMinutes(GOAL_MINUTES).build());
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
        User participant = saveUser("참가자", true);
        User stranger = saveUser("비참가자", true);

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
        User silent = saveUser("미보고", true);

        assertThat(groupBetJudge.progressMinutes(target, DATE, List.of(silent))).isEmpty();
        assertThat(GroupBetJudge.isAchieved(target, null)).isFalse();
        // 같은 null 이 FOCUS 창형에서는 "0분 집중"으로 해석된다 — 목표가 0 이 아니면 역시 미달성이다.
        GroupBetJudge.Target focusWindow = groupBetJudge.resolve(saveWindowChallenge(
                MissionCategory.FOCUS, "09:00:00", "12:00:00", GOAL_MINUTES)).orElseThrow();
        assertThat(GroupBetJudge.isAchieved(focusWindow, null)).isFalse();
        assertThat(GroupBetJudge.isAchieved(focusWindow, GOAL_MINUTES - 5)).isTrue();
    }

    @Test
    @DisplayName("스크린타임 권한이 없는 유저는 통계·보고가 남아 있어도 판정 대상에서 빠진다 (N50 · FR-21)")
    void ignoresStatsOfUsersWithoutScreenTimePermission() {
        // 철회 전에 쌓인 부분 측정값으로 "목표 이하"를 판정하면 측정을 끄는 것이 곧 승리가 된다 —
        // SCREEN_TIME 은 작을수록 이기는 지표이기 때문이다. 카드가 오래 전부터 쓰던 규칙을 커널로
        // 올려, 화면과 정산이 같은 답을 내게 한다(GROMO-1280).
        GroupChallenge challenge = saveWindowChallenge(
                MissionCategory.SCREEN_TIME, "09:00:00", "12:00:00", GOAL_MINUTES);
        GroupBetJudge.Target target = groupBetJudge.resolve(challenge).orElseThrow();
        User granted = saveUser("권한동의", true);
        User revoked = saveUser("권한철회", false);
        groupChallengeMemberRepository.save(GroupChallengeMember.builder()
                .groupChallenge(challenge).user(granted).usageDate(DATE).progressMinutes(30).build());
        groupChallengeMemberRepository.save(GroupChallengeMember.builder()
                .groupChallenge(challenge).user(revoked).usageDate(DATE).progressMinutes(5).build());

        assertThat(groupBetJudge.progressMinutes(target, DATE, List.of(granted, revoked)))
                .containsExactly(entry(granted.getId(), 30));
        // 3상: 화면은 "미계측(—)" · 정산은 FR-21 로 미달성 확정 — 같은 커널의 두 판이다.
        assertThat(GroupBetJudge.achievedOrNull(target, null)).isNull();
        assertThat(GroupBetJudge.isAchieved(target, null)).isFalse();
        assertThat(GroupBetJudge.displayMinutes(target, null)).isNull();
    }

    @Test
    @DisplayName("FOCUS 는 권한과 무관하다 — 서버 데이터라 무기록이 곧 0분이다 (FR-15)")
    void focusJudgingIsIndependentOfScreenTimePermission() {
        GroupBetJudge.Target focus = groupBetJudge.resolve(saveWindowChallenge(
                MissionCategory.FOCUS, "09:00:00", "12:00:00", GOAL_MINUTES)).orElseThrow();
        User revoked = saveUser("권한철회", false);

        // 집중 세션이 없으니 키도 없지만, 그 null 의 뜻은 "0분 집중"이다.
        assertThat(groupBetJudge.progressMinutes(focus, DATE, List.of(revoked))).isEmpty();
        assertThat(GroupBetJudge.displayMinutes(focus, null)).isZero();
        assertThat(GroupBetJudge.achievedOrNull(focus, null)).isFalse();
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
