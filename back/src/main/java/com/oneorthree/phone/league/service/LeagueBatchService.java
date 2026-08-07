package com.oneorthree.phone.league.service;

import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.dto.LeagueBatchSummaryResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.league.repository.LeagueWeeklyResultRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;
import java.util.Set;
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
 *
 * <p><b>크래시 운영 가이드 (GROMO-1239)</b> — 배치 프로세스가 정산 도중 죽으면 anchor 는 이미
 * 선커밋돼 있어 기본 run(스케줄러 포함)은 BATCH_ALREADY_RUN(409)에 막힌다. 잔여 파악은 완료 로그
 * "리그 주간 정산 완료"의 settled+skipped+already+failed 합계를 대상자 수와 비교해서 하고,
 * 복구는 {@link #resumeWeeklyBatch}(POST /league/batch/resume) 로 한다 — 재실행은 완료 마커
 * (league_weekly_results 의 (user_id, week_start_at) 유니크 행) 기준 멱등이라 기정산 유저는
 * alreadySettled 로 건너뛰고 미정산 유저만 마저 정산한다.
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
    private final LeagueWeeklyResultRepository leagueWeeklyResultRepository;
    private final LeagueWeek leagueWeek;
    private final LeagueAnchorRotator leagueAnchorRotator;
    private final LeagueUserSettler leagueUserSettler;

    public LeagueBatchSummaryResponse runWeeklyBatch() {
        return runWeeklyBatch(Instant.now());
    }

    /**
     * {@code now}가 속한 KST 주차의 anchor 를 만들고, 직전 KST 월~일 집중 시간을 정산한다.
     * anchor 회전이 먼저 커밋되고, 유저 정산은 그 뒤 건별 트랜잭션으로 이어진다.
     * 이번 주차 anchor 가 이미 있으면 BATCH_ALREADY_RUN(409) — 스케줄러 기본 경로의 계약이다.
     */
    public LeagueBatchSummaryResponse runWeeklyBatch(Instant now) {
        return execute(now, false, null);
    }

    /**
     * 정산 재개 (GROMO-1239) — 크래시·부분 실패 복구용 진입점.
     *
     * <p>기본 run 과 달리 이번 주차 anchor 가 이미 있으면 409 대신 회전을 건너뛰고
     * (endedArenaCount=0·createdArenaCount=0) 정산 루프만 재진입한다. anchor 가 없으면(이번 주차
     * 배치가 아직 안 돌았으면) rotate 부터 수행한다 — "이번 주차 배치를 완결 상태로 만든다"
     * 시맨틱이라 몇 번을 불러도 안전하다(완료 마커 기준 멱등, 보너스는 멱등키가 이중 방어).
     *
     * @param now     정산 기준 시각 — run 과 같은 주차 산식
     * @param userIds 지정하면 그 유저들만 정산(전체 페이지 순회 생략 — 실패 유저 표적 복구용).
     *                null 이거나 비어 있으면 전체 활성 유저를 순회한다
     */
    public LeagueBatchSummaryResponse resumeWeeklyBatch(Instant now, List<UUID> userIds) {
        return execute(now, true, userIds);
    }

    private LeagueBatchSummaryResponse execute(Instant now, boolean resume, List<UUID> targetUserIds) {
        long startedAtMillis = System.currentTimeMillis();
        Instant newWeekStart = leagueWeek.currentWeekStart(now);

        // 티어 설정 검증은 anchor 선커밋보다 먼저 — 깨진 설정으로 anchor 만 커밋되면 설정을 고친
        // 뒤의 재실행이 BATCH_ALREADY_RUN 에 막혀 그 주차 정산이 통째로 날아간다.
        Map<Integer, LeagueTierConfig> tierConfigs = loadTierConfigs();
        LocalDate previousWeekStartDate = leagueWeek.previousWeekStartDate(now);
        LocalDate previousWeekEndDate = previousWeekStartDate.plusDays(6);
        Instant previousWeekStart = leagueWeek.previousWeekStart(now);

        int endedAnchorCount;
        int createdAnchorCount;
        if (resume) {
            OptionalInt rotated = leagueAnchorRotator.rotateIfAbsent(now, newWeekStart);
            endedAnchorCount = rotated.orElse(0);
            createdAnchorCount = rotated.isPresent() ? 1 : 0;
        } else {
            endedAnchorCount = leagueAnchorRotator.rotate(now, newWeekStart);
            createdAnchorCount = 1;
        }

        SettlementCounters counters = new SettlementCounters();
        if (targetUserIds == null || targetUserIds.isEmpty()) {
            UUID cursor = null;
            while (true) {
                List<LeagueRankingRow> page = leagueRankingQueryRepository.findWeeklyTotalsForSettlement(
                        previousWeekStartDate, previousWeekEndDate, cursor, SETTLEMENT_PAGE_SIZE);
                if (page.isEmpty()) {
                    break;
                }
                settlePage(page, previousWeekStart, tierConfigs, counters);
                cursor = page.get(page.size() - 1).userId();
                if (page.size() < SETTLEMENT_PAGE_SIZE) {
                    break;
                }
            }
        } else {
            // 표적 재개 — 지정 유저들의 집계만 한 번에 조회한다(탈퇴·게스트는 집계에서 빠진다).
            settlePage(leagueRankingQueryRepository.findWeeklyTotalsForUsers(
                            previousWeekStartDate, previousWeekEndDate, targetUserIds),
                    previousWeekStart, tierConfigs, counters);
        }

        int failedMemberCount = counters.failedUserIds.size();
        long elapsedMillis = System.currentTimeMillis() - startedAtMillis;
        log.info("리그 주간 정산 완료 — weekStartAt={}, endedAnchors={}, settled={}, skipped={}, "
                + "already={}, failed={}, elapsedMillis={}",
                newWeekStart, endedAnchorCount, counters.settled, counters.skipped,
                counters.alreadySettled, failedMemberCount, elapsedMillis);
        // 배치 종료 요약 — 건별 error 로그는 스택트레이스에 묻혀 "이번 배치에서 몇 건이 실패했나"를
        // 한눈에 못 본다. 알림 규칙을 걸 수 있게 고정 포맷 한 줄로 다시 남긴다(GroupBetSettlementService 선례).
        if (failedMemberCount > 0) {
            log.error("리그 정산 실패 요약 — 실패 {}건, userIds={}{}",
                    failedMemberCount,
                    counters.failedUserIds.stream().limit(FAILED_USER_ID_LOG_LIMIT).toList(),
                    failedMemberCount > FAILED_USER_ID_LOG_LIMIT
                            ? " (앞 " + FAILED_USER_ID_LOG_LIMIT + "건만 표시)" : "");
        }
        return new LeagueBatchSummaryResponse(newWeekStart, endedAnchorCount, counters.settled,
                counters.skipped, counters.alreadySettled, failedMemberCount, createdAnchorCount,
                elapsedMillis);
    }

    /**
     * 한 페이지(최대 100명)를 정산한다. 완료 마커 페이지 선조회(빠른 경로)로 기정산 유저는 settle
     * 호출(락 왕복) 없이 건너뛴다 — 동시성 정본은 settler 가 락을 쥔 뒤 하는 단건 재확인이고,
     * 이 선조회는 재실행에서 N+1 exists 를 피하는 최적화일 뿐이다 (GROMO-1239).
     */
    private void settlePage(List<LeagueRankingRow> page, Instant previousWeekStart,
                            Map<Integer, LeagueTierConfig> tierConfigs, SettlementCounters counters) {
        if (page.isEmpty()) {
            return;
        }
        Set<UUID> settledIds = Set.copyOf(leagueWeeklyResultRepository.findUserIdsByWeekStartAtAndUserIdIn(
                previousWeekStart, page.stream().map(LeagueRankingRow::userId).toList()));
        for (LeagueRankingRow row : page) {
            if (settledIds.contains(row.userId())) {
                counters.alreadySettled++;
                continue;
            }
            try {
                switch (leagueUserSettler.settle(row, previousWeekStart, tierConfigs)) {
                    case SETTLED -> counters.settled++;
                    case SKIPPED_WITHDRAWN -> counters.skipped++;
                    case ALREADY_SETTLED -> counters.alreadySettled++;
                }
            } catch (RuntimeException e) {
                // 이 유저만 롤백된 상태다. 다른 유저 정산을 막지 않도록 삼키고 기록만 남긴다.
                counters.failedUserIds.add(row.userId());
                log.error("리그 정산 실패 — 해당 유저만 롤백. userId={}", row.userId(), e);
            }
        }
    }

    /** 페이지 경계를 넘어 누적되는 정산 집계 — 요약 응답·완료 로그의 원천. */
    private static final class SettlementCounters {
        private int settled;
        private int skipped;
        private int alreadySettled;
        private final List<UUID> failedUserIds = new ArrayList<>();
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
