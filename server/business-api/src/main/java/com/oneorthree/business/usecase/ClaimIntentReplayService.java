package com.oneorthree.business.usecase;

import com.oneorthree.business.common.exception.UpstreamContractMismatchException;

import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.ClaimIntentLease;
import com.oneorthree.business.upstream.data.dto.ClaimIntentPage;
import com.oneorthree.business.upstream.data.dto.DurableCommandAck;
import com.oneorthree.business.upstream.link.LinkApiClient;
import com.oneorthree.business.upstream.link.dto.LinkClaimResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * 정지 창에 {@code 202} 로 받은 claim 의도를 재개한다 — §7.2 재개 단계의 CLI 로직.
 *
 * <h2>왜 이것이 필요한가 (그리고 왜 크론이 아닌가)</h2>
 * {@code 202} 는 「나중에 누가 끝낸다」는 약속인데, 그 주체가 될 수 있는 것이 셋 다 막혀 있다:
 * <ul>
 *   <li>Business 에 {@code @Scheduled} 를 넣으면 §6 의 「Business 크론 없음」이 깨진다.</li>
 *   <li>Data 는 링크를 relay 허용목록 밖으로 부를 수 없다(§3) — claim 의 <b>잠정 기록</b>은 그 목록에
 *       없다(목록은 withdraw · revoke · joined · claimConfirmed · 스냅샷 갱신 · group.closed).</li>
 *   <li>링크는 코어를 부를 수 없다(§3 단방향).</li>
 * </ul>
 * 남는 답은 <b>Business 의 조합 코드를 운영자가 일회성으로 실행하는 것</b>이다. 실행 시점은
 * {@link ClaimIntentReplayRunner} 가 정하므로 <b>서빙 프로세스에는 이 동작을 시작하는 장치가 없다</b>.
 *
 * <h2>재생이 중복을 만들지 않는 이유</h2>
 * 의도에 담긴 <b>원래 {@code Idempotency-Key}</b> 를 그대로 쓴다(A22 ㉼). 새 키를 만들면 링크 서버의
 * 멱등 저장이 이 claim 을 «새 명령»으로 보아 <b>클릭을 하나 더 소진</b>한다. 키가 비어 오면
 * 재생하지 않고 실패로 센다.
 *
 * <p>그래서 저장값에서 <b>base 를 복원</b>해 쓴다({@link RequestIdempotencyKeys#fromStepKey}) —
 * 저장된 것은 원 요청이 «적재 단계»에 쓴 {@code base:claim-intent} 이고, 그것을 base 로 삼으면
 * 파생 키가 원 시도와 달라진다.
 *
 * <h2>lease 는 토큰으로 CAS 한다</h2>
 * {@code leased} 만 보면 <b>임대가 만료된 뒤 깨어난 옛 작업자가 「새 임대 소유자의 작업」을 완료
 * 표시</b>해 확정되지 않은 claim 이 큐에서 사라진다. 그래서 임대에 묶인 {@code leaseToken} 을 받아
 * 완료 표시에 실어 보낸다.
 *
 * <h2>「미완료 0」은 빈 페이지가 아니다</h2>
 * 한 순회의 빈 페이지는 <b>지금 집을 수 있는 것이 없다</b>는 뜻일 뿐이다 — 다른 작업자가 lease 를 쥔
 * 행, 재시도 예정 행, 커서가 지난 뒤 적재된 행이 남아 있을 수 있다. 그래서 ⓐ 진행이 있는 동안
 * <b>커서를 처음부터 다시</b> 순회하고 ⓑ gate 판정은 {@code pendingTotal}(인플라이트 포함)로 한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ClaimIntentReplayService {

    private static final int PAGE_SIZE = 100;
    private static final long LEASE_SECONDS = 120L;
    /** 한 건에 주는 예산. 사용자 요청이 아니라 배치라 구 앱의 15초 제한과 무관하다. */
    private static final Duration PER_INTENT_BUDGET = Duration.ofSeconds(30);
    /** 한 순회의 페이지 상한 — 전진하지 않는 커서 버그에서 멈추기 위한 방어다. */
    private static final int MAX_PAGES_PER_SWEEP = 10_000;
    /** 전체 순회 횟수 상한. 진행이 없으면 그 전에 멈춘다. */
    private static final int MAX_SWEEPS = 50;

    private final DataApiClient dataApiClient;
    private final LinkApiClient linkApiClient;

    /**
     * 진행이 없을 때까지 순회하고, 마지막에 전체 미완료를 확인한다.
     *
     * <p>순회를 반복하는 이유: lease 만료로 풀린 행과 커서가 지난 뒤 적재된 행은 <b>같은 순회에서
     * 안 보인다</b>. 그래서 커서 끝에 닿으면 처음부터 다시 조회한다.
     */
    public Result replayAll() {
        Result total = new Result();
        long pendingTotal = -1L;

        for (int sweep = 1; sweep <= MAX_SWEEPS; sweep++) {
            Result pass = sweepOnce();
            total.seen += pass.seen;
            total.completed += pass.completed;
            total.skipped += pass.skipped;
            total.failed += pass.failed;
            pendingTotal = pass.pendingTotal;

            if (pendingTotal == 0L) {
                total.pendingTotal = 0L;
                return total;
            }
            if (pass.completed == 0) {
                // 이번 순회에서 하나도 끝내지 못했다 — 남은 것은 다른 작업자의 lease 나 반복 실패다.
                // 더 돌아도 같은 결과이므로 멈추고, 미완료를 그대로 보고한다(성공으로 위장하지 않는다).
                log.warn("순회 {}회에서 진행 없음 — 남은 미완료 {}건(다른 lease·재시도 예정 포함)",
                        sweep, pendingTotal);
                break;
            }
        }

        total.pendingTotal = pendingTotal;
        return total;
    }

    /** 커서를 처음부터 끝까지 한 번 순회한다. */
    private Result sweepOnce() {
        Result result = new Result();
        String cursor = null;
        for (int page = 0; page < MAX_PAGES_PER_SWEEP; page++) {
            ClaimIntentPage batch =
                    dataApiClient.fetchPendingClaimIntents(cursor, PAGE_SIZE, Deadline.unbounded());
            if (batch == null) {
                throw new IllegalStateException("claim 의도 조회가 본문 없이 돌아왔다 — 미완료를 판정할 수 없다");
            }
            if (batch.pendingTotal() < 0L) {
                throw new UpstreamContractMismatchException("claim 의도 pendingTotal이 음수입니다");
            }
            // ⚠️ 빈 페이지여도 pendingTotal 을 기록한다 — 「지금 집을 것이 없다」와 「전부 끝났다」는 다르다.
            result.pendingTotal = batch.pendingTotal();

            if (batch.items() != null) {
                for (ClaimIntentPage.ClaimIntent intent : batch.items()) {
                    result.seen++;
                    replayOne(intent, result);
                }
            }
            cursor = batch.nextCursor();
            if (cursor == null) {
                return result;
            }
        }
        throw new IllegalStateException(
                "커서가 " + MAX_PAGES_PER_SWEEP + "페이지 동안 끝나지 않았다 — 전진하지 않는 커서를 의심하라");
    }

    private void replayOne(ClaimIntentPage.ClaimIntent intent, Result result) {
        if (intent.idempotencyKey() == null || intent.idempotencyKey().isBlank()) {
            // 원래 키 없이 재생하면 클릭을 하나 더 소진한다. 재생하지 않고 실패로 센다.
            log.error("claim 의도에 원래 Idempotency-Key 가 없다 — 재생하지 않는다. commandId={}",
                    intent.commandId());
            result.failed++;
            return;
        }

        Deadline deadline = Deadline.startingNow(PER_INTENT_BUDGET);
        ClaimIntentLease lease;
        try {
            lease = dataApiClient.leaseClaimIntent(intent.commandId(), LEASE_SECONDS, deadline);
        } catch (RuntimeException e) {
            log.error("claim 의도 lease 실패 — commandId={}", intent.commandId(), e);
            result.failed++;
            return;
        }
        if (lease == null || !lease.leased()) {
            // 다른 소유자가 쥐고 있다. 실패가 아니라 건너뜀이다 — 다음 순회가 집는다.
            result.skipped++;
            return;
        }
        if (lease.leaseToken() == null) {
            // 토큰 없이 완료 표시하면 만료 뒤 깨어난 옛 작업자가 새 임대의 작업을 빼 버린다.
            log.error("lease 응답에 leaseToken 이 없다 — CAS 없이 완료 표시하지 않는다. commandId={}",
                    intent.commandId());
            result.failed++;
            return;
        }

        try {
            // 저장값은 원 요청이 «적재 단계»에 쓴 키(base:claim-intent)다 — 그 값을 다시 base 로 삼으면
            // 링크 claim 키가 base:claim-intent:link-claim 이 되어 원 시도의 base:link-claim 과 달라진다.
            // 상류의 자연키 방어(링크 link_claims · Data findByClaimId)가 지금은 중복을 막아 주지만,
            // 그중 하나라도 걷히는 날 이 키 차이가 곧 클릭 중복 소진이다.
            RequestIdempotencyKeys keys =
                    RequestIdempotencyKeys.fromStepKey(intent.idempotencyKey(), "claim-intent");
            LinkClaimResult pending =
                    linkApiClient.claim(intent.userId(), intent.slug(), keys.forStep("link-claim"), deadline);

            if (pending == null) {
                throw new UpstreamContractMismatchException("잠정 claim 응답에 본문이 없습니다");
            }
            if (pending.claimId() != null) {
                DurableCommandAck confirmed = dataApiClient.confirmClaim(intent.userId(), pending.claimId(),
                        intent.slug(), pending.capability(), keys.forStep("claim-confirm"), deadline);
                log.info("claim 재개 확정 — commandId={} claimId={} version={}",
                        intent.commandId(), pending.claimId(), confirmed.version());
            } else {
                // 셀프 초대·붙일 클릭 없음. 링크 서버가 정상으로 주는 답이고 확정할 것이 없다
                // (link/src/lib/links.ts:145·149) — 완료로 표시해야 큐에서 빠진다.
                log.info("claim 재개 — 붙일 대상 없음. commandId={}", intent.commandId());
            }

            dataApiClient.completeClaimIntent(intent.commandId(), lease.leaseToken(), deadline);
            result.completed++;
        } catch (UpstreamDomainException e) {
            // 상류가 «판정»을 내렸다. 다시 물어도 같은 답인 것만 완료로 표시해 큐에서 뺀다 —
            // 안 그러면 이 한 건이 gate 를 영구히 막는다.
            //
            // ⚠️ «모든» 판정을 종결로 접으면 안 된다. 링크 서버는 실패 본문에 항상 code 를 싣기 때문에
            //    (link/src/lib/errors.ts respond) 경로 허용목록 오배선의 403 까지 도메인 판정으로
            //    들어온다. 그것을 완료로 표시하면 «아무것도 claim 되지 않았는데» 큐가 비고 gate 가
            //    통과한다 — 유실을 성공으로 위장하는 정확한 형태다. 판정 기준은 요청 경로와 같은
            //    자리({@link ClaimIntentTermination})를 쓴다.
            if (!ClaimIntentTermination.isTerminal(e)) {
                log.error("claim 재개 실패 — 종결 대상이 아닌 거절이라 완료 표시하지 않는다."
                        + " commandId={} status={} code={}", intent.commandId(), e.getStatus(), e.getCode());
                result.failed++;
                return;
            }
            log.warn("claim 재개 — 상류 판정으로 종결. commandId={} code={}", intent.commandId(), e.getCode());
            try {
                dataApiClient.completeClaimIntent(intent.commandId(), lease.leaseToken(), e.getCode(),
                        Deadline.startingNow(PER_INTENT_BUDGET));
                result.completed++;
            } catch (RuntimeException markFailure) {
                log.error("판정 종결의 완료 표시 실패 — commandId={}", intent.commandId(), markFailure);
                result.failed++;
            }
        } catch (RuntimeException e) {
            // 판정 불가. lease 만료로 다음 순회가 집는다 — 완료 표시하지 않는다.
            log.error("claim 재개 실패 — commandId={}", intent.commandId(), e);
            result.failed++;
        }
    }

    /**
     * 재개 집계.
     *
     * <p>gate 통과 조건은 {@code failed == 0 && pendingTotal == 0} 이다 — {@code completed} 가 아무리
     * 많아도 {@code pendingTotal} 이 남아 있으면 통과가 아니다.
     */
    public static final class Result {

        private int seen;
        private int completed;
        private int skipped;
        private int failed;
        private long pendingTotal;

        public int seen() {
            return seen;
        }

        public int completed() {
            return completed;
        }

        /** 다른 작업자가 lease 를 쥐고 있어 건너뛴 건수. <b>완료가 아니다.</b> */
        public int skipped() {
            return skipped;
        }

        public int failed() {
            return failed;
        }

        /** 전체 미완료(인플라이트·재시도 예정 포함). 이 값이 0 일 때만 gate 를 통과한다. */
        public long pendingTotal() {
            return pendingTotal;
        }

        public boolean gatePassed() {
            return failed == 0 && pendingTotal == 0L;
        }
    }
}
