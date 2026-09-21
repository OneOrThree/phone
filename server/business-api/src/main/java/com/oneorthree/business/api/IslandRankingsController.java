package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.IslandRankingsUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 주간 섬 랭킹의 공개 표면 (GROMO-1997, island-rankings LLD §1·§2·§6).
 *
 * <p>{@code /rankings/**} 는 {@code PublicApiRoutes.ROOTS} 에 있어 봉투와 {@code no-store} 가 붙는다. 주체는
 * strict 세션에서만 온다. 여기서 보는 것은 <b>모양</b>이다 — query 의 허용 키, 날짜 형식과 실재, limit 범위.
 * 전망대·주민·주차 의미 판정은 Data 몫이다.
 *
 * <p><b>{@code week} 는 ISO {@code YYYY-Www} 가 아니라 주 시작일 {@code YYYY-MM-DD} 다.</b> 기획 정본이 주를
 * 「매주 일요일 00시」로 정했는데 ISO 주차는 <b>월요일 시작</b>이 정의의 일부라, 요일만 바꾸고 이름을 그대로
 * 두면 {@code 2026-W37} 이 ISO 와 다른 7일을 뜻하게 된다. 주 시작일은 자기 자신이 경계를 말하므로 해석 규칙이
 * 필요 없고, ISO 의 「53주차가 없는 해」 같은 예외도 생기지 않는다. 값이 UTC 일요일인지는 Data 가 판정한다.
 *
 * <p><b>주민 랭킹은 없다</b> — {@code GET /islands/{islandId}/rankings/members} 는 결정 B23·B15 로 엔드포인트
 * 자체가 폐기됐다.
 */
@RestController
@RequiredArgsConstructor
public class IslandRankingsController {

    private static final Set<String> RANKING_QUERY = Set.of("week", "limit", "cursor");
    private static final Pattern DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    private static final Pattern INTEGER = Pattern.compile("-?\\d{1,9}");
    private static final DateTimeFormatter STRICT_DATE =
            DateTimeFormatter.ofPattern("uuuu-MM-dd").withResolverStyle(ResolverStyle.STRICT);

    private final IslandRankingsUseCase rankings;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    /** 섬 간 주간 랭킹 — 상위 {@code limit} 개 + {@code myRank}. 커서는 발급하지도 받지도 않는다. */
    @GetMapping("/rankings/islands")
    public IslandRankingsUseCase.IslandRankings islands(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        request.getParameterMap().forEach((name, values) -> {
            if (!RANKING_QUERY.contains(name) || values.length != 1) {
                throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, name);
            }
        });
        if (request.getParameter("cursor") != null) {
            // 이 계약에는 페이지가 없다 — 커서를 발급한 적이 없으므로 들어온 커서는 위조다(RC-P12-적용과 같다).
            throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, "cursor");
        }
        return rankings.islands(claims, week(request.getParameter("week")), limit(request.getParameter("limit")),
                Deadline.startingNow(properties.getComposition().getDeadline()));
    }

    /** {@code YYYY-MM-DD} 가 아니면 400, 모양은 맞는데 없는 날짜(2월 30일)면 422 다(LLD §2). */
    private static LocalDate week(String value) {
        if (value == null || !DATE.matcher(value).matches()) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "week");
        }
        try {
            return LocalDate.parse(value, STRICT_DATE);
        } catch (DateTimeParseException e) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "week");
        }
    }

    /** 생략하면 Data 기본값, 정수가 아니면 400, 범위 밖이면 422 다. */
    private static Integer limit(String value) {
        if (value == null) {
            return null;
        }
        if (!INTEGER.matcher(value).matches()) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "limit");
        }
        int limit = Integer.parseInt(value);
        if (limit < 1 || limit > IslandRankingsUseCase.MAX_LIMIT) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "limit");
        }
        return limit;
    }
}
