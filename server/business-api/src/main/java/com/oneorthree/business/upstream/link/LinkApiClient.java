package com.oneorthree.business.upstream.link;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.link.dto.LinkClaimResult;
import com.oneorthree.business.upstream.link.dto.LinkIssueCommand;
import com.oneorthree.business.upstream.link.dto.LinkIssueResult;
import com.oneorthree.business.upstream.link.dto.LinkMatchCommand;
import com.oneorthree.business.upstream.link.dto.LinkMatchResult;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;

import java.util.Map;
import java.util.UUID;

/**
 * 링크 서버로 나가는 유일한 창구.
 *
 * <p>링크 구현은 GROMO-1660의 독립 서비스가 제공한다. 경로·요청·응답 계약은
 * {@code docs/contracts/business-satellite-api.yaml}과 Link 내부 API를 함께 대조한다.
 * 제공자 API를 먼저 배포·검증한 뒤 Business 경로를 전환한다.
 *
 * <h2>Business 가 링크에 confirm 을 보내지 않는다</h2>
 * claim 확정 전달은 <b>Data 의 락 아래 outbox + relay</b> 가 맡는다(A22 ㋟). Business 가 응답을 받은
 * 뒤 confirm 하면 그때는 이미 락이 풀려 그 사이 revoke 가 끼어든다. 그래서 이 클라이언트에는
 * confirm·revoke·withdraw 호출이 <b>없다</b> — 있으면 누가 그 경로를 쓸 것이다.
 */
public class LinkApiClient {

    private static final String PATH_ISSUE = "/internal/links";
    private static final String PATH_CLAIM = "/internal/links/{slug}/claim";
    private static final String PATH_MATCH = "/internal/links/match";

    private final InternalHttpClient http;

    public LinkApiClient(InternalHttpClient http) {
        this.http = http;
    }

    /**
     * 링크 발급. <b>같은 {@code Idempotency-Key} 로 재시도하면 같은 slug 를 재생</b>해야 한다 —
     * 기존 동작은 활성 링크를 «반복 발급·재사용»하는 것이므로(그룹 HLD), 재시도가 새 slug 를 만들면
     * 이미 공유된 링크가 갈라진다.
     */
    public LinkIssueResult issue(UUID inviterId, LinkIssueCommand command, String idempotencyKey,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_ISSUE)
                        .onBehalfOf(inviterId)
                        .idempotencyKey(idempotencyKey)
                        .body(command)
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<LinkIssueResult>() { });
    }

    /**
     * 잠정 claim 기록 + 서명 자격 발급. {@code link_clicks} 에 유저를 붙이는 일이라 <b>링크 서버만</b>
     * 할 수 있고, 이 경로가 없으면 설치 매치는 성공해도 최종 귀속이 기록되지 않는다(§3).
     *
     * <p>같은 키의 재시도는 같은 {@code claimId} 를 재생해야 한다 — 아니면 확정 대상이 여러 개로 갈린다.
     */
    public LinkClaimResult claim(UUID userId, String slug, String idempotencyKey, Deadline deadline) {
        LinkClaimResult result = http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_CLAIM.replace("{slug}", slug))
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(Map.of("userId", userId.toString()))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<LinkClaimResult>() { });
        if (result == null) {
            throw new UpstreamContractMismatchException("잠정 claim 응답에 본문이 없습니다");
        }
        boolean noTarget = result.claimId() == null && result.capability() == null;
        boolean claimWithCapability = result.claimId() != null && result.capability() != null
                && !result.capability().isBlank();
        if (!noTarget && !claimWithCapability) {
            throw new UpstreamContractMismatchException("잠정 claim 식별자와 자격이 일치하지 않습니다");
        }
        return result;
    }

    /**
     * 클릭 소진. <b>같은 {@code deviceId} 의 재시도는 같은 결과</b>여야 한다(계약 §4) — 구 앱은 실패 시
     * 다음 실행에서 다시 보내므로, 두 번째 호출이 다른 클릭을 소진하면 한 기기가 두 초대를 갖는다.
     *
     * <p>무인증 공개 경로가 아니다 — 정지 창의 한시 핸들러가 서비스 토큰으로 부른다. 방문자 입력을
     * 그대로 전달하지 않고 {@code ipHash} 는 <b>신뢰한 프록시의 원본 IP</b> 에서만 만든다(계약 §4).
     */
    public LinkMatchResult match(LinkMatchCommand command, String idempotencyKey, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_MATCH)
                        .idempotencyKey(idempotencyKey)
                        .body(command)
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<LinkMatchResult>() { });
    }
}
