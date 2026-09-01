package com.oneorthree.phone.config;

import com.oneorthree.phone.common.auth.AuthAttributes;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.List;

/**
 * 레거시 내기 브리지(N36) 경로 사용량 계측 — 구앱만 부르는 <b>변경 경로 4종</b>(개설·참가·취소·
 * 철회)의 호출을 기록한다. 이 로그 집계가 브리지 제거 시점(GROMO-1238) 판단의 근거다.
 *
 * <p><b>왜 컨트롤러 본문이 아니라 인터셉터인가</b>: 컨트롤러 안에서 찍으면 {@code @Valid}·UUID
 * 변환·{@code @LoginUser} 해석이 <b>전부 성공한 뒤에만</b> 기록된다. 400/403 으로 떨어지는 구앱
 * 호출이 통째로 집계에서 빠지면 "아무도 안 쓴다"는 오판으로 이어져 아직 살아 있는 경로를 조기에
 * 제거하게 된다 — 실패한 호출도 "구앱이 이 경로를 쓰고 있다"는 증거다. {@code preHandle} 은 인자
 * 검증 이전에 돌므로 시도 자체를 센다.
 *
 * <p><b>조회(GET)는 제외한다</b> — 내기 히스토리({@code GET .../challenges/{cid}/bets})는 신앱도
 * 쓰는 경로라 구앱 잔존 판별력이 없다. 등록 패턴이 개설(POST)과 히스토리(GET)를 공유하므로
 * 메서드로 가른다.
 */
@Slf4j
@Component
public class LegacyBetBridgeLogInterceptor implements HandlerInterceptor {

    /** 로그 집계 키 — 이 문자열로 세면 브리지 호출량이 나온다. */
    static final String BRIDGE_MARKER = "[legacy-bet-bridge]";

    /**
     * 인터셉터를 걸 경로 — 레거시 브리지의 변경 경로만. 신 참여 API(join-next 등)는 대상이 아니다.
     * 배열이 아니라 불변 List 인 이유: {@code public static final} 배열은 내용이 변경 가능해
     * SpotBugs(MS_MUTABLE_ARRAY) 대상이다.
     */
    public static final List<String> PATH_PATTERNS = List.of(
            "/api/v1/groups/*/challenges/*/bets",       // 개설(POST) · 히스토리(GET, 제외)
            "/api/v1/groups/*/bets/*",                  // 취소(DELETE)
            "/api/v1/groups/*/bets/*/join",             // 참가(POST)
            "/api/v1/groups/*/bets/*/participation");   // 철회(DELETE)

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (HttpMethod.GET.matches(request.getMethod())) {
            return true;
        }
        // userId 는 JwtFilter 가 이미 심어 둔 요청 속성이다(필터 → 인터셉터 순). 인증 실패 요청은
        // 여기까지 오지 않지만, 방어적으로 null 을 그대로 찍는다 — 집계의 관심사는 호출 자체다.
        log.info("{} {} {} — userId={}", BRIDGE_MARKER, request.getMethod(),
                request.getRequestURI(), request.getAttribute(AuthAttributes.USER_ID));
        return true;
    }
}
