package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.dto.GroupBetSettlementSummaryResponse;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 내기 일 배치 진입점 — 전일자까지의 미정산 내기를 훑어 {@link GroupBetSettler} 에 한 건씩 넘긴다.
 *
 * <p>이 클래스에는 <b>트랜잭션이 없다</b>. 건별 트랜잭션(정산 실패 격리)이 목적이라, 여기서 하나로
 * 묶으면 한 건의 롤백이 전체를 되돌린다. 대상 id 조회도 각자 짧은 트랜잭션으로 끝난다.
 *
 * <p>정산 크론은 <b>카테고리별로 2회</b> 돈다: FOCUS 는 익일 01:00 KST(집중 일별 통계는 세션 종료
 * 시각 귀속이라 자정에 데이터가 완결된다 — 그레이스 1h 면 충분), SCREEN_TIME 은 익일 12:00 KST
 * (어제 스크린타임의 최종 보고는 유저의 다음날 첫 앱 실행에 올라오므로, 01:00 에 정산하면
 * "미보고=미달성" 억울 패배가 양산된다 — 아침 보고 기회를 준 뒤 정산한다). 대상 선정만 카테고리로
 * 갈릴 뿐 정산 로직은 하나다. 해외 타임존 유저는 KST 하루 경계로 정산된다(서비스가 한국 타깃이라
 * 수용, 후속 티켓).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GroupBetSettlementService {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** 그레이스 1시간 — 가장 이른 스케줄 배치(FOCUS 01:00 KST)가 도는 시각과 짝이다. */
    private static final int SETTLEMENT_GRACE_HOURS = 1;

    /** 실패 요약 로그에 실을 betId 상한 — 대량 실패 시 로그 한 줄이 무한정 길어지지 않게 자른다. */
    static final int FAILED_BET_ID_LOG_LIMIT = 20;

    private final GroupChallengeBetRepository groupChallengeBetRepository;
    private final GroupBetSettler groupBetSettler;

    /**
     * 그레이스가 지난 날짜까지의 OPEN 내기를 정산한다 — 스케줄러·수동 트리거의 진입점.
     *
     * @param category 이 카테고리의 챌린지에 걸린 내기만 정산한다. {@code null} 이면 전 카테고리
     */
    public GroupBetSettlementSummaryResponse settleDueBets(MissionCategory category) {
        return settleDueBets(settlementDateAt(Instant.now()), category);
    }

    /**
     * 정산 기준일 — "그레이스(1h)가 이미 끝난 날"까지만 대상으로 잡기 위해 현재 시각에서 1시간을 뺀
     * KST 날짜를 쓴다. 01:00 KST 정각에 도는 FOCUS 스케줄러에게는 그냥 오늘이라 동작이 그대로지만,
     * 수동 트리거(GroupBetBatchController)를 00:00~01:00 사이에 호출해도 전일자 내기를 그레이스가
     * 끝나기 전에 앞당겨 정산하지 않는다 — 정산은 되돌릴 수 없어 늦게 올라온 집중 기록이 누락된 채
     * 지급이 확정돼 버리기 때문이다 (PR #381 리뷰). 12:00 배치(SCREEN_TIME)는 그레이스가 훨씬
     * 지난 시각이라 이 계산에 걸리지 않는다.
     */
    static LocalDate settlementDateAt(Instant now) {
        return LocalDate.ofInstant(now.minus(SETTLEMENT_GRACE_HOURS, ChronoUnit.HOURS), KST);
    }

    /**
     * @param today 정산 기준일(KST). {@code bet_date < today} 인 OPEN 내기가 대상이다
     */
    public GroupBetSettlementSummaryResponse settleDueBets(LocalDate today) {
        return settleDueBets(today, null);
    }

    /**
     * @param today    정산 기준일(KST). {@code bet_date < today} 인 OPEN 내기가 대상이다
     * @param category 대상 챌린지 카테고리. {@code null} 이면 전 카테고리
     */
    public GroupBetSettlementSummaryResponse settleDueBets(LocalDate today, MissionCategory category) {
        long startedAtMillis = System.currentTimeMillis();
        List<UUID> targets = category == null
                ? groupChallengeBetRepository.findIdsByStatusAndBetDateBefore(GroupBetStatus.OPEN, today)
                : groupChallengeBetRepository.findIdsByStatusAndBetDateBeforeAndCategory(
                        GroupBetStatus.OPEN, today, category);

        int settled = 0;
        int forfeited = 0;
        int skipped = 0;
        List<UUID> failedBetIds = new ArrayList<>();
        for (UUID betId : targets) {
            try {
                // 대상으로 집은 뒤 다른 실행(스케줄러 ↔ 수동 트리거)이 먼저 정산했을 수 있다.
                // 그때는 최종 상태만 종료 상태일 뿐 이 호출은 지급을 안 했으므로 스킵으로 센다
                // — 안 그러면 동시 실행 양쪽이 같은 내기를 각자 성과로 세어 요약·지표가 부풀려진다.
                GroupBetSettler.SettleResult result = groupBetSettler.settle(betId);
                if (!result.applied()) {
                    skipped++;
                } else if (result.status() == GroupBetStatus.FORFEITED) {
                    forfeited++;
                } else if (result.status() == GroupBetStatus.SETTLED) {
                    settled++;
                }
            } catch (RuntimeException e) {
                // 이 내기만 롤백된 상태다. 다른 내기 정산을 막지 않도록 삼키고 기록만 남긴다.
                failedBetIds.add(betId);
                log.error("내기 정산 실패 — 해당 건 롤백. betId={}", betId, e);
            }
        }

        int failed = failedBetIds.size();
        long elapsedMillis = System.currentTimeMillis() - startedAtMillis;
        log.info("내기 일 배치 완료 — settledBefore={}, category={}, 대상={}, 분배={}, 몰수={}, 스킵={}, "
                + "실패={}, elapsedMillis={}",
                today, category == null ? "ALL" : category, targets.size(), settled, forfeited, skipped,
                failed, elapsedMillis);
        // 배치 종료 요약(B4 ops) — 건별 error 로그는 스택트레이스에 묻혀 "이번 배치에서 몇 건이
        // 실패했나" 를 한눈에 못 본다. 알림 규칙을 걸 수 있게 고정 포맷 한 줄로 다시 남긴다.
        // 크론이 카테고리별 2회로 나뉜 뒤로는 어느 배치의 실패인지도 함께 실어야 추적이 된다.
        if (failed > 0) {
            log.error("내기 정산 실패 요약 — category={}, 실패 {}건, betIds={}{}",
                    category == null ? "ALL" : category,
                    failed,
                    failedBetIds.stream().limit(FAILED_BET_ID_LOG_LIMIT).toList(),
                    failed > FAILED_BET_ID_LOG_LIMIT
                            ? " (앞 " + FAILED_BET_ID_LOG_LIMIT + "건만 표시)" : "");
        }
        // refundedCount 는 몰수 룰 도입 이후 정산이 만들지 않는 레거시 버킷 — 항상 0 으로 내보낸다.
        return new GroupBetSettlementSummaryResponse(
                today, targets.size(), settled, forfeited, 0, skipped, failed, elapsedMillis);
    }
}
