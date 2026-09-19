package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.InvitationResolveCommandRequest;
import com.oneorthree.phone.internal.dto.InvitationResolvedView;
import com.oneorthree.phone.internal.dto.IslandInvitationIssuedView;
import com.oneorthree.phone.internal.dto.JoinIslandCommandRequest;
import com.oneorthree.phone.internal.dto.JoinIslandResultView;
import com.oneorthree.phone.internal.dto.JoinRequestCancelView;
import com.oneorthree.phone.internal.dto.JoinRequestStatusView;
import com.oneorthree.phone.internal.service.IslandInvitationService;
import com.oneorthree.phone.internal.service.IslandJoinService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 섬 가입·가입 요청·초대 코드의 <b>사용자 축</b> 내부 표면 (GROMO-1760) — 공개
 * {@code POST /islands/{islandId}/memberships}·{@code GET|DELETE /me/join-requests/{requestId}}·
 * {@code POST /invitations/resolve}·{@code POST /islands/{islandId}/invitations} 의 상류다.
 *
 * <p>1759 와 같은 규칙이다 — 주체는 {@code InternalAuthFilter} 가 검증한 경로의 userId 다.
 * 초대 해석도 사용자 축 아래 둔다: 응답의 {@code membershipStatus}·{@code joinRequestId} 가
 * 본인 기준 값이라 익명 표면으로는 만들 수 없는 응답이다.
 */
@RestController
@RequestMapping("/internal/users/{userId}")
@RequiredArgsConstructor
public class InternalIslandJoinController {

    private final IslandJoinService islandJoinService;
    private final IslandInvitationService islandInvitationService;

    /** 섬 가입·가입 요청 (LLD §3.7). 본문은 선택 — 초대 토큰만 담긴다. */
    @PostMapping("/islands/{islandId}/memberships")
    public JoinIslandResultView join(@PathVariable UUID userId,
                                     @PathVariable UUID islandId,
                                     @Valid @RequestBody(required = false) JoinIslandCommandRequest body,
                                     @RequestHeader("Idempotency-Key") UUID idempotencyKey) {
        return islandJoinService.join(userId, islandId, body, idempotencyKey);
    }

    /** 본인 가입 요청 상태 (LLD §3.8). */
    @GetMapping("/join-requests/{requestId}")
    public JoinRequestStatusView status(@PathVariable UUID userId,
                                        @PathVariable UUID requestId) {
        return islandJoinService.status(userId, requestId);
    }

    /** 가입 요청 철회 (LLD §3.9). */
    @DeleteMapping("/join-requests/{requestId}")
    public JoinRequestCancelView cancel(@PathVariable UUID userId,
                                        @PathVariable UUID requestId,
                                        @RequestHeader("Idempotency-Key") UUID idempotencyKey) {
        return islandJoinService.cancel(userId, requestId, idempotencyKey);
    }

    /** 초대 코드 해석 (LLD §3.10). 조회 성격이라 멱등 키를 받지 않는다. */
    @PostMapping("/invitations/resolve")
    public InvitationResolvedView resolve(@PathVariable UUID userId,
                                          @Valid @RequestBody InvitationResolveCommandRequest body) {
        return islandInvitationService.resolve(userId, body);
    }

    /** 초대 코드 발급·재사용 (LLD §3.11). */
    @PostMapping("/islands/{islandId}/invitations")
    public IslandInvitationIssuedView invite(@PathVariable UUID userId,
                                             @PathVariable UUID islandId,
                                             @RequestHeader("Idempotency-Key") UUID idempotencyKey) {
        return islandInvitationService.issue(userId, islandId, idempotencyKey);
    }
}
