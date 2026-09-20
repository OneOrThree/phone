package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.UserIslandContextRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.UserIslandContext;
import com.oneorthree.phone.internal.dto.IslandRankingViews.IslandRanking;
import com.oneorthree.phone.internal.dto.IslandRankingViews.IslandRankingPage;
import com.oneorthree.phone.ranking.repository.IslandWeeklyMemberCountRepository;
import com.oneorthree.phone.ranking.support.RankingWeek;
import com.oneorthree.phone.stats.exception.StatsErrorCode;
import com.oneorthree.phone.stats.exception.StatsException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 주간 섬 랭킹 (GROMO-1997, island-rankings LLD) — 전망대의 섬 간 순위.
 *
 * <p><b>평균 = 그 섬에서 집중한 시간 합계 ÷ 그 섬 전체 주민 수</b>이고 다른 섬에서 집중한 시간은 빠진다
 * (기획 정본 2026-09-14 「섬 가입·전망대·랭킹」). 주는 <b>UTC 일요일 00:00Z ~ 다음 일요일</b>이며
 * ({@link RankingWeek}) 식별자는 ISO {@code YYYY-Www} 가 아니라 <b>주 시작일</b>이다 — ISO 주차는 월요일
 * 시작이 정의의 일부라 요일만 바꿔 쓰면 같은 문자열이 다른 7일을 뜻하게 된다.
 *
 * <p><b>주민 랭킹은 없다.</b> {@code GET /islands/{islandId}/rankings/members} 는 2026-09-16 결정 B23·B15 로
 * 엔드포인트 자체가 폐기됐다(「전망대는… 우리 섬 내부 주민 랭킹은 제공하지 않는다」). 남은 것은 섬 간 랭킹뿐이다.
 *
 * <h2>왜 스냅샷 저장소가 없나</h2>
 * LLD §4 는 불변 snapshot·사용자 역색인·탈퇴와의 공통 lifecycle 잠금을 요구했지만, 그 장치는 전부
 * <b>「표에 복사된 타인의 개인정보」</b>를 지키려는 것이었다. 이 응답에는 섬 이름과 평균 초밖에 없다 — 사용자
 * 이름도, catColor 도, 개인 점수도 없다. 2026-09-19 결정 RC-P12-적용이 회관 기록에서 같은 판단을 내렸다:
 * 「복사본이 없으면 필요 없다」. 그래서 잠금·역색인·스냅샷 표를 만들지 않는다.
 *
 * <p>대신 <b>페이지를 만들지 않는다</b> — 상위 {@code limit} 개(최대 {@value #MAX_LIMIT})만 싣고
 * {@code nextCursor} 는 언제나 없다. 움직이는 집계에 keyset 을 붙이면 페이지 사이에 행이 빠지거나 겹치는데
 * (LLD §4), 페이지가 없으면 그 문제 자체가 없다. 목록에서 잘린 사용자도 {@code myRank} 로 자기 섬의 순위를
 * <b>전체 모집단</b> 기준으로 받는다.
 *
 * <p>집중·소속·시설·컨텍스트를 함께 읽는 조합이라 L10 internal 에 둔다.
 */
@Service
@RequiredArgsConstructor
public class IslandRankingsService {

    /** 공개 목록 기본 크기 — A0 기본값과 같다. */
    public static final int DEFAULT_LIMIT = 30;
    /** 공개 목록 상한. 이보다 아래 순위는 목록으로 주지 않고 {@code myRank} 로만 알려 준다. */
    public static final int MAX_LIMIT = 100;

    /** PostgreSQL uuid 순서(부호 없는 바이트)와 같다 — 동점의 «표시 순서»만 고정하는 보조 키다. */
    private static final Comparator<UUID> UUID_ORDER = Comparator.comparing(UUID::toString);

    private final UserQueryService users;
    private final GroupQueryService groups;
    private final GroupRepository islands;
    private final GroupMemberRepository members;
    private final UserIslandContextRepository contexts;
    private final IslandMovementGuards guards;
    private final FocusSessionDetailRepository details;
    private final IslandWeeklyMemberCountRepository denominators;
    private final Clock clock;

    /**
     * 섬 간 주간 랭킹.
     *
     * <p>한 스냅샷에서 읽도록 REPEATABLE READ 다 — 분자(집중 합)와 분모(주민 수)를 두 SELECT 로 읽는 사이
     * 누가 집중을 끝내거나 섬을 나가도 같은 순간을 본다. 같은 표에서 {@code items}·{@code myRank} 가 함께 나오므로
     * 「목록의 1위와 내 순위가 서로 다른 시점」이 생기지 않는다(RK-P06).
     *
     * @param userId 조회자 — 현재 섬의 전망대가 열려 있어야 한다
     * @param week   조회할 주의 시작일(UTC 일요일). 아직 오지 않은 주는 422 다
     * @param limit  목록 크기. {@code null} 이면 {@value #DEFAULT_LIMIT}, 범위 밖은 잘라 맞춘다
     *               (공개 범위 검증은 Business 몫이고 여기는 내부 표면이다)
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public IslandRankingPage islands(UUID userId, LocalDate week, Integer limit) {
        Instant asOf = clock.instant();
        LocalDate currentWeek = RankingWeek.weekStart(asOf);
        if (!RankingWeek.isWeekStart(week) || week.isAfter(currentWeek)) {
            throw new StatsException(StatsErrorCode.RANKING_WEEK_OUT_OF_RANGE);
        }
        UUID myIsland = requireObservatory(userId);

        // 참가 모집단 = 그 주에 «이 섬에 귀속된 완료 집중»이 있었던 섬. 집중이 0인 섬을 0점으로 줄 세우지 않는다
        // (RK-D06 「분모가 0이면 숫자 0을 임의 순위 점수로 만들지 않는다」와 같은 결). 모수가 이 집계 결과라
        // 이어지는 분모·이름 조회도 자연히 유한하다.
        Map<UUID, Long> focus = new HashMap<>();
        details.sumIslandActiveSeconds(RankingWeek.startInstant(week), RankingWeek.endInstant(week))
                .forEach(row -> focus.put(row.getIslandId(), row.getSeconds()));

        List<IslandRanking> ranked = rank(focus, denominators(week, currentWeek, focus.keySet()),
                names(focus.keySet()));
        Integer myRank = ranked.stream().filter(item -> item.islandId().equals(myIsland))
                .map(IslandRanking::rank).findFirst().orElse(null);
        int size = limit == null ? DEFAULT_LIMIT : Math.min(Math.max(limit, 1), MAX_LIMIT);
        return new IslandRankingPage(week.toString(), ranked.subList(0, Math.min(size, ranked.size())), myRank, asOf);
    }

    /**
     * 전망대 게이트 — 살아 있는 현재 섬의 활성 주민 + 전망대 완공(RK-P02, {@code island-rankings} LLD §2).
     *
     * <p>현재 섬은 Data 가 가진 {@code user_island_contexts.current_island_id} 한 곳에서만 온다. 앱이 헤더로
     * 보낸 섬을 권한으로 믿으면 시설 조건을 우회할 수 있다.
     *
     * @return 요청자의 현재 섬 — {@code myRank} 의 대상이다
     */
    private UUID requireObservatory(UUID userId) {
        User caller = users.getCaller(userId);
        UUID islandId = contexts.findById(userId).map(UserIslandContext::getCurrentIslandId).orElse(null);
        if (islandId == null) {
            // 현재 섬이 없으면 설 수 있는 전망대도 없다 — 「어느 섬의 주민으로서」 보는 화면이다.
            throw new GroupException(GroupErrorCode.MEMBER_ONLY);
        }
        Group island = groups.getGroup(islandId);
        IslandMovementGuards.requireAlive(island);
        groups.getMembership(caller, island);
        guards.requireObservatoryUnlocked(islandId);
        return islandId;
    }

    /**
     * 그 주의 분모.
     *
     * <p>진행 중인 주는 아직 동결할 것이 없으므로 <b>지금</b> 인원으로 나눈다. 끝난 주는 V85 에 동결된 값만
     * 쓴다 — 행이 없는 섬은 랭킹에서 빠진다. 「없으면 지금 인원으로」 라는 대체 경로를 두지 않는 것이 핵심이다:
     * 그 경로가 있으면 주민을 내보내 분모를 줄이는 조작이 그대로 살아난다.
     */
    private Map<UUID, Integer> denominators(LocalDate week, LocalDate currentWeek, Set<UUID> candidates) {
        Map<UUID, Integer> result = new HashMap<>();
        if (candidates.isEmpty()) {
            return result;
        }
        if (week.equals(currentWeek)) {
            members.countByGroupIdIn(candidates)
                    .forEach(row -> result.put(row.getGroupId(), Math.toIntExact(row.getMemberCount())));
            return result;
        }
        denominators.findByWeekStart(week).stream()
                .filter(row -> candidates.contains(row.getIslandId()))
                .forEach(row -> result.put(row.getIslandId(), row.getMemberCount()));
        return result;
    }

    /** 살아 있는 섬의 이름만 — 소프트 삭제·종료된 섬은 「없는 섬」이라 랭킹에도 없다. */
    private Map<UUID, String> names(Set<UUID> candidates) {
        Map<UUID, String> result = new HashMap<>();
        islands.findAllById(candidates).stream()
                .filter(IslandMovementGuards::isAlive)
                .forEach(island -> result.put(island.getId(), island.getName()));
        return result;
    }

    /**
     * 평균을 내고 순위를 매긴다.
     *
     * <p><b>평균을 먼저 정수로 내린 뒤 그 값으로 줄 세운다</b> — 표시값과 정렬 키가 같아야 「화면에는 같은
     * 숫자인데 순위가 다른」 줄이 생기지 않는다(LLD §3). 주민마다 분으로 내려 평균내지 않고, 정확한 초 합을
     * 분모로 나눈다.
     *
     * <p>동점은 <b>공동 순위</b>다 — 1,1,3 (SQL {@code RANK()} 와 같다, 2026-09-21 결정). UUID 오름차순은 같은
     * 점수 안의 «표시 순서»만 고정하는 보조 키이지 순위를 가르는 기준이 아니다.
     */
    private static List<IslandRanking> rank(Map<UUID, Long> focus, Map<UUID, Integer> denominators,
                                            Map<UUID, String> names) {
        List<Entry> entries = new ArrayList<>();
        focus.forEach((islandId, seconds) -> {
            Integer memberCount = denominators.get(islandId);
            String name = names.get(islandId);
            if (memberCount != null && memberCount > 0 && name != null) {
                entries.add(new Entry(islandId, name, seconds / memberCount));
            }
        });
        entries.sort(Comparator.comparingLong(Entry::average).reversed().thenComparing(Entry::islandId, UUID_ORDER));
        List<IslandRanking> ranked = new ArrayList<>(entries.size());
        int rank = 0;
        long previous = -1;
        for (int index = 0; index < entries.size(); index++) {
            Entry entry = entries.get(index);
            if (index == 0 || entry.average() != previous) {
                // 동점 다음은 «건너뛴» 순위다 — 공동 1위가 둘이면 그다음은 3위다.
                rank = index + 1;
                previous = entry.average();
            }
            ranked.add(new IslandRanking(rank, entry.islandId(), entry.name(), entry.average()));
        }
        return ranked;
    }

    /** 순위를 매기기 전의 섬 한 줄 — 평균은 이미 정수로 내려 둔 «표시값 겸 정렬 키»다. */
    private record Entry(UUID islandId, String name, long average) {
    }
}
