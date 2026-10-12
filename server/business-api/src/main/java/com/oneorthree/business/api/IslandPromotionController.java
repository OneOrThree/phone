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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.regex.Pattern;

/**
 * 잡지 홍보 신청·섬 소식 2종의 <b>공개 경계</b> (GROMO-2267, 섬 외부 계약 §7). 여기서는 입력의 «모양» 만 본다 —
 * 신청은 {@code Idempotency-Key}(UUID) 필수에 본문이 없고(홍보 내용은 잡지 담당 범위), 소식은 {@code limit}
 * (기본 20, 1~50)뿐이다. 섬장·게스트·잔액·하루 1회·주민 판정은 Data 가 한다.
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

    /** 신청 — 성공은 201 {@code {feeFish, balanceAfter, newsId}}. */
    @PostMapping("/islands/{islandId}/promotions")
    @ResponseStatus(HttpStatus.CREATED)
    public IslandPromotions.Created promote(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return promotions.promote(claims, PublicIds.uuid(islandId, "islandId"), CommandKeys.required(request),
                properties.deadline());
    }

    /** 섬 소식 — 주민만, 최신순. */
    @GetMapping("/islands/{islandId}/news")
    public IslandPromotions.NewsPage news(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return promotions.news(claims, PublicIds.uuid(islandId, "islandId"), limit(request), properties.deadline());
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
