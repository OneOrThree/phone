package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.upstream.data.dto.IslandPromotions;
import com.oneorthree.business.usecase.IslandPromotionUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 잡지 홍보 신청·섬 소식(GROMO-2267, 섬 외부 계약 §7)과 고양이 잡지 편집·고치기·꾸미기 재료(GROMO-2289)의
 * <b>공개 경계</b>. 여기서는 입력의 «모양» 만 본다 — 신청·고치기 본문은 정확히 {@code {body, layout}} 이고
 * {@code body} 는 문자열, {@code layout} 은 JSON 객체여야 한다(어긋나면 400 {@code INVALID_REQUEST}). 글 길이(60자)·
 * layout 속(프레임·스티커·테이프)·재료 보유·신청 창·섬장·게스트·잔액은 Data 가 판정한다. 신청만
 * {@code Idempotency-Key}(UUID) 필수이고, 고치기는 전체 교체 PUT 이라 키를 받지 않는다. 소식은 {@code limit}
 * (기본 20, 1~50)뿐이다.
 */
@RestController
@RequiredArgsConstructor
public class IslandPromotionController {

    private static final int NEWS_LIMIT_DEFAULT = 20;
    private static final int NEWS_LIMIT_MAX = 50;
    private static final Pattern INTEGER = Pattern.compile("-?\\d{1,9}");

    private final IslandPromotionUseCase promotions;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    /** 신청 — 성공은 201 {@code {promotionId, issueDate, feeFish, balanceAfter, newsId}}. */
    @PostMapping(value = "/islands/{islandId}/promotions", consumes = "application/json")
    @ResponseStatus(HttpStatus.CREATED)
    public IslandPromotions.Created promote(@PathVariable String islandId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        UUID island = PublicIds.uuid(islandId, "islandId");
        requireShape(body);
        return promotions.promote(claims, island, body.get("body").stringValue(), body.get("layout"), key,
                properties.deadline());
    }

    /** 고치기 — 다음 호에 낸 홍보를 자정 전까지 전체 교체한다. 200 {@code {promotionId, issueDate, body, layout, updatedAt}}. */
    @PutMapping(value = "/islands/{islandId}/promotions/{promotionId}", consumes = "application/json")
    public IslandPromotions.Updated update(@PathVariable String islandId, @PathVariable String promotionId,
            @RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID island = PublicIds.uuid(islandId, "islandId");
        UUID promotion = PublicIds.uuid(promotionId, "promotionId");
        requireShape(body);
        return promotions.update(claims, island, promotion, body.get("body").stringValue(), body.get("layout"),
                properties.deadline());
    }

    /** 섬장의 편집 화면 — 신청 창·다음 호/지난 호 홍보·홍보비·잔액. */
    @GetMapping("/islands/{islandId}/promotions/editor")
    public IslandPromotions.Editor editor(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return promotions.editor(claims, PublicIds.uuid(islandId, "islandId"), properties.deadline());
    }

    /** 내 꾸미기 재료 — 게스트도 읽는다. */
    @GetMapping("/me/magazine/assets")
    public IslandPromotions.Assets assets(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return promotions.assets(claims, properties.deadline());
    }

    /** 섬 소식 — 주민만, 최신순. */
    @GetMapping("/islands/{islandId}/news")
    public IslandPromotions.NewsPage news(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return promotions.news(claims, PublicIds.uuid(islandId, "islandId"), limit(request), properties.deadline());
    }

    /** 정확히 {@code {body: 문자열, layout: 객체}} — 키가 빠지거나 더 있으면 400, 타입이 틀리면 그 필드로 400. */
    private static void requireShape(JsonNode body) {
        if (body == null || !body.isObject()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        if (body.get("body") == null || !body.get("body").isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "body");
        }
        if (body.get("layout") == null || !body.get("layout").isObject()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "layout");
        }
        if (body.size() != 2) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
    }

    /** 생략하면 기본 20, 정수가 아니거나 같은 키가 여럿이면 400, 범위(1~50) 밖이면 422 다. */
    private static int limit(HttpServletRequest request) {
        String[] values = request.getParameterValues("limit");
        if (values == null || values.length == 0) {
            return NEWS_LIMIT_DEFAULT;
        }
        if (values.length > 1 || !INTEGER.matcher(values[0]).matches()) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "limit");
        }
        int limit = Integer.parseInt(values[0]);
        if (limit < 1 || limit > NEWS_LIMIT_MAX) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "limit");
        }
        return limit;
    }
}
