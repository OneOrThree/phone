package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.dto.GroupBetSettlementSummaryResponse;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

/**
 * 내기 일 배치 진입점 — 전일자까지의 미정산 내기를 훑어 {@link GroupBetSettler} 에 한 건씩 넘긴다.
 *
 * <p>이 클래스에는 <b>트랜잭션이 없다</b>. 건별 트랜잭션(정산 실패 격리)이 목적이라, 여기서 하나로
 * 묶으면 한 건의 롤백이 전체를 되돌린다. 대상 id 조회도 각자 짧은 트랜잭션으로 끝난다.
 *
 * <p>포커스에는 "하루가 끝났다"는 신호가 없어 자정이 아니라 04:00 KST 에 돈다 — 자정을 넘겨 끝난
 * 세션도 종료일 버킷(daily_focus_stats)에 들어오도록 4시간의 그레이스를 둔 것이다. 해외 타임존
 * 유저는 KST 하루 경계로 정산된다(서비스가 한국 타깃이라 수용, 후속 티켓).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GroupBetSettlementService {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** 그레이스 4시간 — 스케줄 배치가 04:00 KST 에 도는 이유와 같은 값이다. */
    private static final int SETTLEMENT_GRACE_HOURS = 4;

    private final GroupChallengeBetRepository groupChallengeBetRepository;
    private final GroupBetSettler groupBetSettler;

    /** 그레이스가 지난 날짜까지의 OPEN 내기를 전건 정산한다. */
    public GroupBetSettlementSummaryResponse settleDueBets() {
        return settleDueBets(settlementDateAt(Instant.now()));
    }

    /**
     * 정산 기준일 — "그레이스(4h)가 이미 끝난 날"까지만 대상으로 잡기 위해 현재 시각에서 4시간을 뺀
     * KST 날짜를 쓴다. 04:00 KST 정각에 도는 스케줄러에게는 그냥 오늘이라 동작이 그대로지만,
     * 수동 트리거(GroupBetBatchController)를 00:00~04:00 사이에 호출해도 전일자 내기를 그레이스가
     * 끝나기 전에 앞당겨 정산하지 않는다 — 정산은 되돌릴 수 없어 늦게 올라온 집중 기록이 누락된 채
     * 지급이 확정돼 버리기 때문이다 (PR #381 리뷰).
     */
    static LocalDate settlementDateAt(Instant now) {
        return LocalDate.ofInstant(now.minus(SETTLEMENT_GRACE_HOURS, ChronoUnit.HOURS), KST);
    }

    /**
     * @param today 정산 기준일(KST). {@code bet_date < today} 인 OPEN 내기가 대상이다
     */
    public GroupBetSettlementSummaryResponse settleDueBets(LocalDate today) {
        long startedAtMillis = System.currentTimeMillis();
        List<UUID> targets = groupChallengeBetRepository
                .findIdsByStatusAndBetDateBefore(GroupBetStatus.OPEN, today);

        int settled = 0;
        int refunded = 0;
        int skipped = 0;
        int failed = 0;
        for (UUID betId : targets) {
            try {
                // 대상으로 집은 뒤 다른 실행(스케줄러 ↔ 수동 트리거)이 먼저 정산했을 수 있다.
                // 그때는 최종 상태만 SETTLED/REFUNDED 일 뿐 이 호출은 지급을 안 했으므로 스킵으로 센다
                // — 안 그러면 동시 실행 양쪽이 같은 내기를 각자 성과로 세어 요약·지표가 부풀려진다.
                GroupBetSettler.SettleResult result = groupBetSettler.settle(betId);
                if (!result.applied()) {
                    skipped++;
                } else if (result.status() == GroupBetStatus.REFUNDED) {
                    refunded++;
                } else if (result.status() == GroupBetStatus.SETTLED) {
                    settled++;
                }
            } catch (RuntimeException e) {
                // 이 내기만 롤백된 상태다. 다른 내기 정산을 막지 않도록 삼키고 기록만 남긴다.
                failed++;
                log.error("내기 정산 실패 — 해당 건 롤백. betId={}", betId, e);
            }
        }

        long elapsedMillis = System.currentTimeMillis() - startedAtMillis;
        log.info("내기 일 배치 완료 — settledBefore={}, 대상={}, 분배={}, 환불={}, 스킵={}, 실패={}, "
                + "elapsedMillis={}",
                today, targets.size(), settled, refunded, skipped, failed, elapsedMillis);
        return new GroupBetSettlementSummaryResponse(
                today, targets.size(), settled, refunded, skipped, failed, elapsedMillis);
    }
}
