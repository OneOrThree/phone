package com.oneorthree.phone.quest.service;

import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.quest.dto.QuestViews;
import com.oneorthree.phone.quest.repository.IslandQuestOccurrenceRepository;
import com.oneorthree.phone.quest.repository.domain.IslandQuestOccurrence;
import com.oneorthree.phone.quest.repository.domain.QuestType;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.screentime.repository.domain.DailyScreenTimeStat;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 회차 판정 (GROMO-1773, LLD §4) — 전체 cohort 에 대한 서버 집계다. 화면 페이지와 무관하다(Q04).
 *
 * <p><b>판정 대상</b>(결정 Q-3): 회차 시작 때 고정한 cohort ∩ 지금 활성 주민 ∩ 활성 계정. 뒤늦은 가입자는
 * cohort 에 없고, 탈퇴·강퇴·계정 탈퇴자는 교집합에서 빠진다. 측정 불가 주민(스크린타임 유예 뒤에도 판정할
 * 값이 없는 주민)은 목록에는 남지만 분모에서 빠진다. 분모가 0 이면 전원 달성이 아니다 — 0명 전원 성공 금지.
 *
 * <p><b>focus</b>(결정 Q-5): 그 섬에 귀속된 세션의 ACTIVE 구간만, 회차 창(UTC)에 잘라, 마이크로초로 더한 뒤
 * 초 단위로 내려 목표분×60 과 정확히 비교한다. 관용치 없음, REST 제외. 진행 중 구간은 지금까지만 센다.
 *
 * <p><b>screen</b>(결정 Q-5 — <b>1930 전까지 비활성</b>, 지금은 {@link #unsupported}): 하루 값
 * ({@code daily_screen_time_stats} 의 (주민, 회차 날짜) 한 행 — 복수 기기 병합은 ticket 1806 미결이라 기존 단일
 * 값을 쓴다)이 상한 이하이고 그날 마감 보고가 왔으면 달성, 상한을 넘었으면 미달성(사용량은 줄지 않는다). 그 밖은 다음 날 12:00 UTC 유예까지 측정 대기, 유예 뒤엔 측정 불가다.
 */
@Component
@RequiredArgsConstructor
public class IslandQuestJudge {

    /** 정산 없이 끝난 세션(ABANDONED·소속 상실)은 세지 않는다. */
    private static final List<FocusSessionLifecycle> COUNTED_SESSIONS = List.of(
            FocusSessionLifecycle.ACTIVE, FocusSessionLifecycle.PAUSED, FocusSessionLifecycle.COMPLETED);
    private static final String AUTHORIZED = "authorized";
    private static final String PENDING = "pending";
    private static final String UNAVAILABLE = "unavailable";

    private final IslandQuestOccurrenceRepository occurrences;
    private final GroupMemberRepository members;
    private final UserQueryService users;
    private final FocusSessionIntervalRepository intervals;
    private final DailyScreenTimeStatRepository screenStats;

    /**
     * @param occurrence 판정할 회차
     * @param now        판정 시각
     * @return 주민별 결과(userId 오름차순)와 회차 수령 가능 여부
     */
    public Judgement judge(IslandQuestOccurrence occurrence, Instant now) {
        Set<UUID> active = new HashSet<>(members.findActiveMemberUserIdsByGroupId(occurrence.getIslandId()));
        List<UUID> ids = occurrences.findCohort(occurrence.getId()).stream().filter(active::contains).toList();
        List<User> cohort = ids.isEmpty() ? List.of() : new ArrayList<>(users.findAllActive(ids));
        cohort.sort(Comparator.comparing(User::getId));

        List<Row> rows = occurrence.getType() == QuestType.FOCUS
                ? focus(occurrence, cohort, now)
                : unsupported(cohort);
        return Judgement.of(occurrence, rows);
    }

    /**
     * screen 은 아직 판정하지 않는다 — 스크린타임 하루 값의 {@code date} 가 KST 라벨이라 UTC 회차 날짜로 읽으면 측정
     * 창이 9시간 밀린다. 생성·수정은 서비스가 422 로 막으므로 이 분기는 방어선이다: 전원 측정 불가(분모 0)라 수령할
     * 수 없다. 1930 에서 저장 축이 UTC 가 되면 {@link #screen} 으로 되돌린다.
     */
    private static List<Row> unsupported(List<User> cohort) {
        return cohort.stream()
                .map(user -> new Row(user.getId(), user.getNickname(), null, UNAVAILABLE, false, false, false))
                .toList();
    }

    private List<Row> focus(IslandQuestOccurrence occurrence, List<User> cohort, Instant now) {
        Instant start = occurrence.windowStartAt();
        Instant end = occurrence.windowEndAt();
        Instant openUntil = now.isBefore(end) ? now : end;
        Map<UUID, Duration> active = new HashMap<>();
        if (!cohort.isEmpty() && now.isAfter(start)) {
            List<UUID> ids = cohort.stream().map(User::getId).toList();
            for (FocusSessionIntervalRepository.ActiveSpan span : intervals.findActiveSpansOnIsland(
                    occurrence.getIslandId(), ids, COUNTED_SESSIONS, start, end)) {
                Instant from = span.getStartedAt().isAfter(start) ? span.getStartedAt() : start;
                Instant to = span.getEndedAt() == null ? openUntil
                        : span.getEndedAt().isBefore(end) ? span.getEndedAt() : end;
                if (to.isAfter(from)) {
                    active.merge(span.getUserId(), Duration.between(from, to), Duration::plus);
                }
            }
        }
        long targetSeconds = occurrence.getTargetMinutes() * 60L;
        List<Row> rows = new ArrayList<>();
        for (User user : cohort) {
            long seconds = active.getOrDefault(user.getId(), Duration.ZERO).getSeconds();
            int rate = (int) Math.min(100, seconds * 100 / targetSeconds);
            rows.add(new Row(user.getId(), user.getNickname(), rate, AUTHORIZED, true,
                    seconds >= targetSeconds, false));
        }
        return rows;
    }

    /**
     * 1930(스크린타임 저장 축 UTC 전환) 뒤에 쓸 screen 판정 — 지금은 호출하지 않는다({@link #unsupported}).
     * 전환 전에는 {@code occurrenceDate} 와 같은 라벨의 KST 하루 값을 읽게 되어 9시간 어긋난다.
     */
    List<Row> screen(IslandQuestOccurrence occurrence, List<User> cohort, Instant now) {
        Map<UUID, DailyScreenTimeStat> byUser = new HashMap<>();
        if (!cohort.isEmpty()) {
            for (DailyScreenTimeStat stat : screenStats.findByUserInAndDate(cohort, occurrence.getOccurrenceDate())) {
                byUser.put(stat.getUser().getId(), stat);
            }
        }
        boolean graceOver = !now.isBefore(occurrence.screenGraceEndsAt());
        int cap = occurrence.getTargetMinutes();
        List<Row> rows = new ArrayList<>();
        for (User user : cohort) {
            DailyScreenTimeStat stat = byUser.get(user.getId());
            Integer used = stat == null ? null : stat.getTotalScreenTimeMinutes();
            if (used != null && used > cap) {
                rows.add(new Row(user.getId(), user.getNickname(), cap * 100 / used, AUTHORIZED, true, false, false));
            } else if (used != null && stat.isScreenTimeFinalized()) {
                rows.add(new Row(user.getId(), user.getNickname(), 100, AUTHORIZED, true, true, false));
            } else if (!graceOver) {
                rows.add(new Row(user.getId(), user.getNickname(), used == null ? null : 100, PENDING, true, false,
                        true));
            } else {
                rows.add(new Row(user.getId(), user.getNickname(), null, UNAVAILABLE, false, false, false));
            }
        }
        return rows;
    }

    /**
     * 주민 한 명의 판정.
     *
     * @param counted  분모에 드는가 — 측정 불가면 false
     * @param achieved 목표 달성
     * @param pending  아직 판정할 수 없다(스크린타임 유예 중)
     */
    public record Row(UUID userId, String name, Integer rate, String measurementStatus, boolean counted,
                      boolean achieved, boolean pending) {
    }

    /**
     * 회차 판정 결과.
     *
     * @param potentialReward 전원 달성 시 섬 통장 적립량 — 분모 × (개인 달성 + 보너스)
     * @param claimable       미정산이고 분모 전원이 달성했다
     * @param blockedReason   수령 불가 사유(수령 가능·정산 완료면 null)
     */
    public record Judgement(List<Row> rows, int potentialReward, boolean claimable, String blockedReason) {

        static Judgement of(IslandQuestOccurrence occurrence, List<Row> rows) {
            List<Row> counted = rows.stream().filter(Row::counted).toList();
            long achievers = counted.stream().filter(Row::achieved).count();
            boolean allAchieved = !counted.isEmpty() && achievers == counted.size();
            // 결정 Q-1: 개인 달성 +10 × 달성자 + 전원 달성 보너스 분모 × 5. 수령은 전원 달성일 때만이라
            // 달성자 = 분모이고, 결국 분모 × (10 + 5) 다.
            int potential = Math.multiplyExact(counted.size(),
                    occurrence.getRewardPerAchiever() + occurrence.getRewardBonusPerMember());
            if (occurrence.isClaimed()) {
                return new Judgement(rows, potential, false, null);
            }
            if (allAchieved) {
                return new Judgement(rows, potential, true, null);
            }
            boolean definitelyShort = counted.stream().anyMatch(r -> !r.achieved() && !r.pending());
            boolean pending = counted.stream().anyMatch(Row::pending);
            String reason = !definitelyShort && pending
                    ? QuestViews.BLOCKED_MEASUREMENT_PENDING
                    : QuestViews.BLOCKED_MEMBERS_INCOMPLETE;
            return new Judgement(rows, potential, false, reason);
        }
    }
}
