package com.oneorthree.phone.league.service;

import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.domain.LeagueMemberResult;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.dto.LeagueBatchSummaryResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.repository.LeagueArenaRepository;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.user.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 주간 리그 마감/재편성 배치.
 *
 * <p>매주 월 00시(KST)에 (1) 랭킹 산정 → (2) 승격/강등 결과 확정 + 아레나 마감 →
 * (3) 다음 주차 아레나 생성/멤버 재배정 → (4) 0 리셋(신규 row) 을 수행한다.
 * 기존 row 는 ENDED 아레나에 주간 이력으로 보존된다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeagueBatchService {

    // 리그 주차 기준 타임존 (KST 고정 — 외국 유저 타임존 대응은 별도 백로그 티켓)
    private static final ZoneId LEAGUE_ZONE = ZoneId.of("Asia/Seoul");

    private final LeagueArenaRepository leagueArenaRepository;
    private final LeagueArenaUserRepository leagueArenaUserRepository;
    private final LeagueTierConfigRepository leagueTierConfigRepository;

    @Transactional
    public LeagueBatchSummaryResponse runWeeklyBatch() {
        return runWeeklyBatch(Instant.now());
    }

    /**
     * 주간 배치 진입점. 새 주차 시작 시각(now 가 속한 주의 월요일 00:00 KST)보다
     * 이전에 시작한 ACTIVE 아레나만 마감 대상으로 처리해 재실행 시 중복 마감을 방지한다.
     */
    @Transactional
    public LeagueBatchSummaryResponse runWeeklyBatch(Instant now) {
        long startedAtMillis = System.currentTimeMillis();
        Instant newWeekStart = resolveWeekStart(now);

        List<LeagueArena> activeArenas = leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE);
        List<LeagueArena> targets = activeArenas.stream()
                .filter(arena -> arena.getStartedAt().isBefore(newWeekStart))
                .toList();
        if (targets.isEmpty()) {
            if (activeArenas.isEmpty()) {
                log.info("리그 주간 배치 — 처리할 ACTIVE 아레나 없음 (weekStartAt={})", newWeekStart);
                return new LeagueBatchSummaryResponse(
                        newWeekStart, 0, 0, 0, System.currentTimeMillis() - startedAtMillis);
            }
            // ACTIVE 아레나가 전부 새 주차 소속 → 이번 주차 배치는 이미 실행됨 (idempotency)
            throw new LeagueException(LeagueErrorCode.BATCH_ALREADY_RUN);
        }

        Map<Integer, LeagueTierConfig> tierConfigs = loadTierConfigs();
        int minTier = Collections.min(tierConfigs.keySet());
        int maxTier = Collections.max(tierConfigs.keySet());

        // 티어 레벨 → 다음 주차 편입 풀 (TreeMap: 낮은 티어부터 결정적 순서로 재배정)
        Map<Integer, List<User>> nextWeekPools = new TreeMap<>();
        int settledMemberCount = 0;
        for (LeagueArena arena : targets) {
            LeagueTierConfig config = requireTierConfig(tierConfigs, arena.getTierConfig().getTierLevel());
            List<LeagueArenaUser> ranked = leagueArenaUserRepository.findRankedByArena(arena);
            settleArenaRanking(ranked);
            decideResults(ranked, config, minTier, maxTier);
            arena.end(now);
            for (LeagueArenaUser member : ranked) {
                nextWeekPools.computeIfAbsent(nextTierLevel(member), key -> new ArrayList<>())
                        .add(member.getUser());
            }
            settledMemberCount += ranked.size();
        }

        int createdArenaCount = reassignNextWeek(nextWeekPools, tierConfigs, newWeekStart);

        long elapsedMillis = System.currentTimeMillis() - startedAtMillis;
        log.info("리그 주간 배치 완료 — weekStartAt={}, endedArenas={}, members={}, createdArenas={}, elapsedMillis={}",
                newWeekStart, targets.size(), settledMemberCount, createdArenaCount, elapsedMillis);
        return new LeagueBatchSummaryResponse(
                newWeekStart, targets.size(), settledMemberCount, createdArenaCount, elapsedMillis);
    }

    // now 가 속한 주의 월요일 00:00(KST) — 새 주차 시작 시각
    private Instant resolveWeekStart(Instant now) {
        return now.atZone(LEAGUE_ZONE).toLocalDate()
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                .atStartOfDay(LEAGUE_ZONE)
                .toInstant();
    }

    // 책임(1) 주간 랭킹 산정 — findRankedByArena 정렬(totalFocusSeconds DESC, id ASC) 순서로 rank 1..N 확정
    private void settleArenaRanking(List<LeagueArenaUser> ranked) {
        for (int i = 0; i < ranked.size(); i++) {
            ranked.get(i).setRank(i + 1);
        }
    }

    /**
     * 책임(2) 승격/강등 결과 확정.
     *
     * <p>활동 0초 멤버는 순위 무관 무조건 RELEGATED 로 먼저 확정하고, 나머지 활동 멤버에게
     * 승격(상위 promoteCount) → 강등(하위 relegateCount) → 경고(강등 바로 위 relegateWarningCount)
     * 순으로 컷오프를 적용한다(겹치면 승격 우선). 마지막으로 경계 보정: 최상위 티어의 PROMOTED,
     * 최하위 티어의 RELEGATED 는 STAY 로 유지한다.
     */
    private void decideResults(List<LeagueArenaUser> ranked, LeagueTierConfig config, int minTier, int maxTier) {
        // 활동 0초 멤버 — 컷오프 계산에서 제외하고 무조건 강등
        ranked.stream()
                .filter(member -> member.getTotalFocusSeconds() == 0)
                .forEach(member -> member.setResult(LeagueMemberResult.RELEGATED));

        List<LeagueArenaUser> actives = ranked.stream()
                .filter(member -> member.getTotalFocusSeconds() > 0)
                .toList();
        int activeCount = actives.size();
        int promotedEnd = Math.min(config.getPromoteCount(), activeCount);
        int relegateStart = Math.max(promotedEnd, activeCount - config.getRelegateCount());
        int warningStart = Math.max(promotedEnd, relegateStart - config.getRelegateWarningCount());
        for (int i = 0; i < activeCount; i++) {
            LeagueArenaUser member = actives.get(i);
            if (i < promotedEnd) {
                member.setResult(LeagueMemberResult.PROMOTED);
            } else if (i >= relegateStart) {
                member.setResult(LeagueMemberResult.RELEGATED);
            } else if (i >= warningStart) {
                member.setResult(LeagueMemberResult.RELEGATE_WARNING);
            } else {
                member.setResult(LeagueMemberResult.STAY);
            }
        }

        // 경계 보정 — 최상위 티어는 PROMOTED 없음, 최하위 티어는 RELEGATED 없음(티어 유지)
        int tierLevel = config.getTierLevel();
        for (LeagueArenaUser member : ranked) {
            if (tierLevel >= maxTier && member.getResult() == LeagueMemberResult.PROMOTED) {
                member.setResult(LeagueMemberResult.STAY);
            }
            if (tierLevel <= minTier && member.getResult() == LeagueMemberResult.RELEGATED) {
                member.setResult(LeagueMemberResult.STAY);
            }
        }
    }

    // 확정 결과 → 다음 주차 티어 레벨 (PROMOTED +1 / RELEGATED -1 / 나머지 유지)
    private int nextTierLevel(LeagueArenaUser member) {
        int tierLevel = member.getTierLevel();
        return switch (member.getResult()) {
            case PROMOTED -> tierLevel + 1;
            case RELEGATED -> tierLevel - 1;
            case STAY, RELEGATE_WARNING -> tierLevel;
        };
    }

    /**
     * 책임(3)(4) 다음 주차 아레나 생성 + 멤버 재배정 + 0 리셋.
     *
     * <p>티어별 편입 풀을 arenaSize 단위로 순차 분할한다(마지막 아레나 정원 미달 허용).
     * 멤버는 신규 row 로 생성해 totalFocusSeconds=0, rank=null, result=null 로 자연 리셋된다.
     */
    private int reassignNextWeek(
            Map<Integer, List<User>> nextWeekPools,
            Map<Integer, LeagueTierConfig> tierConfigs,
            Instant weekStartAt) {
        int createdArenaCount = 0;
        for (Map.Entry<Integer, List<User>> pool : nextWeekPools.entrySet()) {
            LeagueTierConfig config = requireTierConfig(tierConfigs, pool.getKey());
            List<User> users = pool.getValue();
            int arenaSize = Math.max(1, config.getArenaSize()); // 잘못된 설정(0 이하) 방어
            for (int from = 0; from < users.size(); from += arenaSize) {
                List<User> chunk = users.subList(from, Math.min(from + arenaSize, users.size()));
                LeagueArena newArena = leagueArenaRepository.save(LeagueArena.builder()
                        .tierConfig(config)
                        .startedAt(weekStartAt)
                        .status(LeagueArenaStatus.ACTIVE)
                        .build());
                List<LeagueArenaUser> newMembers = chunk.stream()
                        .map(user -> LeagueArenaUser.builder()
                                .leagueArena(newArena)
                                .user(user)
                                .tierLevel(config.getTierLevel())
                                .totalFocusSeconds(0)
                                .build())
                        .toList();
                leagueArenaUserRepository.saveAll(newMembers);
                // GROMO-671: 티어는 league_arena_users.tier_level 로만 도출 —
                // User.current_tier 컬럼 제거로 배치의 티어 미러링 갱신도 삭제.
                createdArenaCount++;
            }
        }
        return createdArenaCount;
    }

    // 소프트딜리트되지 않은 티어 설정 전체 (티어 레벨 → 설정)
    private Map<Integer, LeagueTierConfig> loadTierConfigs() {
        Map<Integer, LeagueTierConfig> tierConfigs = leagueTierConfigRepository.findAll().stream()
                .filter(config -> config.getDeletedAt() == null)
                .collect(Collectors.toMap(LeagueTierConfig::getTierLevel, Function.identity()));
        if (tierConfigs.isEmpty()) {
            throw new LeagueException(LeagueErrorCode.TIER_CONFIG_NOT_FOUND);
        }
        return tierConfigs;
    }

    private LeagueTierConfig requireTierConfig(Map<Integer, LeagueTierConfig> tierConfigs, int tierLevel) {
        LeagueTierConfig config = tierConfigs.get(tierLevel);
        if (config == null) {
            throw new LeagueException(LeagueErrorCode.TIER_CONFIG_NOT_FOUND);
        }
        return config;
    }
}
