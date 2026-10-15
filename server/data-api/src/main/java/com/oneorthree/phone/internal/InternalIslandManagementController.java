package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.IslandJoinRequestsPageView;
import com.oneorthree.phone.internal.dto.IslandLeftView;
import com.oneorthree.phone.internal.dto.IslandManageCommandRequest;
import com.oneorthree.phone.internal.dto.IslandManageView;
import com.oneorthree.phone.internal.dto.IslandMemberRemovedView;
import com.oneorthree.phone.internal.dto.IslandMembersPageView;
import com.oneorthree.phone.internal.dto.JoinRequestAnswerCommandRequest;
import com.oneorthree.phone.internal.dto.JoinRequestAnswerView;
import com.oneorthree.phone.internal.service.IslandJoinService;
import com.oneorthree.phone.internal.service.IslandManagementService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.UUID;

/**
 * 섬 관리·주민 잔여 6종의 내부 표면 (GROMO-1802, 섬 관리 LLD §3) — 공개 {@code PATCH /islands/{islandId}}·
 * {@code GET /islands/{islandId}/members}·{@code GET /islands/{islandId}/join-requests}·
 * {@code PATCH /islands/{islandId}/join-requests/{requestId}}·{@code DELETE /islands/{islandId}/members/{userId}}·
 * {@code DELETE /islands/{islandId}/memberships/me} 의 상류다.
 *
 * <p>경로는 B26 규칙이다 — 섬 자원 다섯은 {@code /internal} + 공개 경로이고 주체는 {@code X-User-Id} 다
 * ({@code InternalHostTransferController} 선례). 나가기만 «본인» 명령이라 사용자 축
 * {@code /internal/users/{userId}/…} 에 두어 {@code InternalAuthFilter} 가 경로 사용자와 헤더를 대조하게 한다.
 * 강퇴 대상은 공개 경로의 {@code {userId}} 지만 여기서는 주체와 헷갈리지 않게 {@code targetUserId} 로 받는다.
 *
 * <p>목록 커서는 Business 가 서명·검증한 뒤 평문 keyset 경계({@code after…})만 넘긴다.
 */
@RestController
@RequiredArgsConstructor
public class InternalIslandManagementController {

    private final IslandManagementService islandManagementService;
    private final IslandJoinService islandJoinService;

    /** 섬 정보 수정 (LLD §3.1). */
    @PatchMapping("/internal/islands/{islandId}")
    public IslandManageView manage(@PathVariable UUID islandId,
                                   @RequestHeader("X-User-Id") UUID userId,
                                   @RequestHeader("Idempotency-Key") UUID idempotencyKey,
                                   @RequestBody IslandManageCommandRequest body) {
        return islandManagementService.manage(userId, islandId, body, idempotencyKey);
    }

    /** 주민 목록 (LLD §3.2). */
    @GetMapping("/internal/islands/{islandId}/members")
    public IslandMembersPageView members(@PathVariable UUID islandId,
                                         @RequestHeader("X-User-Id") UUID userId,
                                         @RequestParam(required = false)
                                         @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant afterJoinedAt,
                                         @RequestParam(required = false) UUID afterMembershipId,
                                         @RequestParam int limit) {
        return islandManagementService.members(userId, islandId, afterJoinedAt, afterMembershipId, limit);
    }

    /** 신청자 목록 (LLD §3.3). */
    @GetMapping("/internal/islands/{islandId}/join-requests")
    public IslandJoinRequestsPageView joinRequests(@PathVariable UUID islandId,
                                                   @RequestHeader("X-User-Id") UUID userId,
                                                   @RequestParam(required = false)
                                                   @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
                                                   Instant afterCreatedAt,
                                                   @RequestParam(required = false) UUID afterRequestId,
                                                   @RequestParam int limit) {
        return islandManagementService.joinRequests(userId, islandId, afterCreatedAt, afterRequestId, limit);
    }

    /** 가입 요청 승인·거절 (LLD §3.4). */
    @PatchMapping("/internal/islands/{islandId}/join-requests/{requestId}")
    public JoinRequestAnswerView answer(@PathVariable UUID islandId,
                                        @PathVariable UUID requestId,
                                        @RequestHeader("X-User-Id") UUID userId,
                                        @RequestHeader("Idempotency-Key") UUID idempotencyKey,
                                        @Valid @RequestBody JoinRequestAnswerCommandRequest body) {
        return islandJoinService.answer(userId, islandId, requestId, body.approve(), idempotencyKey);
    }

    /** 주민 강퇴 (LLD §3.6). */
    @DeleteMapping("/internal/islands/{islandId}/members/{targetUserId}")
    public IslandMemberRemovedView kick(@PathVariable UUID islandId,
                                        @PathVariable UUID targetUserId,
                                        @RequestHeader("X-User-Id") UUID userId,
                                        @RequestHeader("Idempotency-Key") UUID idempotencyKey) {
        return islandManagementService.kick(userId, islandId, targetUserId, idempotencyKey);
    }

    /** 본인 나가기 (LLD §3.7) — 사용자 축. */
    @DeleteMapping("/internal/users/{userId}/islands/{islandId}/membership")
    public IslandLeftView leave(@PathVariable UUID userId,
                                @PathVariable UUID islandId,
                                @RequestHeader("Idempotency-Key") UUID idempotencyKey) {
        return islandManagementService.leave(userId, islandId, idempotencyKey);
    }
}
