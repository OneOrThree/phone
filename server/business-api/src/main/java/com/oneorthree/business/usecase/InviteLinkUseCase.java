package com.oneorthree.business.usecase;

import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.exception.UpstreamUnavailableException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.config.CompatProperties;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.ClaimIntentAck;
import com.oneorthree.business.upstream.data.dto.DurableCommandAck;
import com.oneorthree.business.upstream.data.dto.InviteIssueContext;
import com.oneorthree.business.upstream.link.LinkApiClient;
import com.oneorthree.business.upstream.link.dto.LinkClaimResult;
import com.oneorthree.business.upstream.link.dto.LinkIssueCommand;
import com.oneorthree.business.upstream.link.dto.LinkIssueResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * 초대 링크 발급·claim 조합. 기존 앱 계약
 * {@code POST /api/v1/groups/{groupId}/invite-link} · {@code POST /api/v1/invite-links/claim} 을 보존한다.
 *
 * <h2>발급: Data 가 판정하고 링크가 발급한다</h2>
 * 링크 서버는 코어를 부를 수 없으므로(§3 단방향) 「그룹이 살아 있는가 · 이 사람이 활성 멤버인가 ·
 * 표시할 이름 · {@code membershipEpoch} · {@code linkVersion} · {@code transitionSeq} ·
 * {@code snapshotVersion}」을 <b>Data 에서 받아 발급 요청에 동봉</b>한다. 판정 실패는 기존 코드와 같은 코드로 나간다 — {@code GROUP_NOT_FOUND}(404) ·
 * {@code NOT_MEMBER}(403).
 *
 * <p><b>Data 가 링크를 직접 조회하지 않는다.</b> 그게 A22 ㊫ 의 이유이고, 이 조합의 존재 이유다.
 *
 * <h2>claim: 내구 적재 → 링크 잠정 기록 → Data 확정</h2>
 * ① 활성 검사 → ② <b>Data 에 claim 의도를 내구 적재</b>(㊄ · ㊺: 정지 창의 claim 은 거절이 아니라
 * 대기이고, 앱은 전역 15초 뒤 다음 로그인까지 재시도하지 않는다) → ③ 링크에 <b>잠정</b> claim 기록 +
 * 서명 자격 수령 → ④ Data 가 <b>멤버십 락 아래</b> 확정하고 {@code link.claimConfirmed} outbox 기록 →
 * relay 가 전달.
 *
 * <p><b>③·④ 를 Business 가 link 에 confirm 하는 것으로 바꾸면 안 된다</b>(㋟) — 락이 풀린 뒤 보내면
 * 그 사이 revoke 가 끼어들고, 락을 잡은 채 직접 호출은 §3 위반이다.
 *
 * <p><b>{@code 202} 는 ②의 커밋 뒤에만 준다.</b> 그리고 <b>재개 주체가 있을 때만</b> 준다 —
 * {@code business.compat.claim-queue-replay-enabled} 가 꺼진 평상시에는 실패를 그대로 올린다.
 * Business 에는 크론이 없고(§6) Data 는 링크를 relay 허용목록 밖으로 부를 수 없으므로(§3), 큐를 비우는
 * 주체는 이관 재개 단계의 일회성 CLI({@link ClaimIntentReplayService})뿐이다. 그 CLI 가 돌지 않는
 * 기간에 202 를 주면 <b>큐만 쌓이고 아무도 끝내지 않는 영구 대기</b>가 된다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InviteLinkUseCase {

    private final ActiveUserGuard activeUserGuard;
    private final DataApiClient dataApiClient;
    private final LinkApiClient linkApiClient;
    private final CompatProperties compatProperties;

    /** 발급 결과. 기존 응답 {@code {slug, url}} 을 그대로 채운다. */
    public LinkIssueResult issue(UUID groupId, UUID inviterId, RequestIdempotencyKeys keys, Deadline deadline) {
        activeUserGuard.requireActive(inviterId, deadline);

        InviteIssueContext context = dataApiClient.fetchInviteIssueContext(groupId, inviterId, deadline);
        // Data 가 그룹·멤버십을 판정한다. 여기서 다시 해석하지 않고, 코드가 실린 실패는 상류 봉투로
        // 그대로 중계된다(GROUP_NOT_FOUND · NOT_MEMBER). 판정이 「살아 있지 않다」로 왔는데 코드가
        // 없으면 그건 계약 불일치다 — 조용히 발급하지 않는다.
        if (context == null) {
            throw new UpstreamUnavailableException("Data 가 발급 컨텍스트를 주지 않았다");
        }
        if (!context.groupActive()) {
            throw new UpstreamDomainException(HttpStatus.NOT_FOUND.value(), "GROUP_NOT_FOUND",
                    "그룹을 찾을 수 없습니다.", null);
        }
        if (!context.inviterActiveMember()) {
            throw new UpstreamDomainException(HttpStatus.FORBIDDEN.value(), "NOT_MEMBER",
                    "그룹원만 초대 링크를 만들 수 있습니다.", null);
        }

        if (context.membershipEpoch() != context.linkVersion()) {
            // 링크 서버가 ISSUE_EPOCH_MISMATCH 400 으로 거절하는 조건이다(link/src/lib/links.ts:34).
            // 여기서 막지 않으면 그 400 이 「코드 있는 4xx」로 앱에 중계돼 사용자에게 엉뚱한 문구가 뜬다 —
            // 발급 경로에서 두 값이 갈리는 것은 Data 계약 위반이므로 계약 불일치(502)로 드러낸다.
            throw new UpstreamContractMismatchException(
                    "발급 컨텍스트의 membershipEpoch != linkVersion — 발급 경로에서는 같아야 한다"
                            + " (epoch=" + context.membershipEpoch() + ", linkVersion=" + context.linkVersion() + ")");
        }

        LinkIssueCommand command = new LinkIssueCommand(
                context.groupId(),
                context.inviterId(),
                context.linkVersion(),
                context.membershipEpoch(),
                context.transitionSeq(),
                context.snapshotVersion(),
                context.groupName(),
                context.inviterDisplayName());
        return linkApiClient.issue(inviterId, command, keys.forStep("link-issue"), deadline);
    }

    /**
     * claim 결과 — 동기 확정까지 끝났는가.
     *
     * @param accepted {@code true} 면 200(기존 계약), {@code false} 면 202(내구 큐에 남았다)
     */
    public record ClaimOutcome(boolean accepted) {
    }

    /** claim. 예산을 넘길 위험이 있으면 {@code 202} 로 접되, <b>내구 적재 뒤에만</b> 그렇게 한다. */
    public ClaimOutcome claim(UUID userId, String slug, RequestIdempotencyKeys keys, Deadline deadline) {
        activeUserGuard.requireActive(userId, deadline);

        // ② 내구 적재 — 이 커밋이 202 의 유일한 근거다. 실패하면 202 를 줄 수 없으므로 예외가 올라간다.
        ClaimIntentAck intent = dataApiClient.enqueueClaimIntent(
                userId, slug, keys.forStep("claim-intent"), deadline);
        // 종결된 같은 요청을 202로 다시 접수하지 않는다. 새 요청 키는 별도 PENDING 의도를 받는다.
        if (intent.completed()) {
            return new ClaimOutcome(true);
        }

        try {
            // ③ 링크의 잠정 기록 + 서명 자격. SLUG_NOT_FOUND(404) 는 기존 계약대로 중계된다.
            LinkClaimResult pending = linkApiClient.claim(userId, slug, keys.forStep("link-claim"), deadline);

            if (pending == null || pending.claimId() == null) {
                // 셀프 초대이거나 붙일 클릭이 없다 — 링크 서버가 claimId=null 을 «정상»으로 준다
                // (link/src/lib/links.ts:145·149). 기존 InviteLinkMatchService:169-177 의 「붙일 곳이 없을
                // 뿐 오류가 아니다」와 같은 뜻이고, 기존 컨트롤러도 boolean 을 무시하고 항상 200 이었다.
                // 확정할 것이 없으므로 confirm 을 건너뛴다 — null claimId 로 부르면 Data 가 거절한다.
                // 그래서 «의도를 닫는 손»도 여기뿐이다 — 확정 경로가 없으면 Data 도 큐를 닫아 주지
                // 못하므로, 닫지 않으면 정상 처리된 claim 의 의도가 PENDING 으로 남아 「미완료 0」
                // gate 를 영구히 막는다.
                abandonIntentQuietly(userId, intent, deadline);
                log.debug("claim 대상 없음 — slug={} (셀프 초대이거나 붙일 클릭 없음)", slug);
                return new ClaimOutcome(true);
            }

            // ④ Data 의 멤버십 락 아래 확정 + link.claimConfirmed outbox. 전달은 relay 가 한다.
            DurableCommandAck confirmed = dataApiClient.confirmClaim(userId, pending.claimId(), slug,
                    pending.capability(), keys.forStep("claim-confirm"), deadline);
            // 여기서는 의도를 닫지 않는다 — Data 가 «멤버십 락 아래» 확정과 같은 커밋에서 닫는다.
            // 밖에서 한 번 더 닫으면 그 커밋이 정한 완료 시각·완료 토큰을 요청 경로가 덮어, 같은
            // 확정을 몰고 온 재개 실행자의 완료 보고가 「낡은 보고」로 거절된다.
            log.debug("claim 확정 — slug={} claimId={} version={}", slug, pending.claimId(), confirmed.version());
            return new ClaimOutcome(true);
        } catch (UpstreamDomainException e) {
            // 상류가 «판정»을 내렸다(예: SLUG_NOT_FOUND). 202 로 접으면 앱은 다음 로그인까지 기다리는데
            // 그 사이 큐에 남은 의도가 같은 판정을 또 받는다 — 판정은 그대로 앱에 돌려준다.
            //
            // 다만 «다시 물어도 같은 답»인 판정이면 내가 만든 의도를 내가 닫는다. 안 닫으면 아무도
            // 못 닫는다: 확정이 없어 Data 의 종결 경로가 돌지 않고, 앱은 claim 용 Idempotency-Key 를
            // 보내지 않아(deferredInvite.ts) 로그인마다 «새» 의도를 하나씩 더 쌓는다 — 죽은 slug 를
            // 가진 사용자 수 × 로그인 횟수만큼 「미완료 0」 gate 가 올라간다. 재개 CLI 가 같은 판정에
            // 하는 일과 같고, 판정 기준도 한 자리({@link ClaimIntentTermination})에서 공유한다.
            if (ClaimIntentTermination.isTerminal(e)) {
                // ⚠️ 종결은 «조용히» 한다 — 실패해도 아래 throw 가 원래 상태·코드를 그대로 올린다.
                //    앱이 분기하는 것은 상류 판정이지 우리 뒷정리 결과가 아니다.
                abandonIntentQuietly(userId, intent, deadline);
                log.debug("claim 판정 종결 — slug={} code={} commandId={}", slug, e.getCode(),
                        intent.commandId());
            } else {
                // 408·429·권한 거절(403)처럼 「나중엔 답이 다를 수 있는」 거절이다. 의도를 남겨 두면
                // 앱의 다음 시도나 재개 CLI 가 이어받는다 — 여기서 지우면 그 근거가 사라진다.
                log.warn("claim 거절 — 재시도 여지가 있어 의도를 남긴다. slug={} status={} code={}",
                        slug, e.getStatus(), e.getCode());
            }
            throw e;
        } catch (RuntimeException e) {
            if (!compatProperties.isClaimQueueReplayEnabled()) {
                // ⚠️ 재개 주체가 없을 때 202 를 주면 «영구 대기»다 — Business 에는 크론이 없고(§6)
                // Data 는 링크를 relay 허용목록 밖으로 부를 수 없다(§3). 큐에 의도는 남지만 아무도
                // 비우지 않으므로, 평상시에는 실패를 그대로 올려 앱의 내구 재시도에 맡긴다.
                log.warn("claim 동기 확정 실패 — 재개 CLI 가 꺼져 있어 202 로 접지 않는다. slug={} commandId={}",
                        slug, intent.commandId(), e);
                throw e;
            }
            // 정지 창: 의도는 내구 적재돼 있고 재개 CLI 가 큐를 비운다(㊄ · ㊺).
            log.warn("claim 동기 확정 실패 — 내구 큐를 재개 CLI 가 이어받는다. slug={} commandId={}",
                    slug, intent.commandId(), e);
            return new ClaimOutcome(false);
        }
    }

    /**
     * 의도 종결은 <b>실패해도 사용자 요청의 결과를 바꾸지 않는다</b> — 부르는 자리가 둘이고 둘 다
     * 판정은 이미 나 있다: 「붙일 대상 없음」(200) 과 「다시 물어도 같은 답인 거절」(상류 상태 그대로).
     * 남은 의도는 재개 CLI 가 같은 판정으로 한 번 더 종결한다. 반대로 여기서 실패를 올리면 결론이 난
     * claim 이 사용자에게 <b>다른 오류</b>로 보이고, 거절 경로에서는 앱이 분기하는 코드까지 바뀐다.
     *
     * <p>⚠️ 이 자리에 {@code markCommandDelivered} 를 쓰면 <b>항상 404</b> 다 — 그 경로는 봉투의
     * {@code eventId} 로 「알림 대상 전달」을 닫고, claim 의도는 outbox 행이 아니다.
     */
    private void abandonIntentQuietly(UUID userId, ClaimIntentAck intent, Deadline deadline) {
        try {
            dataApiClient.abandonClaimIntent(userId, intent.commandId(), deadline);
        } catch (RuntimeException e) {
            log.warn("claim 의도 종결 실패 — 재개 CLI 가 한 번 더 처리한다. commandId={}",
                    intent.commandId(), e);
        }
    }
}
