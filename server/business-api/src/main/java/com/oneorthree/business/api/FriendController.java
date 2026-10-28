package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.FriendUseCase.FriendView;
import com.oneorthree.business.usecase.FriendUseCase.RequestView;
import com.oneorthree.business.usecase.FriendUseCase.SearchView;
import com.oneorthree.business.usecase.FriendUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.List;

/**
 * 친구 8종의 <b>공개 표면</b> (GROMO-1894 7종 + GROMO-1996 검색) — 레거시
 * {@code /api/v1/friends…}(Data)의 무접두 재노출이다. 동작은 바꾸지 않고, 실제 판정은 Data 의
 * {@code /internal/users/{userId}/…} 가 한다.
 *
 * <p>무접두 {@code /friends} 는 nginx 위성 include 의 Business 분기가 보낸다(같은 PR 의 example 에 추가).
 * {@code PublicApiRoutes.ROOTS} 에 {@code /friends/**} 를 더해 봉투가 씌워진다.
 *
 * <p><b>Idempotency-Key 를 요구하지 않는다.</b> P04(api-platform policy)는 「적용 대상은 LLD 표로 열거,
 * 모든 POST 일괄 적용 금지」이고 그 표(api-platform LLD §2)에도 friend-letter LLD 에도 친구 명령이
 * 없다. 명령은 그 자체로 재시도에 안전한 응답을 낸다 — 두 번째 생성·거절·취소는 409, 두 번째 수락은
 * 멱등 200, 두 번째 삭제는 404 (LLD §1 표의 에러 칸).
 *
 * <p>명령의 공개 응답은 본문이 없다(LLD) — 본문 없는 {@link ResponseEntity} 를 돌려주면 {@code ApiResponseAdvice}
 * 가 {@code {"data": null}} 로 접고, 204 는 같은 규칙으로 200 이 된다. {@code @ResponseStatus} + {@code null}
 * 반환으로 쓰면 안 된다 — 그 조합은 Spring 이 반환값 처리 자체를 건너뛰어 봉투 없는 빈 본문이 나간다.
 * 주체는 AT 에서만 온다({@link SettingsSessionGuard#requireSession}). 입력 해석 도우미는
 * {@code FocusSessionController} 와 같다.
 */
@RestController
@RequiredArgsConstructor
public class FriendController {

    private final FriendUseCase friends;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    /** 친구 목록 (LLD §1.5). {@code date} 는 필수 — 값 판정(KST 오늘)은 Data 가 한다. */
    @GetMapping("/friends")
    public List<FriendView> friends(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return friends.friends(claims, required(request, "date"), properties.deadline());
    }

    /** 받은·보낸 요청 목록 (LLD §1.6). {@code type} 은 필수 — {@code received} 외의 값은 Data 가 {@code sent} 로 본다. */
    @GetMapping("/friends/requests")
    public List<RequestView> friendRequests(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return friends.friendRequests(claims, required(request, "type"), properties.deadline());
    }

    /**
     * 친구 검색 (GROMO-1996) — nginx 가 {@code /friends/*} 를 여기로 보내는데 매핑이 없어 404 로 죽어
     * 있던 자리다. 레거시 {@code GET /api/v1/friends/search}(Data 직결, 봉투 없음)의 무접두 재노출이며,
     * 동작은 정책에 맞춰 바뀌었다: 대소문자 무시 <b>전체 일치</b>, 본인·탈퇴자 제외, 비친구는 티어·준비
     * 시험이 null.
     *
     * <p>{@code type}·{@code q} 는 둘 다 필수다 — 값 판정(등록된 검색 수단인가)은 Data 가 한다.
     * 결과가 없으면 빈 배열이고 404 가 아니다.
     */
    @GetMapping("/friends/search")
    public List<SearchView> search(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return friends.search(claims, required(request, "type"), required(request, "q"), properties.deadline());
    }

    /** 친구 요청 생성 (LLD §1.1). 본문은 {@code targetUserId} 하나뿐이다 — 다른 키가 섞이면 거절한다. */
    @PostMapping(value = "/friends/requests", consumes = "application/json")
    public ResponseEntity<Void> createRequest(@RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        if (body == null || !body.isObject() || body.size() != 1) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        JsonNode target = body.get("targetUserId");
        if (target == null || !target.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "targetUserId");
        }
        friends.createRequest(claims, PublicIds.uuid(target.stringValue(), "targetUserId"), properties.deadline());
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    /** 요청 수락 (LLD §1.2) — 수신자만. */
    @PostMapping("/friends/requests/{requestId}/accept")
    public ResponseEntity<Void> accept(@PathVariable String requestId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        friends.accept(claims, PublicIds.uuid(requestId, "requestId"), properties.deadline());
        return ResponseEntity.ok().build();
    }

    /** 요청 거절 (LLD §1.3) — 수신자만. */
    @PostMapping("/friends/requests/{requestId}/reject")
    public ResponseEntity<Void> reject(@PathVariable String requestId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        friends.reject(claims, PublicIds.uuid(requestId, "requestId"), properties.deadline());
        return ResponseEntity.ok().build();
    }

    /** 요청 취소 (LLD §1.11, 신규) — 발신자만. */
    @PostMapping("/friends/requests/{requestId}/cancel")
    public ResponseEntity<Void> cancel(@PathVariable String requestId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        friends.cancel(claims, PublicIds.uuid(requestId, "requestId"), properties.deadline());
        return ResponseEntity.ok().build();
    }

    /** 친구 삭제 (LLD §1.4). LLD 의 204 는 공개 봉투 규칙으로 200 {@code {"data": null}} 이 된다. */
    @DeleteMapping("/friends/{friendUserId}")
    public ResponseEntity<Void> deleteFriend(@PathVariable String friendUserId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        friends.deleteFriend(claims, PublicIds.uuid(friendUserId, "friendUserId"), properties.deadline());
        return ResponseEntity.noContent().build();
    }

    /** 필수 쿼리 파라미터 하나 — 없거나 같은 키가 여러 번 오면 400 이다(모호한 요청은 고르지 않는다). */
    private static String required(HttpServletRequest request, String name) {
        String[] values = request.getParameterValues(name);
        if (values == null || values.length != 1) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, name);
        }
        return values[0];
    }
}
