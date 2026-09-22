package com.oneorthree.phone.quest.service;

import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.quest.repository.IslandQuestOccurrenceRepository;
import com.oneorthree.phone.quest.repository.domain.IslandQuestOccurrence;
import com.oneorthree.phone.quest.repository.domain.QuestType;
import com.oneorthree.phone.screentime.repository.ScreenTimeObservationRepository;
import com.oneorthree.phone.screentime.repository.domain.ScreenTimeObservation;
import com.oneorthree.phone.screentime.support.ScreenTimeDayPick;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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
 * <p><b>screen</b>(결정 Q-5 · GROMO-2001): 2.0 관측({@code screen_time_observations} — 저장 축이
 * <b>처음부터 UTC</b>라 회차 날짜와 같은 축이다)의 (주민, 회차 날짜) 값으로 판정한다. 그날의 값 하나를
 * 고르는 규칙은 {@link ScreenTimeDayPick} 에 있다 — 기기별 최신 하나(정정 업로드는 대체이지 합산이 아니다),
 * 같은 날 기기가 둘 이상이면 병합 정책 보류(RC-D02)라 측정 불가다.
 *
 * <p>고른 값의 판정은 넷으로 갈린다:
 * <ul>
 *   <li><b>상한 초과</b>({@code minutes > targetMinutes}) → 미달성 <b>확정</b>. 회차 날짜가 안 끝났어도
 *       그렇다 — 사용량은 줄지 않는다.</li>
 *   <li><b>상한 이하이고 회차 날짜(UTC)가 끝났다</b> → 달성. 측정된 0 도 달성이다(「실제 0」).</li>
 *   <li><b>상한 이하인데 날짜가 아직 안 끝났다</b> → 측정 대기({@code pending}) — 더 쓸 수 있어
 *       확정할 수 없다. 분모에는 남는다.</li>
 *   <li><b>권한 없음</b>({@code denied}) → 분모 밖. 「데이터 없음·권한 없음·실제 0은 구분한다」(기획 정본)
 *       라 {@code unavailable} 로 뭉개지 않는다.</li>
 *   <li><b>복수 기기</b> → 유예 없이 바로 측정 불가·분모 밖이다. 기다린다고 기기 수가 줄지 않으므로,
 *       「보고 대기」와 같이 다루면 그 주민이 유예 내내 분모에 남아 전원 달성을 혼자 막는다.</li>
 * </ul>
 * 관측이 없거나 {@code pending}·{@code unavailable} 이면 다음 날 12:00 UTC 유예까지 측정 대기,
 * 유예 뒤엔 측정 불가(분모 밖)다.
 */
@Component
@RequiredArgsConstructor
public class IslandQuestJudge {

    /** 정산 없이 끝난 세션(ABANDONED·소속 상실)은 세지 않는다. */
    private static final List<FocusSessionLifecycle> COUNTED_SESSIONS = List.of(
            FocusSessionLifecycle.ACTIVE, FocusSessionLifecycle.PAUSED, FocusSessionLifecycle.COMPLETED);
    private static final String AUTHORIZED = ScreenTimeDayPick.AUTHORIZED;
    private static final String PENDING = ScreenTimeDayPick.PENDING;
    private static final String UNAVAILABLE = ScreenTimeDayPick.UNAVAILABLE;

    private final IslandQuestOccurrenceRepository occurrences;
    private final GroupMemberRepository members;
    private final UserQueryService users;
    private final FocusSessionIntervalRepository intervals;
    private final ScreenTimeObservationRepository observations;

    /**
     * @param occurrence 판정할 회차
     * @param now        판정 시각
     * @return 주민별 결과(userId 오름차순)와 전원 달성·보너스 총액
     */
    public Judgement judge(IslandQuestOccurrence occurrence, Instant now) {
        Set<UUID> active = new HashSet<>(members.findActiveMemberUserIdsByGroupId(occurrence.getIslandId()));
        List<UUID> ids = occurrences.findCohort(occurrence.getId()).stream().filter(active::contains).toList();
        List<User> cohort = ids.isEmpty() ? List.of() : new ArrayList<>(users.findAllActive(ids));
        cohort.sort(Comparator.comparing(User::getId));

        List<Row> rows = occurrence.getType() == QuestType.FOCUS
                ? focus(occurrence, cohort, now)
                : screen(occurrence, cohort, now);
        return Judgement.of(occurrence, rows);
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
     * screen 판정 (GROMO-2001) — 규칙은 클래스 javadoc 에 있다.
     *
     * <p>회차 날짜가 <b>끝났는가</b>를 시각으로 본다({@code date+1 00:00Z}). 스크린타임에는 「오늘 보고를
     * 마쳤다」는 플래그가 없으므로(2.0 관측 모델에는 {@code isFinal} 이 없다) 그것이 유일하게 지어내지 않는
     * 마감 근거다. 날짜가 끝나기 전에 「상한 이하」를 달성으로 굳히면, 정오에 달성 판정을 받고 저녁에 상한을
     * 넘긴 주민이 보상을 받는다.
     *
     * @param now 판정 시각 — 회차 날짜 종료·유예 판정의 기준이다
     */
    List<Row> screen(IslandQuestOccurrence occurrence, List<User> cohort, Instant now) {
        Map<UUID, List<ScreenTimeObservation>> byUser = new HashMap<>();
        if (!cohort.isEmpty()) {
            for (ScreenTimeObservation observation : observations.findByUserIdInAndMeasuredDate(
                    cohort.stream().map(User::getId).toList(), occurrence.getOccurrenceDate())) {
                byUser.computeIfAbsent(observation.getUserId(), ignored -> new ArrayList<>()).add(observation);
            }
        }
        boolean dayOver = !now.isBefore(occurrence.getOccurrenceDate().plusDays(1)
                .atStartOfDay().toInstant(ZoneOffset.UTC));
        boolean graceOver = !now.isBefore(occurrence.screenGraceEndsAt());
        int cap = occurrence.getTargetMinutes();
        List<Row> rows = new ArrayList<>();
        for (User user : cohort) {
            ScreenTimeDayPick.Day day = ScreenTimeDayPick.of(byUser.getOrDefault(user.getId(), List.of()));
            rows.add(row(user, day, cap, dayOver, graceOver));
        }
        return rows;
    }

    private static Row row(User user, ScreenTimeDayPick.Day day, int cap, boolean dayOver, boolean graceOver) {
        if (day != null && day.measured()) {
            int used = day.minutes();
            if (used > cap) {
                // 사용량은 줄지 않는다 — 날짜가 안 끝났어도 미달성 확정이다.
                return new Row(user.getId(), user.getNickname(), cap * 100 / used, AUTHORIZED, true, false, false);
            }
            if (dayOver) {
                // 측정된 0 도 여기로 온다 — 「실제 0」은 달성이고 「보고 없음」과 구분된다.
                return new Row(user.getId(), user.getNickname(), 100, AUTHORIZED, true, true, false);
            }
            return new Row(user.getId(), user.getNickname(), 100, PENDING, true, false, true);
        }
        if (day != null && ScreenTimeDayPick.DENIED.equals(day.measurementStatus())) {
            // 권한 없음은 「측정 불가」와 다른 사실이다 — 유예를 기다릴 것도 없이 분모 밖이다.
            return new Row(user.getId(), user.getNickname(), null, ScreenTimeDayPick.DENIED, false, false, false);
        }
        if (day != null && day.conflicted()) {
            // 복수 기기 병합 보류(RC-D02) — 기다린다고 기기 수가 줄지 않으니 유예 없이 분모 밖이다.
            return new Row(user.getId(), user.getNickname(), null, UNAVAILABLE, false, false, false);
        }
        if (!graceOver) {
            return new Row(user.getId(), user.getNickname(), null, PENDING, true, false, true);
        }
        return new Row(user.getId(), user.getNickname(), null, UNAVAILABLE, false, false, false);
    }

    /**
     * 주민 한 명의 판정.
     *
     * @param measurementStatus {@code authorized|denied|unavailable|pending} (LLD §2 members 계약).
     *                 focus 는 언제나 {@code authorized} 다 — 집중 구간은 서버가 가진 사실이라 측정 실패가 없다
     * @param counted  분모에 드는가 — 측정 불가·권한 없음이면 false
     * @param achieved 목표 달성
     * @param pending  아직 판정할 수 없다(스크린타임 유예 중)
     */
    public record Row(UUID userId, String name, Integer rate, String measurementStatus, boolean counted,
                      boolean achieved, boolean pending) {
    }

    /**
     * 회차 판정 결과 — 수령 가능 여부는 주민마다 다르므로(GROMO-1991) 여기서 정하지 않는다.
     * 「내가 받을 수 있나」는 {@link #rowOf} 와 이미 받은 주민 목록을 합쳐 서비스가 판단한다.
     *
     * @param allAchieved 분모가 비어 있지 않고 전원이 달성했다 — 보너스 조건(0명 전원 성공 금지)
     * @param bonusReward 전원 달성 보너스 총액 — 분모 × 1인당 보너스(기획 정본 「대상 주민 수 × 5마리」)
     */
    public record Judgement(List<Row> rows, boolean allAchieved, int bonusReward) {

        static Judgement of(IslandQuestOccurrence occurrence, List<Row> rows) {
            List<Row> counted = rows.stream().filter(Row::counted).toList();
            long achievers = counted.stream().filter(Row::achieved).count();
            boolean allAchieved = !counted.isEmpty() && achievers == counted.size();
            return new Judgement(rows, allAchieved,
                    Math.multiplyExact(counted.size(), occurrence.getRewardBonusPerMember()));
        }

        /** 주민 한 명의 판정 — cohort 밖(방문자·뒤늦은 가입자)이면 비어 있다. */
        public Optional<Row> rowOf(UUID userId) {
            return rows.stream().filter(r -> r.userId().equals(userId)).findFirst();
        }
    }
}
