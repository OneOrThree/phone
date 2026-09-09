package com.oneorthree.phone.league.service;

import com.oneorthree.phone.currency.repository.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.currency.support.CurrencyRewardPolicy;
import com.oneorthree.phone.league.repository.domain.LeagueRankingRow;
import com.oneorthree.phone.league.repository.domain.LeagueTierConfig;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.league.repository.LeagueWeeklyResultRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

/**
 * 유저 <b>한 명</b>의 주간 리그 정산 — 이 클래스의 트랜잭션 경계가 곧 "유저 단위 롤백"의 단위다
 * (GROMO-1218).
 *
 * <p>배치 진입점({@link LeagueBatchService})과 클래스를 나눈 이유는 자기 호출(self-invocation)로는
 * 프록시를 타지 않아 건별 트랜잭션이 성립하지 않기 때문이다({@code GroupBetSettler} 선례). 한 명이
 * 예외로 터져도 그 유저만 롤백되고 나머지 정산은 계속된다.
 *
 * <p><b>탈퇴 레이스 방어</b> — 집계 스냅샷({@link LeagueRankingRow})은 페이지 조회 시점의 것이라,
 * READ COMMITTED 에서는 그 사이 탈퇴가 커밋된 유저가 섞여 있을 수 있다. 여기서
 * {@link UserQueryService#findActiveForUpdate} <b>배타 락 재조회</b>가 셋 중 하나로 확정한다:
 * ① 탈퇴가 이미 커밋됨 → empty → 예외 없이 skip, ② 탈퇴 트랜잭션이 락을 쥐고 진행 중 → 커밋까지
 * 대기 후 술어 재평가(is_deleted=true)로 empty → skip, ③ 활성 → 이 트랜잭션이 락을 쥔다.
 * 배타 락인 이유는 락 선택 원칙(UserRepository 주석) — 아래 {@code setTierLevel} 이 users 행
 * UPDATE 라 "그 트랜잭션이 users 행을 변경하면 처음부터 배타 락"에 해당하고, 공유 락으로 읽고
 * 나중에 UPDATE 하면 탈퇴와 락 승급 교착이 난다. 또 User 에는 @Version/@DynamicUpdate 가 없어
 * 커밋 시 전체 컬럼을 이 트랜잭션의 스냅샷으로 덮어쓰는데, 락 없이 진행하면 탈퇴가 파기한 PII 를
 * 옛 스냅샷으로 되살릴 수 있다(lost update) — 락 재조회가 그 창도 닫는다.
 *
 * <p><b>지갑 생존 논증</b> — 락을 쥔 동안엔 탈퇴가 이 유저 행의 락 대기로 직렬화된다.
 * {@code UserService.withdraw} 는 같은 배타 락 조회로 유저 행을 먼저 잠근
 * 뒤에야 user_wallets 를 지우므로, 이 트랜잭션이 락을 쥔 시점에 지갑은 반드시 살아 있다 — 승급
 * 보너스 credit 이 지갑 NOT_FOUND 로 터질 수 없다. 잠금 순서도 양쪽 다 "유저 행 → 지갑"이라
 * 교착이 없다. 단, 이 논증은 {@code UserService.withdraw}(유저 행 배타 락 → user_wallets
 * deleteById)가 user_wallets 의 <b>유일한 삭제 경로</b>라는 현재 상태에 의존하는 불변식이다 —
 * GDPR retention→purge 배치({@code User.isDeleted} 주석, GROMO-671) 구현 시 같은 락 규율
 * (유저 행 배타 락 선취득 후 지갑 삭제)을 따르지 않으면 조용히 깨진다. 그 시점에 반드시 재확인할 것.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeagueUserSettler {

    static final int MIN_TIER_LEVEL = 1;
    static final int MAX_TIER_LEVEL = 5;

    /**
     * settle 한 건의 처리 결과 (GROMO-1239) — boolean 두 갈래로는 "이미 정산됨"을 표현할 수 없어
     * 세 갈래 enum 으로 넓혔다({@code GroupBetSettler.SettleResult} 선례).
     */
    public enum SettleOutcome {
        /** 이번 호출로 3-mutation(티어 갱신·승급 보너스·결과 저장)이 실제 적용됐다. */
        SETTLED,
        /** 집계 스냅샷 이후 탈퇴가 먼저 커밋된 유저 — 정상 흐름의 skip. */
        SKIPPED_WITHDRAWN,
        /** 이 주차 완료 마커(league_weekly_results 행)가 이미 있다 — 재실행 멱등 skip. */
        ALREADY_SETTLED,
        /**
         * 대상 주차보다 <b>늦은</b> 주차 결과가 이미 있다 — 과거 주차 소급(backfill) 금지 skip.
         * 티어 체인이 이미 전진한 유저라 지금 과거 주를 정산하면 순서가 어긋난다(아래 settle 자바독).
         */
        SKIPPED_SUPERSEDED
    }

    private final UserQueryService userQueryService;
    private final LeagueWeeklyResultRepository leagueWeeklyResultRepository;
    private final CurrencyLedgerService currencyLedgerService;

    /**
     * 유저 한 명을 정산한다 — 결과 저장·티어 갱신·승급 보너스까지 이 트랜잭션 하나에 묶인다.
     *
     * <p><b>재실행 멱등 가드 (GROMO-1239)</b> — 락 취득 직후, 어떤 mutation 보다 먼저 완료 마커
     * (league_weekly_results 의 (user_id, week_start_at) 행)를 재확인한다. 오케스트레이터의 페이지
     * 단위 선조회는 빠른 경로일 뿐이고, 락 안에서의 이 단건 재확인이 동시성 정본이다 — 동시 재실행이
     * 같은 유저를 잡아도 늦은 쪽이 락 대기 후 여기서 ALREADY_SETTLED 로 빠진다. 가드 없이 진행하면
     * 이미 승급이 반영된 티어로 판정을 다시 굴려 연쇄 승급(래칫)이 나고, 유니크 제약 위반이 flush
     * 에서 터져 트랜잭션 전체가 롤백되며 전원 failed 로 집계되는 사고 구조가 된다. 유니크 제약
     * 자체는 최후 방어선으로 유지한다.
     *
     * <p><b>티어 정본 = 락으로 잡은 행 (교차 주차 레이스)</b> — 판정 기준 티어는 스냅샷
     * {@code row.tierLevel()} 이 아니라 락 취득 후의 {@code user.getTierLevel()} 이다. 스냅샷 티어는
     * 페이지 조회 시점 값이라 <b>락 대기 중의 커밋을 놓친다</b>: 예컨대 새 주차 run 이 스냅샷을 뜬
     * 뒤 과거 주차 resume 이 먼저 락을 잡아 승급(T→T+1)을 커밋하면, 새 주차 run 은 위 마커 가드
     * (대상 주차 <b>이상</b>만 조회)로는 그 과거 주차 결과를 못 보고 진행하는데, 이때 스냅샷 티어
     * T 를 쓰면 이전 티어 기록·티어 덮어쓰기가 모두 어긋난다. 락으로 잡은 행을 다시 읽으면 어떤
     * 인터리빙에서도 두 번째로 락을 잡는 쪽이 커밋된 진실 위에서 판정하므로 이 계열의 스냅샷
     * 낡음(stale) 문제가 통째로 사라진다. tierConfigs 는 배치 시작 시 1~5 전부 검증되므로 어떤
     * 티어를 읽어도 설정 조회는 안전하다.
     *
     * <p><b>과거 주차 소급(backfill) 순서 논증</b> — 대상 주차보다 <b>늦은</b> 주차 결과가 이미 있는
     * 유저도 같은 조회 한 번으로 걸러 SKIPPED_SUPERSEDED 로 스킵한다. 늦은 주차 결과는 그 시점의
     * 라이브 티어에서 계산된 것이므로, 지금 과거 주 W 를 소급하면 ① 이미 전진한 오늘의 티어를 W 의
     * "이전 티어"로 삼아 승급/강등을 겹쳐 굴리고(잘못된 기준·연쇄 승급) ② 승급 보너스도 잘못된
     * 티어 기준으로 이중 지급된다. 실제 복구 대상(그 주 정산에 실패한 유저)은 늦은 주차 결과가
     * 없다 — 있다면 이미 다음 주차가 그 유저를 (그때의 티어로) 정산해 체인을 이어간 것이므로
     * W 소급은 어느 경우든 체인을 오염시킨다. 따라서 이 스킵이 정확히 옳은 동작이다.
     *
     * @param row               정산 대상 집계 행(배치 페이지 조회 시점 스냅샷) — userId·focusSeconds
     *                          만 쓴다. tierLevel 스냅샷은 낡을 수 있어 무시한다(위 "티어 정본" 문단)
     * @param previousWeekStart 정산 대상 주차의 시작(KST 월요일 00:00 Instant) — 결과 키
     * @param tierConfigs       배치 시작 시 1~5 전부 검증된 티어 설정 표
     * @return 정산을 적용했으면 {@link SettleOutcome#SETTLED}, 탈퇴가 먼저 커밋된 유저면
     *         {@link SettleOutcome#SKIPPED_WITHDRAWN}, 이 주차가 이미 정산된 유저면
     *         {@link SettleOutcome#ALREADY_SETTLED}, 더 늦은 주차가 이미 정산된 유저면
     *         {@link SettleOutcome#SKIPPED_SUPERSEDED}
     */
    @Transactional
    public SettleOutcome settle(LeagueRankingRow row, Instant previousWeekStart,
                                Map<Integer, LeagueTierConfig> tierConfigs) {
        Optional<User> activeUser = userQueryService.findActiveForUpdate(row.userId());
        if (activeUser.isEmpty()) {
            // 집계 스냅샷 이후 탈퇴가 먼저 커밋된 유저 — 정상 흐름이므로 예외가 아니라 skip 이다.
            log.info("리그 정산 스킵 — 집계 후 탈퇴한 유저. userId={}", row.userId());
            return SettleOutcome.SKIPPED_WITHDRAWN;
        }
        // 재실행 멱등 가드 — 락을 쥔 뒤의 재확인이라 동시 재실행에도 정확히 한 번만 정산된다.
        // 대상 주차와 그 이후를 한 번의 인덱스 조회로 판정한다(같음=기정산, 큼=늦은 주차가 선정산).
        Optional<Instant> latestSettledWeek = leagueWeeklyResultRepository
                .findLatestSettledWeekOnOrAfter(row.userId(), previousWeekStart);
        if (latestSettledWeek.isPresent()) {
            if (latestSettledWeek.get().equals(previousWeekStart)) {
                log.info("리그 정산 스킵 — 이미 정산된 주차. userId={}, weekStartAt={}",
                        row.userId(), previousWeekStart);
                return SettleOutcome.ALREADY_SETTLED;
            }
            // 과거 주차 소급 금지(이 메서드 자바독의 순서 논증) — 티어 체인이 이미 이 주차를 지나갔다.
            log.info("리그 정산 스킵 — 더 늦은 주차가 이미 정산됨(소급 금지). userId={}, "
                    + "weekStartAt={}, latestSettledWeek={}",
                    row.userId(), previousWeekStart, latestSettledWeek.get());
            return SettleOutcome.SKIPPED_SUPERSEDED;
        }
        User user = activeUser.get();

        // 티어 정본은 스냅샷(row.tierLevel())이 아니라 락으로 잡은 유저 행이다 — 스냅샷은 페이지
        // 조회 시점 값이라, 락 대기 중에 커밋된 다른 주차 정산(예: 과거 주차 resume 의 승급)을
        // 놓친다. 락을 두 번째로 잡는 쪽이 항상 커밋된 진실 위에서 판정하도록 여기서 다시 읽는다.
        int previousTierLevel = user.getTierLevel();
        LeagueTierConfig config = tierConfigs.get(previousTierLevel);
        if (config == null) {
            // 배치 시작 시 1~5 전부 검증하므로 정상 흐름에선 불가능 — 이 유저만 롤백시킨다.
            throw new IllegalStateException(
                    "티어 설정 없음 — tierLevel=" + previousTierLevel + ", userId=" + row.userId());
        }
        LeagueWeeklyResultType result = decideResult(previousTierLevel, row.totalFocusSeconds(), config);
        int newTierLevel = switch (result) {
            case PROMOTED -> previousTierLevel + 1;
            case RELEGATED -> previousTierLevel - 1;
            case STAY -> previousTierLevel;
        };
        user.setTierLevel(newTierLevel);
        if (result == LeagueWeeklyResultType.PROMOTED) {
            // 승급 보너스 지급(GROMO-395) — 승급(PROMOTED)일 때만. 승급 후 티어 레벨로 금액을 산정하고
            // 멱등키 league:{weekStartAt}:{userId}(주차·유저 유니크 재사용)로 이 정산 트랜잭션에 함께 기입한다.
            int bonus = CurrencyRewardPolicy.leaguePromotionReward(newTierLevel);
            if (bonus > 0) {
                currencyLedgerService.credit(CurrencyLedgerService.WalletOwner.TARGET, user,
                        CurrencyTransactionType.LEAGUE_TIER_BONUS, bonus,
                        "league:" + previousWeekStart + ":" + user.getId());
            }
        }
        leagueWeeklyResultRepository.save(LeagueWeeklyResult.builder()
                .user(user)
                .weekStartAt(previousWeekStart)
                .previousTierLevel(previousTierLevel)
                .newTierLevel(newTierLevel)
                .result(result)
                .focusSeconds(row.totalFocusSeconds())
                .build());
        return SettleOutcome.SETTLED;
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
}
