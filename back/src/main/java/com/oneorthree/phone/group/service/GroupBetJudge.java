package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeMember;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeMemberRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 내기 판정의 단일 소스 — 카테고리×타입 4조합마다 다른 데이터에서 "목표"와 "진행분"을 읽고 달성을 판정한다.
 *
 * <p>참가 가드({@link GroupBetService})와 정산({@link GroupBetSettler})이 <b>같은 기준</b>으로 판정하도록
 * 한 곳에 모았다 — 갈라지면 "참가는 막혔는데 정산은 달성"처럼 돈이 걸린 모순이 생긴다.
 *
 * <table>
 *   <caption>조합별 판정 소스</caption>
 *   <tr><th>조합</th><th>소스</th><th>달성 조건</th></tr>
 *   <tr><td>FOCUS × DURATION</td><td>{@code daily_focus_stats}</td><td>집중분 ≥ 목표</td></tr>
 *   <tr><td>FOCUS × TIME_WINDOW</td><td>{@link WindowFocusAggregator}(세션 클리핑)</td>
 *       <td>창 내 집중분 ≥ 목표 − 5분(관용치)</td></tr>
 *   <tr><td>SCREEN_TIME × DURATION</td><td>{@code daily_screen_time_stats}</td>
 *       <td>사용분 ≤ 목표 (미보고 = 미달성)</td></tr>
 *   <tr><td>SCREEN_TIME × TIME_WINDOW</td><td>{@code group_challenge_members} 날짜별 보고값</td>
 *       <td>창 내 사용분 ≤ 목표 (미보고 = 미달성)</td></tr>
 * </table>
 *
 * <p>FOCUS 는 서버 데이터라 "행 없음 = 0분"이 사실이지만, SCREEN_TIME 은 클라 보고라 "행 없음 = 미보고"다.
 * 정산은 마감돼야 하므로 미보고를 판정불가가 아니라 <b>미달성</b>으로 확정한다(확정 정책).
 */
@Component
@RequiredArgsConstructor
public class GroupBetJudge {

    private final GroupChallengeDurationRepository groupChallengeDurationRepository;
    private final GroupChallengeWindowRepository groupChallengeWindowRepository;
    private final GroupChallengeMemberRepository groupChallengeMemberRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final DailyScreenTimeStatRepository dailyScreenTimeStatRepository;
    private final WindowFocusAggregator windowFocusAggregator;

    /**
     * 내기를 걸 수 있는 챌린지 + 그 목표. 창형이면 창 상세까지 들고 있어 마감 시각·클리핑 집계에 재사용한다.
     *
     * @param challenge   내기가 걸린 챌린지
     * @param goalMinutes 목표 분 — DURATION 은 일 목표, TIME_WINDOW 는 창 내 목표(V20)
     * @param window      창 상세(TIME_WINDOW 만, DURATION 은 null)
     */
    public record Target(GroupChallenge challenge, int goalMinutes, GroupChallengeWindow window) {

        public MissionCategory category() {
            return challenge.getCategory();
        }

        public boolean windowed() {
            return window != null;
        }
    }

    /**
     * 내기 게이트 — {@code DURATION || (TIME_WINDOW && durationMinutes != null)}. 카테고리 제한은 없다
     * (전 조합 허용, 확정 정책). 목표를 모르면 판정도 정산도 불가하므로 empty 로 거절한다.
     */
    public Optional<Target> resolve(GroupChallenge challenge) {
        if (challenge.getType() == MissionType.DURATION) {
            return groupChallengeDurationRepository.findById(challenge.getId())
                    .map(GroupChallengeDuration::getDurationMinutes)
                    .map(goal -> new Target(challenge, goal, null));
        }
        if (challenge.getType() != MissionType.TIME_WINDOW) {
            return Optional.empty();
        }
        // 목표분 없는 구 창 챌린지는 판정 자체가 불가 — 내기 대상이 아니다.
        return groupChallengeWindowRepository.findById(challenge.getId())
                .filter(window -> window.getDurationMinutes() != null)
                .map(window -> new Target(challenge, window.getDurationMinutes(), window));
    }

    /**
     * 날짜 {@code date}(KST)의 창 종료 시각 — 개설·참가 마감 판정용. DURATION 은 창이 없어 empty 다
     * (마감은 날짜 경계가 담당한다).
     */
    public Optional<Instant> windowClosesAt(Target target, LocalDate date) {
        return target.windowed()
                ? Optional.of(windowFocusAggregator.windowEndOn(date, target.window()))
                : Optional.empty();
    }

    /**
     * 날짜 {@code date}(KST)의 창 시작 시각 — 참가 철회(GROMO-1102)의 "시작 전" 판정용. DURATION 은
     * 창이 없어 empty 다(시작은 날짜 경계가 담당한다). zone 변환은
     * {@link WindowFocusAggregator#windowStartOn} 하나만 지난다 — 창 시각 해석의 단일 변환점 계약.
     */
    public Optional<Instant> windowOpensAt(Target target, LocalDate date) {
        return target.windowed()
                ? Optional.of(windowFocusAggregator.windowStartOn(date, target.window()))
                : Optional.empty();
    }

    /**
     * 유저별 진행분(조합별 소스). 값이 없는 유저는 <b>키가 없다</b> — FOCUS 는 0분, SCREEN_TIME 은
     * 미보고를 뜻하므로 의미가 달라 호출측이 {@link #isAchieved} 로 해석한다.
     */
    public Map<UUID, Integer> progressMinutes(Target target, LocalDate date, Collection<User> users) {
        if (users.isEmpty()) {
            return Map.of();
        }
        List<UUID> userIds = users.stream().map(User::getId).toList();
        if (target.category() == MissionCategory.FOCUS) {
            return target.windowed()
                    ? windowFocusAggregator.focusMinutesWithin(userIds, date, target.window())
                    : dailyFocusMinutes(userIds, date);
        }
        return target.windowed()
                ? reportedWindowUsage(target.challenge().getId(), date, userIds)
                : dailyScreenTimeMinutes(users, date);
    }

    /**
     * 달성 판정 — FOCUS 는 "이상"(창은 5분 관용치), SCREEN_TIME 은 "이하"다.
     *
     * @param minutes {@link #progressMinutes} 의 값. null 은 FOCUS 에선 0분, SCREEN_TIME 에선 미보고다
     */
    public static boolean isAchieved(Target target, Integer minutes) {
        if (target.category() == MissionCategory.SCREEN_TIME) {
            return minutes != null && minutes <= target.goalMinutes();
        }
        int measured = minutes == null ? 0 : minutes;
        return target.windowed()
                ? WindowFocusAggregator.isAchieved(measured, target.goalMinutes())
                : measured >= target.goalMinutes();
    }

    /**
     * 잔여 코인을 받을 "성과 1위"의 방향 — FOCUS 는 진행분 최대, SCREEN_TIME 은 사용분 최소로 반대다
     * (같은 규칙을 쓰면 스크린타임 내기에서 제일 많이 쓴 승자가 잔여를 가져간다).
     */
    public static GroupBetPayoutCalculator.RemainderRule remainderRule(Target target) {
        return target.category() == MissionCategory.SCREEN_TIME
                ? GroupBetPayoutCalculator.RemainderRule.LOWEST_PROGRESS
                : GroupBetPayoutCalculator.RemainderRule.HIGHEST_PROGRESS;
    }

    // ── 조합별 소스 ──────────────────────────────────────────────────────

    /** 유저·날짜당 1행이지만, 혹시 여럿이면 최댓값으로 방어한다(카드 진행률과 같은 관례). */
    private Map<UUID, Integer> dailyFocusMinutes(List<UUID> userIds, LocalDate date) {
        Map<UUID, Integer> minutes = new HashMap<>();
        for (DailyFocusStat stat : dailyFocusStatRepository.findByUserIdInAndDate(userIds, date)) {
            minutes.merge(stat.getUser().getId(), stat.getTotalFocusSeconds() / 60, Integer::max);   // GROMO-642
        }
        return minutes;
    }

    /**
     * 스크린타임도 유저·날짜당 1행이다. 중복 시 최댓값(= 더 많이 썼다고 보는 쪽)으로 방어한다.
     *
     * <p><b>미집계(null) 행은 건너뛴다</b>(GROMO-1267) — 키가 없으면 {@link #isAchieved} 가 미보고로
     * 보고 미달성 처리한다(정책 §B4). 0 으로 접으면 미보고가 "0분 사용 = 달성"으로 뒤집히고,
     * {@code Map#merge} 는 null 값 자체를 NPE 로 거절한다.
     */
    private Map<UUID, Integer> dailyScreenTimeMinutes(Collection<User> users, LocalDate date) {
        Map<UUID, Integer> minutes = new HashMap<>();
        for (DailyScreenTimeStat stat : dailyScreenTimeStatRepository.findByUserInAndDate(users, date)) {
            if (stat.getTotalScreenTimeMinutes() == null) {
                continue;
            }
            minutes.merge(stat.getUser().getId(), stat.getTotalScreenTimeMinutes(), Integer::max);
        }
        return minutes;
    }

    /**
     * 창 사용분 클라 보고값({@code group_challenge_members} 의 (챌린지, 유저, 날짜) 행). 카드 진행률과
     * 같은 조회를 재사용해 판정 소스가 갈라지지 않게 한다. 보고가 없는 참가자는 키가 없다(= 미달성).
     */
    private Map<UUID, Integer> reportedWindowUsage(UUID challengeId, LocalDate date, List<UUID> userIds) {
        Set<UUID> participants = Set.copyOf(userIds);
        return groupChallengeMemberRepository
                .findByGroupChallengeIdInAndUsageDate(List.of(challengeId), date).stream()
                .filter(member -> participants.contains(member.getUser().getId()))
                .collect(Collectors.toMap(
                        member -> member.getUser().getId(),
                        GroupChallengeMember::getProgressMinutes,
                        Integer::max));
    }
}
