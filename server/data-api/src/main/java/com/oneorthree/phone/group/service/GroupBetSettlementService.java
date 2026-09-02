package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.SettleTrigger;
import com.oneorthree.phone.group.dto.GroupBetSettlementSummaryResponse;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 내기 <b>수동(MANUAL) 배치</b> 진입점 — 회차별 {@code settle_after} 가 지난 미정산 <b>회차</b>
 * (GROMO-1262)를 훑어 {@link GroupBetSettler#settle} 에 한 건씩 넘긴다. 정규 정산은 같은 축의
 * 5분 스캔({@code GroupBetScheduler} — GROMO-1269·1411)이고, 이 클래스는 운영자 수동 트리거
 * ({@code GroupBetBatchController})의 복구 배치다.
 *
 * <p>이 클래스에는 <b>트랜잭션이 없다</b>. 건별 트랜잭션(정산 실패 격리)이 목적이라, 여기서 하나로
 * 묶으면 한 건의 롤백이 전체를 되돌린다. 대상 id 조회도 각자 짧은 트랜잭션으로 끝난다.
 *
 * <p><b>대상 선택은 회차별 {@code settle_after} 경과다</b>(GROMO-1411 후속) — 종전 날짜 축
 * ({@code session_date < today})은 당일 회차(오전 창형 등)를 못 잡아, 운영자가 당일 장애 회차를
 * 24h 자동 환불 전에 수동 복구할 수 없었다. 5분 스캔과 달리 백오프({@code next_attempt_at})는
 * 무시한다 — 수동 복구는 "지금" 재시도하겠다는 뜻이다. 가드는 정산 본체가 진다(단일 진입점):
 * 그레이스 미경과·창형 FOCUS 대기 회차는 settle 안에서 스킵되고, 24h 초과분은 정산 대신 자동
 * 전원 환불된다(N21). 해외 타임존 유저는 KST 하루 경계로 정산된다(서비스가 한국 타깃이라 수용,
 * 후속 티켓).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GroupBetSettlementService {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** 실패 요약 로그에 실을 sessionId 상한 — 대량 실패 시 로그 한 줄이 무한정 길어지지 않게 자른다. */
    static final int FAILED_SESSION_ID_LOG_LIMIT = 20;

    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupBetSettler groupBetSettler;

    /**
     * {@code settle_after} 가 지난 OPEN 회차를 정산한다 — 수동 트리거의 진입점.
     *
     * @param category 이 카테고리의 챌린지에 걸린 내기만 정산한다. {@code null} 이면 전 카테고리
      * @return 대상·분배·몰수·환불·스킵·실패 건수와 소요 시간. 한 건의 실패는 그 회차만 롤백하고
      *     나머지는 계속 돈다
     */
    public GroupBetSettlementSummaryResponse settleDueBets(MissionCategory category) {
        return settleDueBets(Instant.now(), category);
    }

    /**
     * @param now      실행 기준 시각 — {@code settle_after <= now} 인 OPEN 회차가 대상이다
     * @param category 대상 챌린지 카테고리. {@code null} 이면 전 카테고리
      * @return 이 실행의 처리 요약. 다른 실행(5분 스캔 ↔ 수동 트리거)이 먼저 정산한 회차는 스킵으로
      *     세므로 동시 실행끼리 같은 회차를 각자 성과로 중복 집계하지 않는다
     */
    public GroupBetSettlementSummaryResponse settleDueBets(Instant now, MissionCategory category) {
        long startedAtMillis = System.currentTimeMillis();
        List<UUID> targets = category == null
                ? groupChallengeBetSessionRepository
                        .findIdsByStatusAndSettleAfterBefore(GroupBetStatus.OPEN, now)
                : groupChallengeBetSessionRepository.findIdsByStatusAndSettleAfterBeforeAndCategory(
                        GroupBetStatus.OPEN, now, category);

        int settled = 0;
        int forfeited = 0;
        int refunded = 0;
        int skipped = 0;
        List<UUID> failedSessionIds = new ArrayList<>();
        for (UUID sessionId : targets) {
            try {
                // 대상으로 집은 뒤 다른 실행(스케줄러 ↔ 수동 트리거)이 먼저 정산했을 수 있다.
                // 그때는 최종 상태만 종료 상태일 뿐 이 호출은 지급을 안 했으므로 스킵으로 센다
                // — 안 그러면 동시 실행 양쪽이 같은 회차를 각자 성과로 세어 요약·지표가 부풀려진다.
                // MANUAL 트리거도 24h 환불·그레이스·창형 FOCUS 대기 가드를 전부 지난다(N21 —
                // 단일 진입점 GROMO-1411). 그레이스 미경과 회차는 applied=false 스킵으로 떨어진다.
                GroupBetSettler.SettleResult result =
                        groupBetSettler.settle(sessionId, SettleTrigger.MANUAL);
                if (!result.applied()) {
                    skipped++;
                } else if (result.status() == GroupBetStatus.FORFEITED) {
                    forfeited++;
                } else if (result.status() == GroupBetStatus.SETTLED) {
                    settled++;
                } else if (result.status() == GroupBetStatus.REFUNDED) {
                    // 24h 데드라인 자동 전원 환불(N21) — 몰수·분배와 구분해 집계한다.
                    refunded++;
                } else {
                    // UNUSED(참가자 0명 종료)·VOIDED(인원 미달 무산) — 지급 없는 정리라 성과
                    // 버킷에 넣지 않고, 응답 shape 호환을 위해 스킵으로 센다(요약 합계 보존).
                    skipped++;
                }
            } catch (RuntimeException e) {
                // 이 회차만 롤백된 상태다. 다른 회차 정산을 막지 않도록 삼키고 기록만 남긴다.
                failedSessionIds.add(sessionId);
                log.error("회차 정산 실패 — 해당 건 롤백. sessionId={}", sessionId, e);
            }
        }

        int failed = failedSessionIds.size();
        long elapsedMillis = System.currentTimeMillis() - startedAtMillis;
        log.info("내기 수동 배치 완료 — now={}, category={}, 대상={}, 분배={}, 몰수={}, 환불={}, 스킵={}, "
                + "실패={}, elapsedMillis={}",
                now, category == null ? "ALL" : category, targets.size(), settled, forfeited, refunded,
                skipped, failed, elapsedMillis);
        // 배치 종료 요약(B4 ops) — 건별 error 로그는 스택트레이스에 묻혀 "이번 배치에서 몇 건이
        // 실패했나" 를 한눈에 못 본다. 알림 규칙을 걸 수 있게 고정 포맷 한 줄로 다시 남긴다.
        // 크론이 카테고리별 2회로 나뉜 뒤로는 어느 배치의 실패인지도 함께 실어야 추적이 된다.
        if (failed > 0) {
            log.error("내기 정산 실패 요약 — category={}, 실패 {}건, sessionIds={}{}",
                    category == null ? "ALL" : category,
                    failed,
                    failedSessionIds.stream().limit(FAILED_SESSION_ID_LOG_LIMIT).toList(),
                    failed > FAILED_SESSION_ID_LOG_LIMIT
                            ? " (앞 " + FAILED_SESSION_ID_LOG_LIMIT + "건만 표시)" : "");
        }
        // refunded 버킷은 24h 데드라인 자동 환불(N21·GROMO-1411)이 다시 쓴다(종전엔 상시 0 레거시).
        // settledBefore 는 실행 기준일(KST) — 선택 축이 settle_after 로 바뀌었지만 shape 는 유지한다.
        return new GroupBetSettlementSummaryResponse(LocalDate.ofInstant(now, KST),
                targets.size(), settled, forfeited, refunded, skipped, failed, elapsedMillis);
    }
}
