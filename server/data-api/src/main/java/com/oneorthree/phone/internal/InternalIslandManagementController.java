package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.IslandJoinRequestsPageView;
import com.oneorthree.phone.internal.dto.IslandLeftView;
import com.oneorthree.phone.internal.dto.IslandManageCommandRequest;
import com.oneorthree.phone.internal.dto.IslandManageView;
import com.oneorthree.phone.internal.dto.IslandMemberRemovedView;
import com.oneorthree.phone.internal.dto.IslandMembersPageView;
import com.oneorthree.phone.internal.dto.JoinRequestAnswerCommandRequest;
import com.oneorthree.phone.internal.dto.JoinRequestAnswerView;
import com.oneorthree.phone.internal.service.GuestAccountGuards;
import com.oneorthree.phone.internal.service.IslandJoinService;
import com.oneorthree.phone.internal.service.IslandManagementService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Pattern;
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

    /** 나가기·강퇴 응답에 다음 위치를 싣는 opt-in 값 (GROMO-2260) — 허용 값은 이것 하나다. */
    private static final String INCLUDE_NEXT_LOCATION = "nextLocation";

    private final IslandManagementService islandManagementService;
    private final IslandJoinService islandJoinService;
    private final GuestAccountGuards guestAccountGuards;

    /** 섬 정보 수정 (LLD §3.1). 인사말(GROMO-2262)을 건드리는 요청만 게스트를 403 으로 막는다. */
    @PatchMapping("/internal/islands/{islandId}")
    public IslandManageView manage(@PathVariable UUID islandId,
                                   @RequestHeader("X-User-Id") UUID userId,
                                   @RequestHeader("Idempotency-Key") UUID idempotencyKey,
                                   @RequestBody IslandManageCommandRequest body) {
        if (body.greeting() != null) {
            guestAccountGuards.requireMember(userId);
        }
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

    /**
     * 주민 강퇴 (LLD §3.6). {@code include=nextLocation} 일 때만 대상의 다음 위치를 싣는다(GROMO-2260) —
     * 나가기와 같은 이유다({@link #leave}).
     */
    @DeleteMapping("/internal/islands/{islandId}/members/{targetUserId}")
    public IslandMemberRemovedView kick(@PathVariable UUID islandId,
                                        @PathVariable UUID targetUserId,
                                        @RequestHeader("X-User-Id") UUID userId,
                                        @RequestHeader("Idempotency-Key") UUID idempotencyKey,
                                        @RequestParam(required = false) @Pattern(regexp = INCLUDE_NEXT_LOCATION)
                                        String include) {
        IslandMemberRemovedView view = islandManagementService.kick(userId, islandId, targetUserId, idempotencyKey);
        return include == null ? new IslandMemberRemovedView(view.removed(), null) : view;
    }

    /**
     * 본인 나가기 (LLD §3.7) — 사용자 축.
     *
     * <p><b>{@code include=nextLocation} 은 명시적 opt-in 이다</b> (GROMO-2260). 서비스는 독립 배포라 Data 가
     * 먼저 나가면 구 Business 가 이 경로를 부르는데, 구 Business 는 키가 정확히 {@code left} 하나인 응답만
     * 받는다 — 다음 위치를 늘 실으면 이미 커밋된 나가기가 «실패»로 보이고 같은 키 재시도도 실패한다. 그래서
     * 파라미터가 없으면 GROMO-2260 이전과 같은 {@code {"left":true}} 를 돌려준다. 붙이고 떼는 일은 receipt 재생
     * <b>뒤</b> 여기서 한다 — 멱등 지문에 넣지 않으므로 구·신 Business 가 같은 키를 섞어 써도 충돌하지 않고,
     * 배포 전 receipt 의 재생은 파라미터가 있어도 다음 위치가 없다(Business 가 «모름»으로 받는다).
     * 그 외 값은 400 {@code INVALID_REQUEST} 다.
     */
    @DeleteMapping("/internal/users/{userId}/islands/{islandId}/membership")
    public IslandLeftView leave(@PathVariable UUID userId,
                                @PathVariable UUID islandId,
                                @RequestHeader("Idempotency-Key") UUID idempotencyKey,
                                @RequestParam(required = false) @Pattern(regexp = INCLUDE_NEXT_LOCATION)
                                String include) {
        IslandLeftView view = islandManagementService.leave(userId, islandId, idempotencyKey);
        return include == null ? new IslandLeftView(view.left(), null) : view;
    }
}
