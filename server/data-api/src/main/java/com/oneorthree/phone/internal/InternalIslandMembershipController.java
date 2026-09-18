package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.CurrentIslandView;
import com.oneorthree.phone.internal.dto.IslandCreatedView;
import com.oneorthree.phone.internal.dto.IslandDiscoverPageView;
import com.oneorthree.phone.internal.dto.IslandSearchPageView;
import com.oneorthree.phone.internal.dto.MyIslandsView;
import com.oneorthree.phone.internal.dto.SwitchCurrentIslandCommandRequest;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 섬 소속·탐색의 <b>사용자 축</b> 내부 표면 (GROMO-1759) — 공개 {@code POST /islands}·
 * {@code GET /islands}·{@code GET /islands/discover}·{@code GET /me/islands}·
 * {@code PUT /me/current-island} 의 상류다.
 *
 * <p>경로 규칙은 GROMO-1764 가 세운 「사용자 축 공개 경로는 {@code /internal/users/{userId}/…}」다 —
 * {@code InternalAuthFilter} 가 그 접두어를 읽어 경로의 userId 와 {@code X-User-Id} 헤더의 일치를
 * 강제하기 때문이다. 그래서 {@code @LoginUser} 를 쓰지 않고 경로 변수로 주체를 받는다.
 *
 * <p><b>공개 경로와 이름이 다른 이유.</b> 검색과 발견은 공개 경로가 각각 {@code GET /islands}·
 * {@code GET /islands/discover} 지만 여기서는 {@code island-search}·{@code island-discovery} 다.
 * 사용자 축 아래에서 {@code GET /islands} 는 이미 «내 섬 목록» 이 가져갔고, 한 경로가 질의
 * 파라미터 유무로 두 계약을 겸하면 허용목록이 둘을 구분하지 못한다.
 *
 * <p>응답은 {@code {"data": …}} 로 감싸지 않는다 — 그 봉투는 Business 의 {@code ApiResponseAdvice}
 * 몫이다. 대신 «없음» 을 빈 본문으로 표현하지 않는다(모든 응답이 한 겹 record 다).
 */
@RestController
@RequestMapping("/internal/users/{userId}")
@RequiredArgsConstructor
public class InternalIslandMembershipController {

    private final IslandMembershipService islandMembershipService;

    /** 섬 생성 (LLD §3.1). */
    @PostMapping("/islands")
    @ResponseStatus(HttpStatus.CREATED)
    public IslandCreatedView create(@PathVariable UUID userId,
                                    @Valid @RequestBody CreateIslandCommandRequest body,
                                    @RequestHeader("Idempotency-Key") UUID idempotencyKey) {
        return islandMembershipService.create(userId, body, idempotencyKey);
    }

    /** 내 섬 목록 (LLD §3.5). */
    @GetMapping("/islands")
    public MyIslandsView myIslands(@PathVariable UUID userId) {
        return islandMembershipService.myIslands(userId);
    }

    /**
     * 이름 검색 (LLD §3.2).
     *
     * <p>{@code cursorIslandId} 는 Business 가 <b>서명 커서를 열어</b> 꺼낸 keyset 경계다. 서명·필터
     * 결합·TTL 은 Business 의 {@code SignedCursorCodec} 이 이미 검증했으므로 여기서는 평문 경계만
     * 받는다 — data-api 가 커서 서명 키를 알 필요가 없다.
     */
    @GetMapping("/island-search")
    public IslandSearchPageView search(@PathVariable UUID userId,
                                       @RequestParam(required = false) String q,
                                       @RequestParam(required = false) UUID cursorIslandId,
                                       @RequestParam int limit) {
        return islandMembershipService.search(userId, q, cursorIslandId, limit);
    }

    /**
     * 첫 소속 탐색 (LLD §3.3).
     *
     * <p>{@code seed} 는 한 탐색 세션의 순서를 고정하는 값이고 {@code afterHandle} 은 그 순서 위의
     * 경계다. 둘 다 Business 의 서명 커서에서 나온다.
     */
    @GetMapping("/island-discovery")
    public IslandDiscoverPageView discover(@PathVariable UUID userId,
                                           @RequestParam String seed,
                                           @RequestParam(required = false) String afterHandle,
                                           @RequestParam int limit) {
        return islandMembershipService.discover(userId, seed, afterHandle, limit);
    }

    /** 현재 섬 이동 (LLD §3.6). */
    @PutMapping("/current-island")
    public CurrentIslandView switchCurrentIsland(
            @PathVariable UUID userId,
            @Valid @RequestBody SwitchCurrentIslandCommandRequest body,
            @RequestHeader("Idempotency-Key") UUID idempotencyKey) {
        return islandMembershipService.switchCurrentIsland(userId, body.islandId(), idempotencyKey);
    }
}
