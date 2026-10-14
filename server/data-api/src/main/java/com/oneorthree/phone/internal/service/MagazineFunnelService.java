package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.internal.dto.MagazineViews;
import com.oneorthree.phone.magazine.repository.IslandPromotionFunnelRepository;
import com.oneorthree.phone.magazine.repository.IslandPromotionRepository;
import com.oneorthree.phone.magazine.repository.MagazineIssueRepository;
import com.oneorthree.phone.magazine.repository.domain.IslandPromotion;
import com.oneorthree.phone.magazine.repository.domain.IslandPromotionFunnel;
import com.oneorthree.phone.magazine.repository.domain.MagazineIssue;
import com.oneorthree.phone.magazine.support.MagazineCalendar;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 잡지 경유 행동과 회관 홍보 기록판 (GROMO-2289, 잡지 구현 계획 §3-11·§3-13·§6-5, AD-11) — 잡지 칸에서 망원경에 넣은 사람
 * (PIN), 그 사람이 항해해 도착(ARRIVE)·가입(JOIN)한 것을 홍보마다 센다.
 *
 * <h2>창은 현재 호다</h2>
 * 「실린 날 07시~다음 날 07시에 잡지를 거쳐 온 행동만」(정본 155행) — 그 호가 가장 최근 호이고 다음 날 07:00 KST 전일 때만
 * 센다({@link #currentIssue}). PIN 은 현재 호에 보이는 그 섬의 칸에서만 남고, 도착·가입은 그 섬의 현재 호 칸에 PIN 을 남긴
 * 사람만 센다. 가입은 성립한 시각(승인제는 승인 시각) 기준이다(계획 P9). 바다 화면 전에는 잡지에서 핀을 넣는 동그라미가
 * 없어(10/14 확정 — 섬에서 본 잡지에는 동그라미 없음) 숫자는 0 이다.
 *
 * <p>쓰기는 모두 호출자의 트랜잭션에 합류한다({@code MANDATORY}) — 핀 넣기·도착·가입이 롤백되면 기록도 남지 않는다. 행은
 * 같은 사람의 같은 단계가 한 번만 생긴다(PK + {@code ON CONFLICT DO NOTHING}).
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MagazineFunnelService {

    /** 기록판 상한 — 기본값(20)은 Business 의 몫이다. 섬당 홍보는 하루 1건이라 50건이면 약 두 달치다. */
    private static final int MAX_RECORDS = 50;

    private final UserQueryService users;
    private final GroupQueryService groups;
    private final MagazineIssueRepository issues;
    private final IslandPromotionRepository promotions;
    private final IslandPromotionFunnelRepository funnel;
    private final Clock clock;

    /** 현재 호 — 가장 최근 호이면서 다음 날 07:00 KST 전. 발행이 늦어져 보이는 어제 호는 현재 호가 아니다. */
    public Optional<MagazineIssue> currentIssue(Instant now) {
        return issues.findFirstByOrderByIssueNoDesc()
                .filter(issue -> now.isBefore(MagazineCalendar.currentUntil(issue.getIssueDate())));
    }

    /**
     * 잡지 칸에서 망원경에 넣었다 — 그 홍보가 이 섬의 것이고 현재 호에 보이는 칸일 때만 남긴다. 틀린 값은 집계만 건너뛴다
     * (정상 경로에서는 오지 않는 값이라 핀 넣기를 실패로 막을 이유가 없다).
     *
     * @return 센 홍보 칸이면 true — 핀 행에 그 칸을 남길지(말풍선 미리보기)도 같은 판정을 따른다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean recordPin(UUID userId, UUID islandId, UUID promotionId, Instant now) {
        Optional<IslandPromotion> counted = currentIssue(now)
                .flatMap(issue -> promotions.findByIdAndIslandId(promotionId, islandId)
                        .filter(promotion -> promotion.getIssueDate().equals(issue.getIssueDate())
                                && promotion.isShown()));
        counted.ifPresent(promotion -> funnel.insertIfAbsent(promotion.getId(), userId, IslandPromotionFunnel.PIN,
                now));
        return counted.isPresent();
    }

    /** 항해해 도착했다 — 그 섬의 현재 호 칸에 PIN 을 남긴 사람이면 센다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordArrival(UUID userId, UUID islandId, Instant now) {
        recordAfterPin(userId, islandId, IslandPromotionFunnel.ARRIVE, now);
    }

    /** 가입이 성립했다(바로 가입·승인) — 그 섬의 현재 호 칸에 PIN 을 남긴 사람이면 센다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordJoin(UUID userId, UUID islandId, Instant now) {
        recordAfterPin(userId, islandId, IslandPromotionFunnel.JOIN, now);
    }

    /**
     * 회관 홍보 기록판 — 이 섬의 홍보, 최신 호 먼저. 주민만 본다(게스트 주민 포함). 비주민은 403 {@code MEMBER_ONLY} 이고 공개 API 에서는 Business 가
     * 403 {@code FORBIDDEN}(field {@code islandId})으로 옮긴다. 숫자는
     * 읽을 때마다 센다(「실시간」). 「회관 안에서만」은 앱 화면 위치 규칙이다.
     *
     * <p>한 스냅샷에서 읽는다(REPEATABLE READ) — 칸·호·숫자를 따로 읽는 사이에 발행이 커밋되면 「호는 있는데 칸은 실리지
     * 않음」 처럼 어느 순간에도 없던 상태(SKIPPED)가 섞인다.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public MagazineViews.RecordPage records(UUID userId, UUID islandId, int limit) {
        if (limit < 1 || limit > MAX_RECORDS) {
            throw new GroupException(GroupErrorCode.INVALID_PAGE_REQUEST);
        }
        User caller = users.getCaller(userId);
        Group island = groups.getGroup(islandId);
        IslandMovementGuards.requireAlive(island);
        groups.getMembership(caller, island);

        List<IslandPromotion> rows = promotions.findByIslandIdOrderByIssueDateDesc(islandId, PageRequest.of(0, limit));
        if (rows.isEmpty()) {
            return new MagazineViews.RecordPage(List.of());
        }
        Map<LocalDate, Integer> issueNos = issues.findByIssueDateIn(rows.stream().map(IslandPromotion::getIssueDate)
                        .toList()).stream()
                .collect(Collectors.toMap(MagazineIssue::getIssueDate, MagazineIssue::getIssueNo));
        Map<UUID, Map<String, Long>> counts = new HashMap<>();
        funnel.countByPromotionIdIn(rows.stream().map(IslandPromotion::getId).toList())
                .forEach(row -> counts.computeIfAbsent(row.getPromotionId(), id -> new HashMap<>())
                        .put(row.getStep(), row.getPeople()));
        LocalDate today = LocalDate.now(clock.withZone(ZonePolicy.KST));
        return new MagazineViews.RecordPage(rows.stream().map(promotion -> {
            Map<String, Long> steps = counts.getOrDefault(promotion.getId(), Map.of());
            return new MagazineViews.RecordItem(promotion.getId(), promotion.getIssueDate(),
                    issueNos.get(promotion.getIssueDate()), promotion.getBody(), promotion.getLayout(),
                    status(promotion, issueNos.containsKey(promotion.getIssueDate()), today),
                    Math.toIntExact(steps.getOrDefault(IslandPromotionFunnel.PIN, 0L)),
                    Math.toIntExact(steps.getOrDefault(IslandPromotionFunnel.ARRIVE, 0L)),
                    Math.toIntExact(steps.getOrDefault(IslandPromotionFunnel.JOIN, 0L)));
        }).toList());
    }

    /**
     * 기록판 상태 — 신고 숨김·내림이 먼저다. 호가 나왔으면 실렸나(snapshot)로 PUBLISHED·SKIPPED, 아직 안 나왔으면 그 호의
     * 날이 지나기 전까지 SCHEDULED(그날 23:50 까지 발행을 다시 시도한다), 날이 지났으면 발행 실패로 SKIPPED 다.
     */
    private static MagazineViews.RecordStatus status(IslandPromotion promotion, boolean issued, LocalDate today) {
        if (IslandPromotion.MODERATION_HIDDEN.equals(promotion.getModeration())) {
            return MagazineViews.RecordStatus.HIDDEN;
        }
        if (promotion.isRemoved()) {
            return MagazineViews.RecordStatus.REMOVED;
        }
        if (issued) {
            return promotion.getSnapshot() != null ? MagazineViews.RecordStatus.PUBLISHED
                    : MagazineViews.RecordStatus.SKIPPED;
        }
        return promotion.getIssueDate().isBefore(today) ? MagazineViews.RecordStatus.SKIPPED
                : MagazineViews.RecordStatus.SCHEDULED;
    }

    /**
     * 그 섬의 현재 호 칸에 PIN 을 남긴 사람의 다음 단계를 센다. 칸이 그 뒤 신고로 숨겨지거나 내려가도 센다 — 넣은 순간에는
     * 보이는 칸이었고(PIN 은 보이는 칸에서만 남는다), 그 뒤의 도착·가입은 그 홍보를 거쳐 온 행동이다.
     */
    private void recordAfterPin(UUID userId, UUID islandId, String step, Instant now) {
        currentIssue(now).flatMap(issue -> promotions.findByIslandIdAndIssueDate(islandId, issue.getIssueDate()))
                .filter(promotion -> funnel.existsByPromotionIdAndUserIdAndStep(promotion.getId(), userId,
                        IslandPromotionFunnel.PIN))
                .ifPresent(promotion -> funnel.insertIfAbsent(promotion.getId(), userId, step, now));
    }
}
