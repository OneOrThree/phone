package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.repository.domain.GroupChallengeMember;
import com.oneorthree.phone.group.repository.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeMemberRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.screentime.repository.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.stats.repository.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.group.support.GroupBetPayoutCalculator;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 달성 판정의 <b>단일 커널</b>(GROMO-1280) — 카테고리×타입 4조합마다 다른 데이터에서 "목표"와
 * "진행분"을 읽고 달성을 판정한다. 챌린지 카드 진행률·내기 참가 가드·조기 승리 확정·회차 정산이
 * 전부 이 클래스만 지난다.
 *
 * <p><b>왜 하나여야 하나.</b> 판정이 여러 벌이면 돈이 걸린 쪽과 화면이 보여주는 쪽이 갈린다.
 * 실제로 갈려 있었다: 카드는 스크린타임 권한을 철회한 멤버를 진행률에서 <b>빼서</b> "판정 불가(—)"로
 * 그렸는데, 정산은 같은 필터가 없어 <b>철회 전에 쌓인 통계</b>로 승패를 확정했다. 화면은 "모름",
 * 지급은 "승리" — 그 차이만큼 코인이 잘못 나갔다.
 *
 * <table>
 *   <caption>조합별 판정 소스</caption>
 *   <tr><th>조합</th><th>소스</th><th>달성 조건</th></tr>
 *   <tr><td>FOCUS × DURATION</td><td>{@code daily_focus_stats}</td><td>집중분 ≥ 목표</td></tr>
 *   <tr><td>FOCUS × TIME_WINDOW</td><td>{@link WindowFocusAggregator}(세션 클리핑)</td>
 *       <td>창 내 집중분 ≥ 목표 − 5분(관용치)</td></tr>
 *   <tr><td>SCREEN_TIME × DURATION</td><td>{@code daily_screen_time_stats}</td>
 *       <td>사용분 ≤ 목표 (미계측 = 판정 불가 → 정산에선 미달성)</td></tr>
 *   <tr><td>SCREEN_TIME × TIME_WINDOW</td><td>{@code group_challenge_members} 날짜별 보고값</td>
 *       <td>창 내 사용분 ≤ 목표 (미계측 = 판정 불가 → 정산에선 미달성)</td></tr>
 * </table>
 *
 * <p><b>3상 규칙(§B7 · FR-15/FR-16)</b>은 커널 안에 있다. {@link #progressMinutes} 는 값이 없는
 * 유저의 <b>키를 만들지 않고</b>, 그 null 의 뜻을 카테고리별로 해석하는 곳이
 * {@link #displayMinutes}(표시)·{@link #achievedOrNull}(3상 판정)·{@link #isAchieved}(확정 판정)
 * 셋뿐이다. FOCUS 의 null 은 "0분 집중"이라는 사실이고, SCREEN_TIME 의 null 은 "미계측"이라
 * 표시 단계에서는 {@code null}(—)로 남고 정산 단계에서만 FR-21 에 따라 미달성으로 확정된다.
 *
 * <p><b>스크린타임 측정 권한(N50 · FR-21)</b>: SCREEN_TIME 진행분은 <b>권한에 동의한 유저만</b>
 * 대상이다({@link #measurableForScreenTime}). 철회한 유저에게 남아 있는 통계는 철회 시점까지의
 * 부분값이라, 그걸로 "하루 2시간 이하"를 판정하면 <b>측정을 끄는 것이 곧 승리</b>가 된다
 * (SCREEN_TIME 은 작을수록 이기는 지표다). 권한 없는 참여를 애초에 막는 것이 N50 이고, 그래도
 * 남는 "참가 후 철회"는 FR-21 대로 미계측 → 미달성으로 닫는다.
 */
@Component
@RequiredArgsConstructor
public class GroupBetJudge {

    private final GroupChallengeDurationRepository groupChallengeDurationRepository;
    private final GroupChallengeWindowRepository groupChallengeWindowRepository;
    private final GroupChallengeMemberRepository groupChallengeMemberRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final DailyScreenTimeStatRepository dailyScreenTimeStatRepository;
    private final UserQueryService userQueryService;
    private final WindowFocusAggregator windowFocusAggregator;

    /**
     * 판정 대상 — "무엇을, 어떤 기준으로 재는가"의 값 객체. <b>엔티티를 들고 있지 않다</b>: 회차
     * 판정은 개설 시점에 박제된 스냅샷(GROMO-1263)이 기준이라, 챌린지 행이 바뀌거나 삭제돼도
     * 같은 답이 나와야 한다({@link #ofSession}).
     *
     * @param challengeId 판정 소스 조회 축(SCREEN_TIME 창형 보고값이 챌린지 단위다)
     * @param goalMinutes 목표 분 — DURATION 은 일 목표, TIME_WINDOW 는 창 내 목표(V20)
     * @param windowStart 창 시작(KST 벽시계, 창형만) · @param windowEnd 창 종료(창형만)
     */
    public record Target(UUID challengeId, MissionCategory category, MissionType type,
            int goalMinutes, LocalTime windowStart, LocalTime windowEnd) {

        /**
         * 창형인데 창 시각이 비어 있으면 대상 자체를 세우지 못하게 막는다 — 「창 내 집중분」이 정의되지
         * 않아 판정도 정산도 불가이기 때문이다. 여기서 걸리면 잘못된 대상이 판정 경로에 들어오기 전에 죽는다.
         *
         * @param challengeId 판정 소스 조회 축 — SCREEN_TIME 창형 보고값이 챌린지 단위다
         * @param category 부등호 방향과 소스를 가르는 축(FOCUS 는 「이상」, SCREEN_TIME 은 「이하」)
         * @param type 하루형/창형 — 시각 계산과 마감 규칙이 여기서 갈린다
         * @param goalMinutes 하루형은 일 목표, 창형은 창 내 목표
         * @param windowStart 창 시작(KST 벽시계). 하루형이면 null
         * @param windowEnd 창 종료(KST 벽시계). 하루형이면 null
         * @throws IllegalArgumentException 창형인데 창 시작·종료 중 하나라도 없을 때
         */
        public Target {
            if (type == MissionType.TIME_WINDOW && (windowStart == null || windowEnd == null)) {
                // 창 시각을 모르면 "창 내 집중분"이 정의되지 않는다 — 대상으로 세우면 안 된다.
                throw new IllegalArgumentException("창형 판정 대상에는 창 시각이 필수다");
            }
        }

        /**
         * @return 창형(TIME_WINDOW)이면 true — 판정 소스·시각 계산·마감 규칙 분기가 전부 이 값으로 갈린다
         */
        public boolean windowed() {
            return type == MissionType.TIME_WINDOW;
        }
    }

    // ── 대상 해석 ────────────────────────────────────────────────────────

    /**
     * 이미 배치 로드해 둔 CTI 상세로 대상을 세운다 — 챌린지 카드처럼 상세를 IN 절로 한 번에 읽은
     * 호출측이 판정만 커널에 맡기도록(조회 N+1 없이 규칙 단일화). 목표를 모르면 empty 다:
     * 판정도 정산도 불가이므로 내기 게이트가 여기서 닫힌다.
      *
      * @param challenge 대상의 방식·카테고리 출처
      * @param duration 하루형 상세 — 창형이면 보지 않는다
      * @param window 창형 상세 — 하루형이면 보지 않는다
      * @return 판정 대상. 목표 분이나 창 시각이 없어 판정이 불가능하면 empty 이고,
      *     그 empty 가 곧 「내기를 걸 수 없는 챌린지」다
     */
    public static Optional<Target> targetOf(GroupChallenge challenge,
            GroupChallengeDuration duration, GroupChallengeWindow window) {
        if (challenge.getType() == MissionType.DURATION) {
            return Optional.ofNullable(duration)
                    .map(GroupChallengeDuration::getDurationMinutes)
                    .map(goal -> new Target(challenge.getId(), challenge.getCategory(),
                            MissionType.DURATION, goal, null, null));
        }
        if (challenge.getType() != MissionType.TIME_WINDOW || window == null
                || window.getDurationMinutes() == null
                || window.getWindowStart() == null || window.getWindowEnd() == null) {
            // 목표분 없는 구 창 챌린지·상세 유실은 판정 자체가 불가 — 내기 대상이 아니다.
            return Optional.empty();
        }
        // V35(GROMO-1406) 이후 창 시각은 KST 벽시계 time 이라 Instant→LocalTime 변환이 없다.
        return Optional.of(new Target(challenge.getId(), challenge.getCategory(),
                MissionType.TIME_WINDOW, window.getDurationMinutes(),
                window.getWindowStart(), window.getWindowEnd()));
    }

    /**
     * 내기 게이트 — {@code DURATION || (TIME_WINDOW && durationMinutes != null)}. 카테고리 제한은
     * 없다(전 조합 허용, 확정 정책). 개설·회차 생성처럼 <b>살아 있는 챌린지</b>를 기준으로 삼는
     * 경로 전용이다 — 이미 열린 회차의 판정은 {@link #ofSession} 을 쓴다.
      *
      * @param challenge 살아 있는 챌린지 — CTI 상세를 여기서 조회한다(방식에 맞는 쪽만 1회)
      * @return 판정 대상. 목표를 모르면 empty 이고 내기 게이트가 그 자리에서 닫힌다
     */
    public Optional<Target> resolve(GroupChallenge challenge) {
        GroupChallengeDuration duration = challenge.getType() == MissionType.DURATION
                ? groupChallengeDurationRepository.findById(challenge.getId()).orElse(null)
                : null;
        GroupChallengeWindow window = challenge.getType() == MissionType.TIME_WINDOW
                ? groupChallengeWindowRepository.findById(challenge.getId()).orElse(null)
                : null;
        return targetOf(challenge, duration, window);
    }

    /**
     * <b>회차 판정 대상 — 스냅샷이 정본이다</b>(GROMO-1263 · GROMO-1280). 카테고리·방식·목표분·창
     * 시각을 전부 회차 행에서 읽는다: 챌린지가 삭제되거나 CTI 상세가 사라져도, 그리고 챌린지 쪽
     * 값이 어떻게 바뀌어도 <b>이 회차의 판정 기준은 개설 시점에 고정</b>돼야 한다.
     *
     * <p>CTI 폴백은 스냅샷이 <b>결손인 행에만</b> 적용한다 — V39 백필 이전(V29 미만) 정산 이력은
     * {@code goal_minutes} 가 null 이다. 폴백조차 불가하면 empty(판정 불가)다.
      *
      * @param session 판정할 회차 — 기준은 이 행에 박제된 스냅샷이다
      * @return 회차 판정 대상. 스냅샷이 결손인 옛 행만 챌린지 CTI 로 폴백하고, 그것마저 없으면
      *     empty(판정 불가)다
     */
    public Optional<Target> ofSession(GroupChallengeBetSession session) {
        MissionCategory category = session.getMissionCategory();
        MissionType type = session.getMissionType();
        boolean windowed = type == MissionType.TIME_WINDOW;
        Integer goal = session.getGoalMinutes();
        LocalTime start = session.getWindowStart();
        LocalTime end = session.getWindowEnd();
        if (goal != null && (!windowed || (start != null && end != null))) {
            return Optional.of(new Target(session.getChallenge().getId(), category, type, goal,
                    windowed ? start : null, windowed ? end : null));
        }

        Optional<Target> cti = resolve(session.getChallenge());
        if (cti.isEmpty()) {
            return Optional.empty();
        }
        int resolvedGoal = goal != null ? goal : cti.get().goalMinutes();
        LocalTime resolvedStart = start != null ? start : cti.get().windowStart();
        LocalTime resolvedEnd = end != null ? end : cti.get().windowEnd();
        if (windowed && (resolvedStart == null || resolvedEnd == null)) {
            return Optional.empty();
        }
        return Optional.of(new Target(session.getChallenge().getId(), category, type, resolvedGoal,
                windowed ? resolvedStart : null, windowed ? resolvedEnd : null));
    }

    // ── 창 경계 ─────────────────────────────────────────────────────────

    /**
     * 날짜 {@code date}(KST)의 창 종료 시각 — 개설·참가 마감 판정용. DURATION 은 창이 없어 empty 다
     * (마감은 날짜 경계가 담당한다).
      *
      * @param target 판정 대상
      * @param date 회차 날짜(KST)
      * @return 그 날짜 창이 닫히는 순간. 하루형은 empty 이며, 이는 오류가 아니라
      *     「마감을 날짜 경계가 맡는다」는 뜻이다
     */
    public Optional<Instant> windowClosesAt(Target target, LocalDate date) {
        return target.windowed()
                ? Optional.of(WindowFocusAggregator.windowEndOn(date, target.windowEnd()))
                : Optional.empty();
    }

    /**
     * 날짜 {@code date}(KST)의 창 시작 시각 — 참가 철회(GROMO-1102)의 "시작 전" 판정용. DURATION 은
     * 창이 없어 empty 다(시작은 날짜 경계가 담당한다). zone 변환은
     * {@link WindowFocusAggregator#windowStartOn(LocalDate, LocalTime)} 하나만 지난다 — 창 시각
     * 해석의 단일 변환점 계약.
      *
      * @param target 판정 대상
      * @param date 회차 날짜(KST)
      * @return 그 날짜 창이 열리는 순간. 하루형은 empty 다
     */
    public Optional<Instant> windowOpensAt(Target target, LocalDate date) {
        return target.windowed()
                ? Optional.of(WindowFocusAggregator.windowStartOn(date, target.windowStart()))
                : Optional.empty();
    }

    // ── 진행분 ──────────────────────────────────────────────────────────

    /**
     * 유저별 진행분(조합별 소스). 값이 없는 유저는 <b>키가 없다</b> — FOCUS 는 0분, SCREEN_TIME 은
     * 미계측을 뜻하므로 의미가 달라 호출측이 {@link #achievedOrNull}/{@link #isAchieved} 로
     * 해석한다.
     *
     * <p>SCREEN_TIME 은 <b>측정 권한 동의자만</b> 대상이다 — 권한을 철회한 유저의 잔존 통계는 부분
     * 측정값이라 그걸로 판정하면 "측정 종료 = 승리"가 성립한다(클래스 주석 참고).
      *
      * @param target 판정 대상
      * @param date 진행분을 잴 날짜(KST)
      * @param users 대상 유저
      * @return 유저별 진행분. 값이 없는 유저는 키가 없고, 그 부재의 뜻은 카테고리마다 다르다 —
      *     FOCUS 는 0분이라는 사실, SCREEN_TIME 은 미계측이다
     */
    public Map<UUID, Integer> progressMinutes(Target target, LocalDate date, Collection<User> users) {
        return progressMinutes(List.of(target), date, users)
                .getOrDefault(target.challengeId(), Map.of());
    }

    /**
     * <b>배치판</b> — 대상 여러 개(챌린지별)의 진행분을 한 번에 낸다. 반환은 {@code challengeId →
     * (userId → 진행분)} 이고, 값이 없는 유저의 키가 없다는 3상 규약은 단건판과 같다.
     *
     * <p><b>왜 배치가 커널에 있나.</b> 그룹은 겹치지 않는 창형 챌린지를 최대 4개까지 굴린다(§A4).
     * 단건판을 챌린지마다 부르면 <b>호출마다</b> 같은 멤버의 측정 권한을 다시 읽고 창 보고값도
     * 챌린지별로 따로 읽어, 카드 한 번 그리는 데 권한 4회 + 보고값 4회가 나간다. 그렇다고 배치
     * 로딩을 호출부(카드 조립)로 되돌리면 판정 소스가 다시 두 벌이 된다 — 그래서 <b>모으는 일까지
     * 커널이 한다</b>. 소스별로 정확히 한 번씩만 읽는다:
     * <ul>
     *   <li>측정 권한({@link #measurableForScreenTime}) — SCREEN_TIME 대상이 하나라도 있을 때 1회.
     *       FOCUS 만 있는 그룹은 아예 읽지 않는다</li>
     *   <li>창 사용분 보고 — 창형 SCREEN_TIME 챌린지 전부를 IN 절 1회로</li>
     *   <li>일 집중·일 스크린타임 통계 — 각 1회(해당 조합 대상이 있을 때만)</li>
     *   <li>창 집중 클리핑 — 창 시각이 다르면 클리핑 범위가 달라 창별 1회다. 같은 창을 공유하는
     *       대상끼리는 재사용한다</li>
     * </ul>
     *
     * <p><b>권한 규칙은 우회로가 없다</b>(N50 · FR-21): SCREEN_TIME 진행분은 어느 분기로 가든
     * {@code measurable} 에서 유래하고, 동의자가 하나도 없으면 그 대상의 맵은 비어 있다 —
     * 미계측 → {@link #isAchieved} 가 미달성으로 닫는다. 배치 로드가 이 필터를 건너뛰는 분기는 없다.
      *
      * @param targets 판정 대상들 — 비면 소스를 하나도 읽지 않는다
      * @param date 진행분을 잴 날짜(KST)
      * @param users 대상 유저 — 비면 즉시 빈 맵이다
      * @return {@code challengeId → (userId → 진행분)}. 대상마다 키가 서고 값이 없는 유저의 키는 없다.
      *     SCREEN_TIME 은 측정 권한 동의자가 한 명도 없으면 그 대상의 맵이 통째로 빈다 — 잔존 통계로
      *     메우지 않는 것이 규칙이다
     */
    public Map<UUID, Map<UUID, Integer>> progressMinutes(
            Collection<Target> targets, LocalDate date, Collection<User> users) {
        if (targets.isEmpty() || users.isEmpty()) {
            return Map.of();
        }
        List<UUID> userIds = users.stream().map(User::getId).toList();

        // 스크린타임 권한은 조합·챌린지 수와 무관하게 한 번만 읽는다(N50).
        boolean anyScreenTime = targets.stream()
                .anyMatch(target -> target.category() == MissionCategory.SCREEN_TIME);
        List<User> measurable = anyScreenTime ? measurableForScreenTime(users) : List.of();

        Map<UUID, Map<UUID, Integer>> reportedByChallenge = Map.of();
        if (!measurable.isEmpty()) {
            List<UUID> windowChallengeIds = targets.stream()
                    .filter(target -> target.category() == MissionCategory.SCREEN_TIME && target.windowed())
                    .map(Target::challengeId)
                    .toList();
            if (!windowChallengeIds.isEmpty()) {
                reportedByChallenge = reportedWindowUsage(windowChallengeIds, date,
                        measurable.stream().map(User::getId).toList());
            }
        }

        Map<UUID, Integer> dailyFocus = targets.stream()
                .anyMatch(target -> target.category() == MissionCategory.FOCUS && !target.windowed())
                ? dailyFocusMinutes(userIds, date)
                : Map.of();

        Map<UUID, Integer> dailyScreenTime = !measurable.isEmpty() && targets.stream()
                .anyMatch(target -> target.category() == MissionCategory.SCREEN_TIME && !target.windowed())
                ? dailyScreenTimeMinutes(measurable, date)
                : Map.of();

        // 창 집중은 창 시각별로 클리핑이 달라 창당 1회다 — 같은 창을 쓰는 대상끼리만 재사용한다.
        Map<FocusWindow, Map<UUID, Integer>> windowFocus = new HashMap<>();

        Map<UUID, Map<UUID, Integer>> minutesByChallenge = new LinkedHashMap<>();
        for (Target target : targets) {
            Map<UUID, Integer> minutes;
            if (target.category() == MissionCategory.FOCUS) {
                minutes = target.windowed()
                        ? windowFocus.computeIfAbsent(
                                new FocusWindow(target.windowStart(), target.windowEnd()),
                                window -> windowFocusAggregator.focusMinutesWithin(
                                        userIds, date, window.start(), window.end()))
                        : dailyFocus;
            } else if (measurable.isEmpty()) {
                // 동의자 0명 — 잔존 통계를 쓰지 않는다(측정을 끄면 이긴다를 막는 지점).
                minutes = Map.of();
            } else {
                minutes = target.windowed()
                        ? reportedByChallenge.getOrDefault(target.challengeId(), Map.of())
                        : dailyScreenTime;
            }
            minutesByChallenge.put(target.challengeId(), minutes);
        }
        return minutesByChallenge;
    }

    /** 창 집중 클리핑 캐시 키 — 창 시각이 같으면 집계 쿼리도 같다. */
    private record FocusWindow(LocalTime start, LocalTime end) {
    }

    // ── 해석(3상) ───────────────────────────────────────────────────────

    /**
     * 표시용 진행분 — 3상 규칙(§B7)의 접기 지점. FOCUS 의 무기록은 "0분 집중"이라는 사실이므로 0 으로
     * 접고(FR-15), SCREEN_TIME 의 미계측은 0분 사용과 구분해야 하므로 null 로 남긴다(FR-16).
     * 카드의 {@code progressMinutes} 와 정산 근거({@code participant.progressMinutes})가 같은
     * 함수를 쓴다 — 화면의 "—" 와 결과의 "—" 가 같은 뜻이어야 하기 때문이다.
      *
      * @param target 접기 규칙을 정하는 카테고리의 출처
      * @param minutes 진행분. null 은 「진행분 맵에 키가 없었다」는 뜻이다
      * @return 화면에 그대로 쓸 값 — FOCUS 의 무기록은 0 으로 접히고, SCREEN_TIME 의 미계측은
      *     null(—) 로 남는다
     */
    public static Integer displayMinutes(Target target, Integer minutes) {
        if (minutes != null) {
            return minutes;
        }
        return target.category() == MissionCategory.FOCUS ? 0 : null;
    }

    /**
     * 3상 달성 판정 — FOCUS 는 "이상"(창은 5분 관용치), SCREEN_TIME 은 "이하"다.
     * <b>SCREEN_TIME 의 미계측은 {@code null}(판정 불가)</b>로 남는다: 아직 사용량을 모르는 상태와
     * "목표를 지켰다"는 확정은 다르다. 화면(카드·진행 리스트)이 이 판을 쓴다.
     *
     * @param target  판정 대상 — 카테고리가 부등호 방향을, 창형 여부가 관용치 적용을 정한다
     * @param minutes {@link #progressMinutes} 의 값. null 은 FOCUS 에선 0분, SCREEN_TIME 에선 미계측
     * @return 달성 여부. SCREEN_TIME 의 미계측만 null 이며, 그 null 은 「아직 모른다」이지
     *     「목표를 지켰다」가 아니다
     */
    public static Boolean achievedOrNull(Target target, Integer minutes) {
        if (target.category() == MissionCategory.SCREEN_TIME) {
            return minutes == null ? null : minutes <= target.goalMinutes();
        }
        int measured = minutes == null ? 0 : minutes;
        return target.windowed()
                ? WindowFocusAggregator.isAchieved(measured, target.goalMinutes())
                : measured >= target.goalMinutes();
    }

    /**
     * <b>확정</b> 달성 판정 — 3상의 {@code null}(판정 불가)을 <b>미달성으로 닫는다</b>. 근거는
     * FR-21: 판정 데이터가 정산 시각까지 도착하지 않으면 미달성으로 확정한다. 정산·참가 가드처럼
     * "지금 답을 내야만 하는" 경로 전용이고, 화면은 {@link #achievedOrNull} 을 써서 미계측을 그대로
     * 미계측으로 보여준다. 두 판이 같은 규칙에서 갈라지므로 카드와 정산이 어긋날 수 없다.
      *
      * @param target 판정 대상
      * @param minutes 진행분. null 은 무기록(FOCUS)이거나 미계측(SCREEN_TIME)이다
      * @return 확정 달성 여부 — 3상의 판정 불가는 여기서 미달성으로 닫힌다(FR-21)
     */
    public static boolean isAchieved(Target target, Integer minutes) {
        return Boolean.TRUE.equals(achievedOrNull(target, minutes));
    }

    /**
     * 잔여 코인을 받을 "성과 1위"의 방향 — FOCUS 는 진행분 최대, SCREEN_TIME 은 사용분 최소로 반대다
     * (같은 규칙을 쓰면 스크린타임 내기에서 제일 많이 쓴 승자가 잔여를 가져간다).
      *
      * @param target 카테고리의 출처
      * @return 잔여를 받을 승자를 고르는 방향 — SCREEN_TIME 만 「적게 쓴 쪽이 1위」로 뒤집힌다
     */
    public static GroupBetPayoutCalculator.RemainderRule remainderRule(Target target) {
        return target.category() == MissionCategory.SCREEN_TIME
                ? GroupBetPayoutCalculator.RemainderRule.LOWEST_PROGRESS
                : GroupBetPayoutCalculator.RemainderRule.HIGHEST_PROGRESS;
    }

    // ── 조합별 소스 ──────────────────────────────────────────────────────

    /**
     * 스크린타임을 <b>실제로 잴 수 있는</b> 유저 — 측정 권한 동의자(N50). 동의 기록이 없는 유저
     * (설정 행 자체가 없는 경우 포함)는 카드에서도 비참여자({@code canParticipate=false})다.
     */
    private List<User> measurableForScreenTime(Collection<User> users) {
        Set<UUID> granted = userQueryService
                .findAllScreenTimeSettings(users.stream().map(User::getId).toList()).stream()
                .filter(UserScreenTimeSettings::isScreenTimePermissionGranted)
                .map(UserScreenTimeSettings::getUserId)
                .collect(Collectors.toSet());
        return users.stream().filter(user -> granted.contains(user.getId())).toList();
    }

    /** 유저·날짜당 1행이지만, 혹시 여럿이면 최댓값으로 방어한다(카드 진행률과 같은 관례). */
    private Map<UUID, Integer> dailyFocusMinutes(List<UUID> userIds, LocalDate date) {
        Map<UUID, Integer> minutes = new HashMap<>();
        for (DailyFocusStat stat : dailyFocusStatRepository.findByUserIdInAndDate(userIds, date)) {
            minutes.merge(stat.getUser().getId(), stat.getTotalFocusSeconds() / 60, Integer::max);   // GROMO-642
        }
        return minutes;
    }

    /** 스크린타임도 유저·날짜당 1행이다. 중복 시 최댓값(= 더 많이 썼다고 보는 쪽)으로 방어한다. */
    private Map<UUID, Integer> dailyScreenTimeMinutes(Collection<User> users, LocalDate date) {
        Map<UUID, Integer> minutes = new HashMap<>();
        for (DailyScreenTimeStat stat : dailyScreenTimeStatRepository.findByUserInAndDate(users, date)) {
            // 미집계 row(minutes null, GROMO-1267)는 키를 만들지 않는다 — "행 없음"과 동일하게
            // 미보고로 해석돼 isAchieved 가 미달성으로 확정한다(FR-21 유지).
            if (stat.getTotalScreenTimeMinutes() != null) {
                minutes.merge(stat.getUser().getId(), stat.getTotalScreenTimeMinutes(), Integer::max);
            }
        }
        return minutes;
    }

    /**
     * 창 사용분 클라 보고값({@code group_challenge_members} 의 (챌린지, 유저, 날짜) 행) —
     * <b>챌린지 여러 개를 IN 절 1회</b>로 읽어 {@code challengeId → (userId → 분)} 으로 가른다.
     * 보고가 없는 유저는 키가 없다(= 미계측). {@code scope} 밖(권한 미동의)의 행은 버린다.
     */
    private Map<UUID, Map<UUID, Integer>> reportedWindowUsage(
            Collection<UUID> challengeIds, LocalDate date, Collection<UUID> userIds) {
        Set<UUID> scope = Set.copyOf(userIds);
        Map<UUID, Map<UUID, Integer>> byChallenge = new HashMap<>();
        for (GroupChallengeMember member : groupChallengeMemberRepository
                .findByGroupChallengeIdInAndUsageDate(challengeIds, date)) {
            UUID userId = member.getUser().getId();
            if (scope.contains(userId)) {
                // 프록시의 식별자 접근이라 챌린지 행을 다시 읽지 않는다(@Id 필드 접근).
                byChallenge.computeIfAbsent(member.getGroupChallenge().getId(), id -> new HashMap<>())
                        .merge(userId, member.getProgressMinutes(), Integer::max);
            }
        }
        return byChallenge;
    }
}
