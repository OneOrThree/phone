package com.oneorthree.phone.common.exception;

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

/** 도메인 예외의 HTTP 상태와 응답 봉투를 실제 MVC 디스패치로 검증한다. */
@WebMvcTest(controllers = DomainExceptionDispatchTest.ThrowingController.class)
// 테스트 클래스 안의 중첩 컨트롤러는 슬라이스의 컴포넌트 스캔에 잡히지 않는다(빈 0개 → 404) — 직접 등록한다.
@Import(DomainExceptionDispatchTest.ThrowingController.class)
class DomainExceptionDispatchTest {

    @Autowired
    private MockMvc mockMvc;

    /** 테스트 전용 진입점 — 예외를 던지는 일만 한다. */
    @RestController
    static class ThrowingController {

        @GetMapping("/__dispatch/plain-domain")
        String plainDomain() {
            throw new GroupException(GroupErrorCode.MEMBER_ONLY);
        }
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
