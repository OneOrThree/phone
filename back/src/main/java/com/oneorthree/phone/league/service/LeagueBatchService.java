package com.oneorthree.phone.league.service;

import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.league.dto.LeagueBatchSummaryResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.repository.LeagueArenaRepository;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.league.repository.LeagueWeeklyResultRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/** 주간 집중 시간 임계값을 기준으로 전체 활성 사용자의 티어를 정산한다. */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeagueBatchService {

    static final int SETTLEMENT_PAGE_SIZE = 100;
    private static final int MIN_TIER_LEVEL = 1;
    private static final int MAX_TIER_LEVEL = 5;

    private final LeagueArenaRepository leagueArenaRepository;
    private final LeagueTierConfigRepository leagueTierConfigRepository;
    private final LeagueRankingQueryRepository leagueRankingQueryRepository;
    private final LeagueWeeklyResultRepository leagueWeeklyResultRepository;
    private final UserRepository userRepository;
    private final LeagueWeek leagueWeek;
    private final EntityManager entityManager;

    @Transactional
    public LeagueBatchSummaryResponse runWeeklyBatch() {
        return runWeeklyBatch(Instant.now());
    }

    /**
     * {@code now}가 속한 KST 주차의 anchor를 만들고, 직전 KST 월~일 집중 시간을 정산한다.
     * anchor 확인부터 결과 저장, 사용자 티어 갱신까지 하나의 트랜잭션에서 수행한다.
     */
    @Transactional
    public LeagueBatchSummaryResponse runWeeklyBatch(Instant now) {
        long startedAtMillis = System.currentTimeMillis();
        Instant newWeekStart = leagueWeek.currentWeekStart(now);
        if (leagueArenaRepository.existsByStartedAt(newWeekStart)) {
            throw new LeagueException(LeagueErrorCode.BATCH_ALREADY_RUN);
        }

        Map<Integer, LeagueTierConfig> tierConfigs = loadTierConfigs();
        LocalDate previousWeekStartDate = leagueWeek.previousWeekStartDate(now);
        LocalDate previousWeekEndDate = previousWeekStartDate.plusDays(6);
        Instant previousWeekStart = leagueWeek.previousWeekStart(now);

        int settledMemberCount = settleUsers(
                previousWeekStartDate, previousWeekEndDate, previousWeekStart, tierConfigs);

        List<LeagueArena> previousActiveAnchors = leagueArenaRepository
                .findByStatusAndStartedAtBefore(LeagueArenaStatus.ACTIVE, newWeekStart);
        previousActiveAnchors.forEach(arena -> arena.end(now));
        leagueArenaRepository.save(LeagueArena.builder()
                .startedAt(newWeekStart)
                .status(LeagueArenaStatus.ACTIVE)
                .build());

        long elapsedMillis = System.currentTimeMillis() - startedAtMillis;
        log.info("리그 주간 정산 완료 — weekStartAt={}, endedAnchors={}, users={}, elapsedMillis={}",
                newWeekStart, previousActiveAnchors.size(), settledMemberCount, elapsedMillis);
        return new LeagueBatchSummaryResponse(
                newWeekStart, previousActiveAnchors.size(), settledMemberCount, 1, elapsedMillis);
    }

    private int settleUsers(
            LocalDate fromDate,
            LocalDate toDate,
            Instant previousWeekStart,
            Map<Integer, LeagueTierConfig> tierConfigs) {
        int settledMemberCount = 0;
        UUID cursor = null;
        while (true) {
            List<LeagueRankingRow> page = leagueRankingQueryRepository.findWeeklyTotalsForSettlement(
                    fromDate, toDate, cursor, SETTLEMENT_PAGE_SIZE);
            if (page.isEmpty()) {
                return settledMemberCount;
            }

            settlePage(page, previousWeekStart, tierConfigs);
            entityManager.flush();
            entityManager.clear();
            settledMemberCount += page.size();
            cursor = page.get(page.size() - 1).userId();
            if (page.size() < SETTLEMENT_PAGE_SIZE) {
                return settledMemberCount;
            }
        }
    }

    private void settlePage(
            List<LeagueRankingRow> page,
            Instant previousWeekStart,
            Map<Integer, LeagueTierConfig> tierConfigs) {
        Map<UUID, User> usersById = userRepository.findAllByIdInAndIsDeletedFalse(
                        page.stream().map(LeagueRankingRow::userId).toList())
                .stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));

        List<LeagueWeeklyResult> results = page.stream()
                .map(row -> settleUser(requireUser(usersById, row.userId()), row, previousWeekStart, tierConfigs))
                .toList();
        leagueWeeklyResultRepository.saveAll(results);
    }

    private LeagueWeeklyResult settleUser(
            User user,
            LeagueRankingRow row,
            Instant previousWeekStart,
            Map<Integer, LeagueTierConfig> tierConfigs) {
        int previousTierLevel = row.tierLevel();
        LeagueTierConfig config = requireTierConfig(tierConfigs, previousTierLevel);
        LeagueWeeklyResultType result = decideResult(previousTierLevel, row.totalFocusSeconds(), config);
        int newTierLevel = switch (result) {
            case PROMOTED -> previousTierLevel + 1;
            case RELEGATED -> previousTierLevel - 1;
            case STAY -> previousTierLevel;
        };
        user.setTierLevel(newTierLevel);
        return LeagueWeeklyResult.builder()
                .user(user)
                .weekStartAt(previousWeekStart)
                .previousTierLevel(previousTierLevel)
                .newTierLevel(newTierLevel)
                .result(result)
                .focusSeconds(row.totalFocusSeconds())
                .build();
    }

    private LeagueWeeklyResultType decideResult(
            int tierLevel, int focusSeconds, LeagueTierConfig config) {
        if (tierLevel < MAX_TIER_LEVEL && focusSeconds >= config.getPromotionTime()) {
            return LeagueWeeklyResultType.PROMOTED;
        }
        if (tierLevel > MIN_TIER_LEVEL && focusSeconds < config.getRelegationTime()) {
            return LeagueWeeklyResultType.RELEGATED;
        }
        return LeagueWeeklyResultType.STAY;
    }

    private Map<Integer, LeagueTierConfig> loadTierConfigs() {
        Map<Integer, LeagueTierConfig> tierConfigs = leagueTierConfigRepository.findAll().stream()
                .filter(config -> config.getDeletedAt() == null)
                .collect(Collectors.toMap(LeagueTierConfig::getTierLevel, Function.identity()));
        if (tierConfigs.size() != MAX_TIER_LEVEL) {
            throw new LeagueException(LeagueErrorCode.TIER_CONFIG_NOT_FOUND);
        }
        for (int tierLevel = MIN_TIER_LEVEL; tierLevel <= MAX_TIER_LEVEL; tierLevel++) {
            requireTierConfig(tierConfigs, tierLevel);
        }
        return tierConfigs;
    }

    private LeagueTierConfig requireTierConfig(
            Map<Integer, LeagueTierConfig> tierConfigs, int tierLevel) {
        LeagueTierConfig config = tierConfigs.get(tierLevel);
        if (config == null) {
            throw new LeagueException(LeagueErrorCode.TIER_CONFIG_NOT_FOUND);
        }
        return config;
    }

    private User requireUser(Map<UUID, User> usersById, UUID userId) {
        User user = usersById.get(userId);
        if (user == null) {
            throw new IllegalStateException("settlement user disappeared: " + userId);
        }
        return user;
    }
}
