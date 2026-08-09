package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * 판돈 동결 감지 <b>+ 처분</b>(B4 ops · 정책 §E1) — 정산 배치가 조용히 죽어 <b>에스크로된 판돈이
 * 묶여 있는</b> 상태를 드러내고, 24시간을 넘긴 회차는 무효화해 전원에게 참가비를 돌려준다.
 *
 * <p>내기는 참가 즉시 판돈이 차감(에스크로)되고 정산에서야 풀린다. 그래서 정산이 실패·누락되면 유저
 * 돈이 사라진 것처럼 보이는데, 배치 자체가 안 돌면 실패 로그조차 안 남아 아무도 모른다. 하루에 한 번
 * "정산됐어야 할 나이" 의 OPEN 내기를 훑는다.
 *
 * <p>임계: {@code bet_date ≤ 오늘 − 2}. 어제 내기는 오늘 01:00·12:00 배치의 대상이라 아직 정상이고,
 * 그제 것이 OPEN 이면 배치가 최소 한 번은 걸렀다는 뜻이다(≈ 24h 이상 동결).
 *
 * <p><b>GROMO-1258 이전에는 감지가 error 로그만 남기고 끝났다</b>. 영구 실패 3종(참가자 유실 ·
 * 챌린지 목표 유실 · 분배 불변식 위반)은 다음날 크론도 같은 지점에서 실패하므로, 사람이 개입하기
 * 전까지 참가비가 무기한 묶였다 — prod 에는 수동 정산 트리거조차 없었다. 이제 감지한 건을 곧바로
 * {@link GroupBetService#refundFrozenBet} 로 넘겨 닫는다.
 *
 * <p>처분은 <b>건별 트랜잭션</b>이다(정산 배치와 같은 격리 규율) — 이 클래스에는 루프를 감싸는
 * 트랜잭션이 없어야 한다. 한 건이 터져도 나머지 환불이 계속된다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GroupBetFreezeMonitor {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** 동결로 보는 나이(일) — bet_date 가 오늘 − 이 값 이하면 정산 기회를 이미 놓친 것이다. */
    static final int FROZEN_AGE_DAYS = 2;

    /** 로그에 실을 betId 상한 — 대량 동결 시 로그 한 줄이 무한정 길어지지 않게 자른다. */
    static final int LOGGED_BET_ID_LIMIT = 20;

    private final GroupChallengeBetRepository groupChallengeBetRepository;
    private final GroupBetService groupBetService;

    /**
     * 동결 처분 요약.
     *
     * @param detectedCount 동결로 판정된 OPEN 내기 수
     * @param refundedCount 이번 실행이 실제로 무효화·환불한 회차 수
     * @param failedCount   해당 건만 롤백된 실패 수 — 0 이 아니면 에러 로그를 봐야 한다
     */
    public record FrozenSweepSummary(int detectedCount, int refundedCount, int failedCount) {
    }

    /** 스케줄러(09:00 KST) 진입점 — 감지 + 자동 환불. */
    public FrozenSweepSummary sweepFrozenBets() {
        return sweepFrozenBets(Instant.now());
    }

    /**
     * 감지한 동결 회차를 전부 무효화·환불한다(정책 §E1).
     *
     * <p>회차는 <b>id 오름차순</b>으로 처분한다 — 건별 트랜잭션이라 내기 잠금을 동시에 둘 이상
     * 쥐지는 않지만, 돈이 움직이는 모든 경로가 공유하는 잠금 순서 규약(내기 id → 지갑 userId)을
     * 여기서도 깨지 않기 위해서다.
     */
    public FrozenSweepSummary sweepFrozenBets(Instant now) {
        List<UUID> frozen = frozenBetIds(now);
        int refunded = 0;
        int failed = 0;
        for (UUID betId : frozen) {
            try {
                if (groupBetService.refundFrozenBet(betId)) {
                    refunded++;
                }
            } catch (RuntimeException e) {
                // 이 회차만 롤백된 상태다 — 다음 실행(내일 09:00)이 다시 집는다.
                failed++;
                log.error("내기 24h 동결 자동 환불 실패 — 해당 건 롤백. betId={}", betId, e);
            }
        }
        if (!frozen.isEmpty()) {
            log.error("판돈 24h 동결 처분 완료 — 대상 {}건, 무효화·환불 {}건, 실패 {}건",
                    frozen.size(), refunded, failed);
        }
        return new FrozenSweepSummary(frozen.size(), refunded, failed);
    }

    /**
     * 감지만(처분 없음) — 읽기 전용 ops 프로브. 경계 규칙({@code bet_date ≤ 오늘 − 2})의 계약
     * 지점이라 {@link #sweepFrozenBets} 와 별개로 남겨 둔다.
     *
     * @return 동결로 판정된 OPEN 내기 수(0 이면 정상)
     */
    @Transactional(readOnly = true)
    public int detectFrozenBets(Instant now) {
        return frozenBetIds(now).size();
    }

    private List<UUID> frozenBetIds(Instant now) {
        LocalDate today = LocalDate.ofInstant(now, KST);
        // findIdsByStatusAndBetDateBefore 는 bet_date < beforeDate 라, 오늘−1 을 주면 bet_date ≤ 오늘−2 다.
        List<UUID> frozen = groupChallengeBetRepository
                .findIdsByStatusAndBetDateBefore(
                        GroupBetStatus.OPEN, today.minusDays(FROZEN_AGE_DAYS - 1L))
                .stream()
                .sorted()
                .toList();
        if (frozen.isEmpty()) {
            log.info("판돈 동결 감지 — 없음 (기준일 {})", today);
            return frozen;
        }
        log.error("판돈 24h 이상 동결 — 미정산 OPEN 내기 {}건, betIds={}{}",
                frozen.size(),
                frozen.stream().limit(LOGGED_BET_ID_LIMIT).toList(),
                frozen.size() > LOGGED_BET_ID_LIMIT ? " (앞 " + LOGGED_BET_ID_LIMIT + "건만 표시)" : "");
        return frozen;
    }
}
