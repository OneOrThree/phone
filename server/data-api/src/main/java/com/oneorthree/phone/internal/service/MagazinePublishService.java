package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.internal.dto.IslandRankingViews.IslandRanking;
import com.oneorthree.phone.magazine.repository.IslandPromotionRepository;
import com.oneorthree.phone.magazine.repository.MagazineEditorialNoteRepository;
import com.oneorthree.phone.magazine.repository.MagazineIssueRepository;
import com.oneorthree.phone.magazine.repository.MagazineReceiptRepository;
import com.oneorthree.phone.magazine.repository.domain.IslandPromotion;
import com.oneorthree.phone.magazine.repository.domain.MagazineIssue;
import com.oneorthree.phone.magazine.support.IslandCard;
import com.oneorthree.phone.magazine.support.MagazineEditorial;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.Set;
import java.util.UUID;

/**
 * 고양이 잡지 07시 발행 (GROMO-2289, 잡지 구현 계획 §4-2) — 그날 호가 없으면 만든다. 스케줄러({@code
 * MagazinePublishScheduler})와 나뉘어 있어 테스트는 크론 없이 이것만 부른다({@code IslandFocusAverageSnapshotService} 와 같은
 * 구성).
 *
 * <h2>순서</h2>
 * <ol>
 *   <li>이미 그날 호가 있으면 끝 — 멱등의 첫 줄. 크론이 07:00~23:50 에 10분마다 불러도 하루 한 호다.</li>
 *   <li>7일 평균 스냅샷을 <b>먼저 직접</b> 부른다(자기 트랜잭션). 평균 배치도 07:00 이라 어느 쪽이 먼저 돌지 모르는데,
 *       평균은 {@code ON CONFLICT DO NOTHING} 이라 두 번 불려도 첫 값이 남는다 — 그래서 이 호의 평균이 «오늘 07시 값»
 *       으로 보장된다.</li>
 *   <li>한 트랜잭션: 편집부 칸(비공개 제외 주간 랭킹 1~3위 · 어제 새로 생긴 공개 섬 최대 3곳 · 편집부 소식/몽돌 팁) →
 *       그 호의 홍보 칸에 섬 숫자 고정(그 순간 비공개·닫힌 섬의 칸은 싣지 않는다 — 신청한 칸은 모두 실린다, 사전 검토
 *       없음) → 호 행 → 최근 7호보다 오래된 호의 받음 상태 정리 → 조간·석간 판단용 로그.</li>
 * </ol>
 * 같은 날 두 번째 발행은 {@code (issue_date, slot)}·{@code issue_no} 유일 제약이 한 번 더 막는다 — 겹친 쪽은 롤백되고
 * 다음 크론 틱에 1번에서 끝난다.
 *
 * <h2>기능 스위치</h2>
 * {@code magazine.enabled} 가 꺼져 있으면 발행하지 않는다. 신청·고치기가 닫힌 동안 빈 호가 쌓여 호수·7호 보관을 차지하지
 * 않게 하려는 것이다. 켜는 순간부터 그날 안의 다음 크론 틱이 그날 호를 낸다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MagazinePublishService {

    /** 편집부 랭킹·새 섬 칸 수(MAG-04 무료 칸). */
    static final int EDITORIAL_SLOTS = 3;
    /** 몽돌 집중 팁 문장 수 — 문장은 앱 번역 파일에 있다(계획 P18: 14개, 2주에 한 바퀴). */
    static final int TIP_COUNT = 14;
    /** 조간·석간 전환 판단(OPS-03) — 최근 7호가 모두 이 수 이상이면 경고 로그를 남긴다. */
    private static final int TWICE_DAILY_THRESHOLD = 10;

    private final MagazineIssueRepository issues;
    private final IslandPromotionRepository promotions;
    private final MagazineReceiptRepository receipts;
    private final MagazineEditorialNoteRepository editorialNotes;
    private final IslandFocusAverageSnapshotService averageSnapshots;
    private final IslandFocusAverageReader averages;
    private final IslandRankingsService rankings;
    private final GroupRepository islands;
    private final GroupMemberRepository members;
    private final IslandFacilityRepository facilities;
    private final PlatformTransactionManager transactionManager;
    private final Clock clock;

    @Value("${magazine.enabled:false}")
    private boolean enabled;

    /**
     * {@code issueDate} 호를 낸다.
     *
     * @param issueDate 호의 KST 날짜(크론이 도는 날)
     * @return 새로 낸 호. 스위치가 꺼져 있거나 이미 그날 호가 있으면 empty
     */
    public Optional<MagazineIssue> publish(LocalDate issueDate) {
        if (!enabled) {
            log.debug("고양이 잡지 스위치가 꺼져 있어 발행하지 않는다 date={}", issueDate);
            return Optional.empty();
        }
        if (issues.existsByIssueDate(issueDate)) {
            return Optional.empty();
        }
        averageSnapshots.snapshot(issueDate);
        // 평균 스냅샷(위)은 자기 트랜잭션으로 먼저 커밋한다 — 그 문장이 쥐는 섬 행 공유 잠금을 발행 내내 들고 있지 않게.
        // 발행은 한 스냅샷에서 읽는다(REPEATABLE READ) — 랭킹의 집중 합과 주민 수, 칸 숫자가 서로 다른 순간을 보면 어느
        // 순간에도 없던 값이 그 호에 영구히 고정된다. 그사이 같은 행이 다른 트랜잭션에서 바뀌면(신고 숨김 등) PostgreSQL 이
        // 직렬화 실패로 이 발행을 롤백하고, 10분 뒤 틱이 다시 낸다.
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        return Optional.ofNullable(transaction.execute(status -> compose(issueDate)));
    }

    private MagazineIssue compose(LocalDate issueDate) {
        Instant now = clock.instant();
        List<IslandRanking> ranked = rankings.publicTop(now, EDITORIAL_SLOTS);
        Instant todayStart = issueDate.atStartOfDay(ZonePolicy.KST).toInstant();
        List<Group> newIslands = islands.findPublicAliveCreatedBetween(
                issueDate.minusDays(1).atStartOfDay(ZonePolicy.KST).toInstant(), todayStart, EDITORIAL_SLOTS);
        List<IslandPromotion> requested = promotions.findByIssueDateOrderByAppliedAtAscIdAsc(issueDate);

        Set<UUID> islandIds = new LinkedHashSet<>();
        ranked.forEach(row -> islandIds.add(row.islandId()));
        newIslands.forEach(island -> islandIds.add(island.getId()));
        requested.forEach(promotion -> islandIds.add(promotion.getIslandId()));
        Map<UUID, IslandCard> cards = cards(islandIds);

        int published = 0;
        for (IslandPromotion promotion : requested) {
            IslandCard card = cards.get(promotion.getIslandId());
            if (card == null) {
                log.info("발행 순간 비공개·닫힌 섬의 홍보는 싣지 않는다 promotion={} island={}",
                        promotion.getId(), promotion.getIslandId());
                continue;
            }
            promotion.publish(card);
            published++;
        }

        int issueNo = issues.maxIssueNo() + 1;
        MagazineEditorial editorial = new MagazineEditorial(
                ranked.stream().filter(row -> cards.containsKey(row.islandId()))
                        .map(row -> new MagazineEditorial.Ranked(row.rank(), cards.get(row.islandId()))).toList(),
                newIslands.stream().map(island -> cards.get(island.getId())).filter(Objects::nonNull).toList(),
                editorialNotes.findById(issueDate)
                        .map(note -> MagazineEditorial.Note.editor(note.getBody()))
                        .orElseGet(() -> MagazineEditorial.Note.tip(issueNo % TIP_COUNT)));
        MagazineIssue issue = issues.save(new MagazineIssue(issueDate, issueNo, now, editorial, published));
        int forgotten = receipts.deleteOutsideLatestSeven();

        log.info("고양이 잡지 발행 date={} no={} 신청={} 실림={} 정리한 받음 상태={}",
                issueDate, issueNo, requested.size(), published, forgotten);
        warnIfTwiceDailyIsDue();
        return issue;
    }

    /**
     * 공개·살아 있는 섬의 발행 순간 숫자. 비공개·닫힌 섬은 결과에 없다 — 호출자가 «싣지 않음» 으로 읽는다.
     *
     * <p>평균은 방금 적은 오늘 스냅샷(없으면 가장 최근 행), 주민 수·완공 시설 수는 지금 값이다. 쿼리는 섬 수와 무관하게
     * 네 번이다.
     */
    private Map<UUID, IslandCard> cards(Set<UUID> islandIds) {
        Map<UUID, IslandCard> cards = new HashMap<>();
        if (islandIds.isEmpty()) {
            return cards;
        }
        Map<UUID, Long> memberCounts = new HashMap<>();
        members.countByGroupIdIn(islandIds).forEach(row -> memberCounts.put(row.getGroupId(), row.getMemberCount()));
        Map<UUID, Long> buildingCounts = new HashMap<>();
        facilities.countCompletedByIslandIdIn(islandIds)
                .forEach(row -> buildingCounts.put(row.getIslandId(), row.getBuildingCount()));
        Map<UUID, OptionalInt> latestAverages = averages.latest(islandIds);
        for (Group island : islands.findAllById(islandIds)) {
            if (!IslandMovementGuards.isAlive(island) || island.isPrivate()) {
                continue;
            }
            OptionalInt average = latestAverages.get(island.getId());
            cards.put(island.getId(), new IslandCard(island.getId(), island.getName(),
                    Math.toIntExact(buildingCounts.getOrDefault(island.getId(), 0L)),
                    Math.toIntExact(memberCounts.getOrDefault(island.getId(), 0L)), island.getMaxMembers(),
                    average.isPresent() ? average.getAsInt() : null));
        }
        return cards;
    }

    /** 조간·석간 전환 기준(OPS-03) — v1 은 판단용 경고 로그 한 줄뿐이다. */
    private void warnIfTwiceDailyIsDue() {
        List<MagazineIssue> latest = issues.findTop7ByOrderByIssueNoDesc();
        boolean busyWeek = latest.size() == 7
                && latest.stream().allMatch(issue -> issue.getPromotionCount() >= TWICE_DAILY_THRESHOLD);
        if (busyWeek) {
            log.warn("고양이 잡지 조간·석간 전환 기준 충족 — 최근 7호의 홍보가 모두 {}건 이상이다", TWICE_DAILY_THRESHOLD);
        }
    }
}
