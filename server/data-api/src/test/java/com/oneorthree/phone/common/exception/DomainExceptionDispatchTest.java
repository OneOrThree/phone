package com.oneorthree.phone.common.exception;

import com.oneorthree.phone.group.exception.ChallengeResultClaimHeldException;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 스프링이 <b>어느 핸들러를 고르는지</b>를 실제 디스패치로 못박는다 (GROMO-1657).
 *
 * <p>{@code ErrorContractTest} 는 핸들러 메서드를 <b>직접 호출</b>하므로 상수 100개의 값은 지키지만
 * 「이 예외가 그 메서드에 도달하는가」는 지키지 못한다. 지금 위험한 자리는 하나다 —
 * {@code ChallengeResultClaimHeldException} 은 {@code GroupException} 을 거쳐 {@code DomainException} 의
 * 손자라서, 전용 핸들러({@code retryAfterMs} 를 얹음)와 공용 핸들러 둘 다 매칭된다. 스프링은 예외
 * 클래스에서 매핑 타입까지의 <b>거리가 가장 짧은</b> 핸들러를 고르므로 전용(거리 0)이 이겨야 하는데,
 * 그 선택은 컨트롤러를 통과시켜야만 검증된다. 잘못 고르면 지연 힌트가 빠진 봉투가 나가고, 앱은
 * 폴링으로 되돌아간다.
 *
 * <p>경로를 {@code /api/} 밖에 둔 이유: {@code JwtFilter} 는 {@code /api/*} 만 감시하므로 인증을
 * 세우지 않고 예외 경로만 본다.
 */
@WebMvcTest(controllers = DomainExceptionDispatchTest.ThrowingController.class)
// 테스트 클래스 안의 중첩 컨트롤러는 슬라이스의 컴포넌트 스캔에 잡히지 않는다(빈 0개 → 404) — 직접 등록한다.
@Import(DomainExceptionDispatchTest.ThrowingController.class)
class DomainExceptionDispatchTest {

    @Autowired
    private MockMvc mockMvc;

    /** 테스트 전용 진입점 — 예외를 던지는 일만 한다. */
    @RestController
    static class ThrowingController {

        @GetMapping("/__dispatch/claim-held")
        String claimHeld() {
            throw new ChallengeResultClaimHeldException(1500L);
        }

        @GetMapping("/__dispatch/plain-domain")
        String plainDomain() {
            throw new GroupException(GroupErrorCode.MEMBER_ONLY);
        }
    }

    @Test
    @DisplayName("손자 타입은 전용 핸들러가 이긴다 — retryAfterMs 가 봉투에 실린다")
    void grandchildSubtypeIsRoutedToItsDedicatedHandler() throws Exception {
        mockMvc.perform(get("/__dispatch/claim-held"))
                .andExpect(status().is(GroupErrorCode.RESULT_CLAIM_HELD.getStatus().value()))
                .andExpect(jsonPath("$.code").value("RESULT_CLAIM_HELD"))
                .andExpect(jsonPath("$.message").value(GroupErrorCode.RESULT_CLAIM_HELD.getMessage()))
                // 공용 핸들러로 갔다면 이 필드가 없다 — 그것이 이 테스트가 잡는 회귀다
                .andExpect(jsonPath("$.retryAfterMs").value(1500));
    }

    @Test
    @DisplayName("평범한 도메인 예외는 공용 핸들러로 — 상태·code·message 가 enum 그대로, 추가 필드 없음")
    void plainDomainExceptionIsRoutedToTheSharedHandler() throws Exception {
        mockMvc.perform(get("/__dispatch/plain-domain"))
                .andExpect(status().is(GroupErrorCode.MEMBER_ONLY.getStatus().value()))
                .andExpect(jsonPath("$.code").value("MEMBER_ONLY"))
                .andExpect(jsonPath("$.message").value(GroupErrorCode.MEMBER_ONLY.getMessage()))
                .andExpect(jsonPath("$.retryAfterMs").doesNotExist());
    }
}
