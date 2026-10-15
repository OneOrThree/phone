package com.oneorthree.business.api;

import com.oneorthree.business.api.dto.ClaimInviteRequest;
import com.oneorthree.business.api.dto.IssueInviteLinkResponse;
import com.oneorthree.business.auth.LoginUser;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.config.CompatProperties;
import com.oneorthree.business.upstream.link.dto.LinkIssueResult;
import com.oneorthree.business.usecase.InviteLinkUseCase;
import com.oneorthree.business.usecase.RequestIdempotencyKeys;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 초대 링크 발급·claim — <b>기존 URI·성공 상태·오류 코드를 보존</b>한다.
 *
 * <ul>
 *   <li>{@code POST /api/v1/groups/{groupId}/invite-link} → 200 {@code {slug, url}}</li>
 *   <li>{@code POST /api/v1/invite-links/claim} → 200 본문 없음. 예산을 넘기면 <b>202</b>(additive)</li>
 * </ul>
 *
 * <p>기존 {@code InviteLinkController} 는 claim 결과 boolean 을 무시하고 <b>언제나 200</b> 을 준다
 * (「붙일 곳이 없을 뿐 오류가 아니다」). 그 판정을 바꾸지 않는다 — 앱이 200 을 「확인했다」로 읽는다.
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class InviteLinkController {

    private final InviteLinkUseCase inviteLinkUseCase;
    private final CompatProperties compatProperties;

    @PostMapping("/groups/{groupId}/invite-link")
    public ResponseEntity<IssueInviteLinkResponse> issueInviteLink(
            @PathVariable UUID groupId,
            @LoginUser UUID userId,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {

        LinkIssueResult result = inviteLinkUseCase.issue(groupId, userId,
                RequestIdempotencyKeys.from(idempotencyKey), Deadline.unbounded());
        return ResponseEntity.ok(new IssueInviteLinkResponse(result.slug(), result.url()));
    }

    /**
     * claim. 예산은 앱의 전역 15초보다 안쪽이다({@code api.ts:215-218}) — 넘기면 내구 큐에 남기고
     * {@code 202} 를 준다. <b>큐 커밋 전에는 202 를 주지 않는다</b>(계약 §4).
     */
    @PostMapping("/invite-links/claim")
    public ResponseEntity<Void> claim(
            @Valid @RequestBody ClaimInviteRequest request,
            @LoginUser UUID userId,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {

        InviteLinkUseCase.ClaimOutcome outcome = inviteLinkUseCase.claim(userId, request.slug(),
                RequestIdempotencyKeys.from(idempotencyKey),
                Deadline.startingNow(compatProperties.getClaimBudget()));

        if (outcome.accepted()) {
            return ResponseEntity.ok().build();
        }
        return ResponseEntity.status(HttpStatus.ACCEPTED).build();
    }
}
