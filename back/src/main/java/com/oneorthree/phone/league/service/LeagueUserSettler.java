package com.oneorthree.phone.league.service;

import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.currency.service.CurrencyRewardPolicy;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.league.repository.LeagueWeeklyResultRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
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
 * {@link UserRepository#findActiveByIdForUpdate} <b>배타 락 재조회</b>가 셋 중 하나로 확정한다:
 * ① 탈퇴가 이미 커밋됨 → empty → 예외 없이 skip, ② 탈퇴 트랜잭션이 락을 쥐고 진행 중 → 커밋까지
 * 대기 후 술어 재평가(is_deleted=true)로 empty → skip, ③ 활성 → 이 트랜잭션이 락을 쥔다.
 * 배타 락인 이유는 락 선택 원칙(UserRepository 주석) — 아래 {@code setTierLevel} 이 users 행
 * UPDATE 라 "그 트랜잭션이 users 행을 변경하면 처음부터 배타 락"에 해당하고, 공유 락으로 읽고
 * 나중에 UPDATE 하면 탈퇴와 락 승급 교착이 난다. 또 User 에는 @Version/@DynamicUpdate 가 없어
 * 커밋 시 전체 컬럼을 이 트랜잭션의 스냅샷으로 덮어쓰는데, 락 없이 진행하면 탈퇴가 파기한 PII 를
 * 옛 스냅샷으로 되살릴 수 있다(lost update) — 락 재조회가 그 창도 닫는다.
 *
 * <p><b>지갑 생존 논증</b> — 락을 쥔 동안엔 탈퇴가 이 유저 행의 락 대기로 직렬화된다.
 * {@code UserService.withdraw} 는 같은 {@code findActiveByIdForUpdate} 로 유저 행을 먼저 잠근
 * 뒤에야 user_wallets 를 지우므로, 이 트랜잭션이 락을 쥔 시점에 지갑은 반드시 살아 있다 — 승급
 * 보너스 credit 이 지갑 NOT_FOUND 로 터질 수 없다. 잠금 순서도 양쪽 다 "유저 행 → 지갑"이라
 * 교착이 없다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeagueUserSettler {

    static final int MIN_TIER_LEVEL = 1;
    static final int MAX_TIER_LEVEL = 5;

    private final UserRepository userRepository;
    private final LeagueWeeklyResultRepository leagueWeeklyResultRepository;
    private final CurrencyLedgerService currencyLedgerService;

    /**
     * 유저 한 명을 정산한다 — 결과 저장·티어 갱신·승급 보너스까지 이 트랜잭션 하나에 묶인다.
     *
     * @param row               정산 대상 집계 행(배치 페이지 조회 시점 스냅샷)
     * @param previousWeekStart 정산 대상 주차의 시작(KST 월요일 00:00 Instant) — 결과 키
     * @param tierConfigs       배치 시작 시 1~5 전부 검증된 티어 설정 표
     * @return 정산을 적용했으면 true, 탈퇴가 먼저 커밋된 유저라 건너뛰었으면 false
     */
    @Transactional
    public boolean settle(LeagueRankingRow row, Instant previousWeekStart,
                          Map<Integer, LeagueTierConfig> tierConfigs) {
        Optional<User> activeUser = userRepository.findActiveByIdForUpdate(row.userId());
        if (activeUser.isEmpty()) {
            // 집계 스냅샷 이후 탈퇴가 먼저 커밋된 유저 — 정상 흐름이므로 예외가 아니라 skip 이다.
            log.info("리그 정산 스킵 — 집계 후 탈퇴한 유저. userId={}", row.userId());
            return false;
        }
        User user = activeUser.get();

        int previousTierLevel = row.tierLevel();
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
                currencyLedgerService.credit(user, CurrencyTransactionType.LEAGUE_TIER_BONUS, bonus,
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
        return true;
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
