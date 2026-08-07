package com.oneorthree.phone.league.service;

import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.dto.LeagueBatchSummaryResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 주간 집중 시간 임계값을 기준으로 전체 활성 사용자의 티어를 정산하는 배치 진입점.
 *
 * <p>이 클래스에는 <b>정산 트랜잭션이 없다</b> (GROMO-1218) — 전 유저를 한 트랜잭션으로 묶으면
 * 정산 도중 커밋된 탈퇴 하나가 배치 전체를 롤백시킨다(anchor 미생성·전원 미정산). anchor 회전은
 * {@link LeagueAnchorRotator} 가 선커밋하고, 유저 정산은 {@link LeagueUserSettler} 가 건별
 * 트랜잭션으로 수행한다 — 탈퇴 선커밋 유저는 skip, 예외는 그 유저만 롤백하고 배치는 계속된다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeagueBatchService {

    static final int SETTLEMENT_PAGE_SIZE = 100;

    /** 실패 요약 로그에 실을 userId 상한 — 대량 실패 시 로그 한 줄이 무한정 길어지지 않게 자른다. */
    static final int FAILED_USER_ID_LOG_LIMIT = 20;

    private final LeagueTierConfigRepository leagueTierConfigRepository;
    private final LeagueRankingQueryRepository leagueRankingQueryRepository;
    private final LeagueWeek leagueWeek;
    private final LeagueAnchorRotator leagueAnchorRotator;
    private final LeagueUserSettler leagueUserSettler;

    public LeagueBatchSummaryResponse runWeeklyBatch() {
        return runWeeklyBatch(Instant.now());
    }

    /**
     * {@code now}가 속한 KST 주차의 anchor 를 만들고, 직전 KST 월~일 집중 시간을 정산한다.
     * anchor 회전이 먼저 커밋되고, 유저 정산은 그 뒤 건별 트랜잭션으로 이어진다.
     */
    public LeagueBatchSummaryResponse runWeeklyBatch(Instant now) {
        long startedAtMillis = System.currentTimeMillis();
        Instant newWeekStart = leagueWeek.currentWeekStart(now);

        // 티어 설정 검증은 anchor 선커밋보다 먼저 — 깨진 설정으로 anchor 만 커밋되면 설정을 고친
        // 뒤의 재실행이 BATCH_ALREADY_RUN 에 막혀 그 주차 정산이 통째로 날아간다.
        Map<Integer, LeagueTierConfig> tierConfigs = loadTierConfigs();
        LocalDate previousWeekStartDate = leagueWeek.previousWeekStartDate(now);
        LocalDate previousWeekEndDate = previousWeekStartDate.plusDays(6);
        Instant previousWeekStart = leagueWeek.previousWeekStart(now);

        int endedAnchorCount = leagueAnchorRotator.rotate(now, newWeekStart);

        int settledMemberCount = 0;
        int skippedMemberCount = 0;
        List<UUID> failedUserIds = new ArrayList<>();
        UUID cursor = null;
        while (true) {
            List<LeagueRankingRow> page = leagueRankingQueryRepository.findWeeklyTotalsForSettlement(
                    previousWeekStartDate, previousWeekEndDate, cursor, SETTLEMENT_PAGE_SIZE);
            if (page.isEmpty()) {
                break;
            }
            for (LeagueRankingRow row : page) {
                try {
                    if (leagueUserSettler.settle(row, previousWeekStart, tierConfigs)) {
                        settledMemberCount++;
                    } else {
                        skippedMemberCount++;
                    }
                } catch (RuntimeException e) {
                    // 이 유저만 롤백된 상태다. 다른 유저 정산을 막지 않도록 삼키고 기록만 남긴다.
                    failedUserIds.add(row.userId());
                    log.error("리그 정산 실패 — 해당 유저만 롤백. userId={}", row.userId(), e);
                }
            }
            cursor = page.get(page.size() - 1).userId();
            if (page.size() < SETTLEMENT_PAGE_SIZE) {
                break;
            }
        }

        int failedMemberCount = failedUserIds.size();
        long elapsedMillis = System.currentTimeMillis() - startedAtMillis;
        log.info("리그 주간 정산 완료 — weekStartAt={}, endedAnchors={}, settled={}, skipped={}, "
                + "failed={}, elapsedMillis={}",
                newWeekStart, endedAnchorCount, settledMemberCount, skippedMemberCount,
                failedMemberCount, elapsedMillis);
        // 배치 종료 요약 — 건별 error 로그는 스택트레이스에 묻혀 "이번 배치에서 몇 건이 실패했나"를
        // 한눈에 못 본다. 알림 규칙을 걸 수 있게 고정 포맷 한 줄로 다시 남긴다(GroupBetSettlementService 선례).
        if (failedMemberCount > 0) {
            log.error("리그 정산 실패 요약 — 실패 {}건, userIds={}{}",
                    failedMemberCount,
                    failedUserIds.stream().limit(FAILED_USER_ID_LOG_LIMIT).toList(),
                    failedMemberCount > FAILED_USER_ID_LOG_LIMIT
                            ? " (앞 " + FAILED_USER_ID_LOG_LIMIT + "건만 표시)" : "");
        }
        return new LeagueBatchSummaryResponse(newWeekStart, endedAnchorCount, settledMemberCount,
                skippedMemberCount, failedMemberCount, 1, elapsedMillis);
    }

    private Map<Integer, LeagueTierConfig> loadTierConfigs() {
        Map<Integer, LeagueTierConfig> tierConfigs = leagueTierConfigRepository.findAll().stream()
                .filter(config -> config.getDeletedAt() == null)
                .collect(Collectors.toMap(LeagueTierConfig::getTierLevel, Function.identity()));
        if (tierConfigs.size() != LeagueUserSettler.MAX_TIER_LEVEL) {
            throw new LeagueException(LeagueErrorCode.TIER_CONFIG_NOT_FOUND);
        }
        for (int tierLevel = LeagueUserSettler.MIN_TIER_LEVEL;
                tierLevel <= LeagueUserSettler.MAX_TIER_LEVEL; tierLevel++) {
            if (tierConfigs.get(tierLevel) == null) {
                throw new LeagueException(LeagueErrorCode.TIER_CONFIG_NOT_FOUND);
            }
        }
        return tierConfigs;
    }
}
