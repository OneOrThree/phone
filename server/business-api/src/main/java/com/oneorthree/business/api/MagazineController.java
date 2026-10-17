package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.upstream.data.dto.Magazines;
import com.oneorthree.business.usecase.MagazineUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.Set;
import java.util.UUID;

/**
 * 고양이 잡지 읽기 (GROMO-2289 발행)의 <b>공개 경계</b> — 매일 07시(KST)에 나오는 오늘 호, 최근 7호, 한 호 펼치기, 받기·
 * 미루기·펼치기 기록. 세션이 있으면 게스트도 쓴다. 여기서는 입력의 «모양» 만 본다 — 받기 본문은
 * {@code {place: SEA|ISLAND, deferred?: boolean, opened?: boolean}} 이고 어긋나면 400 {@code INVALID_REQUEST} 다. 호의
 * 존재·7호 범위·받기 판정은 Data 가 한다. 한 호 펼치기의 {@code limit} 은 기본 30, 1~100 이다.
 */
@RestController
@RequiredArgsConstructor
public class MagazineController {

    private static final int ISSUE_LIMIT_DEFAULT = 30;
    private static final Set<String> PLACES = Set.of("SEA", "ISLAND");
    private static final Set<String> RECEIPT_KEYS = Set.of("place", "deferred", "opened");

    private final MagazineUseCase magazines;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    /** 오늘 호와 내 받기 기록 — 둘 다 없으면 null 로 키를 유지한다. */
    @GetMapping("/me/magazine/today")
    public Magazines.Today today(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return magazines.today(claims, properties.deadline());
    }

    /** 최근 7호, 최신순. */
    @GetMapping("/me/magazine/issues")
    public Magazines.Issues issues(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return magazines.issues(claims, properties.deadline());
    }

    /** 한 호 펼치기 — 편집부 지면은 첫 페이지에만, 홍보 칸은 신청 순서로 {@code cursor} 를 따라 이어진다. */
    @GetMapping("/me/magazine/issues/{issueId}")
    public Magazines.IssueView issue(@PathVariable String issueId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID issue = PublicIds.uuid(issueId, "issueId");
        return magazines.issue(claims, issue, single(request, "cursor"), limit(request), properties.deadline());
    }

    /** 받기·미루기·펼치기 기록 — 200 {@code {place, receivedAt, deferredAt, openedAt}}. */
    @PutMapping(value = "/me/magazine/issues/{issueId}/receipt", consumes = "application/json")
    public Magazines.Receipt receipt(@PathVariable String issueId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID issue = PublicIds.uuid(issueId, "issueId");
        if (body == null || !body.isObject() || !RECEIPT_KEYS.containsAll(body.propertyNames())) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        JsonNode place = body.get("place");
        if (place == null || !place.isString() || !PLACES.contains(place.stringValue())) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "place");
        }
        return magazines.receipt(claims, issue, place.stringValue(), flag(body, "deferred"), flag(body, "opened"),
                properties.deadline());
    }

    /** 선택 불리언 — 없거나 null 이면 null, 그 밖의 타입은 그 필드로 400 이다. */
    private static Boolean flag(JsonNode body, String field) {
        JsonNode node = body.get(field);
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isBoolean()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
        return node.booleanValue();
    }

    /** 쿼리 파라미터 하나 — 같은 키가 여러 번 오면 400 이다. */
    private static String single(HttpServletRequest request, String name) {
        String[] values = request.getParameterValues(name);
        if (values == null || values.length == 0) {
            return null;
        }
        if (values.length > 1) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, name);
        }
        return values[0];
    }

    /** {@code limit} — 정수가 아니면 400, 1~100 경계는 {@code CursorScope} 가 422 로 강제한다. */
    private static int limit(HttpServletRequest request) {
        String raw = single(request, "limit");
        if (raw == null) {
            return ISSUE_LIMIT_DEFAULT;
        }
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "limit");
        }
    }
}
