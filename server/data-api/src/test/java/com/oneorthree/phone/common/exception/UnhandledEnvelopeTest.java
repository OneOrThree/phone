package com.oneorthree.phone.common.exception;

import jakarta.persistence.EntityNotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 종전에 봉투 <b>밖으로</b> 새던 일곱 경로가 이제 {@code {code, message}} 로 나가는지 못박는다 (GROMO-1657).
 *
 * <p>2026-09-09 실측: 이 일곱 경로는 전부 핸들러가 없어 스프링 기본 바디({@code timestamp·status·error·path})
 * 로 나갔고, 앱은 {@code body.code} 만 읽으므로 전부 «알 수 없는 오류»였다. {@code @Valid} 만 컨트롤러
 * 26곳이다. 그리고 {@code IllegalArgumentException} 은 {@code e.getMessage()} 를 그대로 반사했다.
 *
 * <p>여기서 잡는 회귀: 핸들러가 하나라도 빠지면 그 경로의 {@code $.code} 가 사라진다 —
 * 상태 코드는 스프링 기본과 같아서 상태만 보는 테스트로는 잡히지 않는다.
 */
@WebMvcTest(controllers = UnhandledEnvelopeTest.ThrowingController.class)
@Import(UnhandledEnvelopeTest.ThrowingController.class)
class UnhandledEnvelopeTest {

    @Autowired
    private MockMvc mockMvc;

    record Body(@NotBlank(message = "이름은 비울 수 없습니다.") String name) { }

    /** 테스트 전용 진입점. {@code /api/} 밖이라 {@code JwtFilter} 를 타지 않는다. */
    @RestController
    static class ThrowingController {
        @PostMapping("/__envelope/valid")
        String valid(@Valid @RequestBody Body body) {
            return "ok";
        }

        @GetMapping("/__envelope/param")
        String param(@RequestParam String q) {
            return q;
        }

        @GetMapping("/__envelope/json")
        Body json() {
            return new Body("x");
        }

        @GetMapping("/__envelope/entity")
        String entity() {
            throw new EntityNotFoundException("아이템을 찾을 수 없습니다.");
        }

        @GetMapping("/__envelope/illegal-argument")
        String illegalArgument() {
            throw new IllegalArgumentException("internal-detail-that-must-not-leak");
        }

        @GetMapping("/__envelope/boom")
        String boom() {
            throw new IllegalStateException("internal-detail-that-must-not-leak");
        }
    }

    @Test
    @DisplayName("@Valid 실패 → 400 INVALID_REQUEST, 문구는 DTO 애노테이션의 것")
    void validationFailureIsEnveloped() throws Exception {
        mockMvc.perform(post("/__envelope/valid").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.message").value("이름은 비울 수 없습니다."));
    }

    @Test
    @DisplayName("깨진 JSON → 400 INVALID_REQUEST, 파서 메시지는 싣지 않는다")
    void unreadableBodyIsEnveloped() throws Exception {
        mockMvc.perform(post("/__envelope/valid").contentType(MediaType.APPLICATION_JSON).content("{not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.message").value(CommonErrorCode.INVALID_REQUEST.getMessage()));
    }

    @Test
    @DisplayName("필수 파라미터 누락 → 400 INVALID_PARAMETER, 문구에 파라미터 이름")
    void missingParameterIsEnveloped() throws Exception {
        mockMvc.perform(get("/__envelope/param"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.message").value("요청 파라미터 'q' 이(가) 필요합니다."));
    }

    @Test
    @DisplayName("허용 안 된 메서드 → 405 METHOD_NOT_ALLOWED")
    void methodNotAllowedIsEnveloped() throws Exception {
        mockMvc.perform(post("/__envelope/param"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.code").value("METHOD_NOT_ALLOWED"))
                // 405 는 Allow 가 규약상 필수 — 봉투를 만들면서 버리면 클라이언트가 지원 메서드를 알 수 없다
                .andExpect(header().string("Allow", org.hamcrest.Matchers.containsString("GET")));
    }

    @Test
    @DisplayName("없는 경로 → 404 RESOURCE_NOT_FOUND — 앱의 «그룹이 사라짐» 코드(NOT_FOUND)와 섞이지 않는다")
    void unknownPathIsEnvelopedWithItsOwnCode() throws Exception {
        mockMvc.perform(get("/__envelope/nope"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
    }

    @Test
    @DisplayName("EntityNotFoundException → 404 ENTITY_NOT_FOUND — 종전엔 500 이었다")
    void entityNotFoundIsNoLongerA500() throws Exception {
        mockMvc.perform(get("/__envelope/entity"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ENTITY_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value(CommonErrorCode.ENTITY_NOT_FOUND.getMessage()));
    }

    @Test
    @DisplayName("IllegalArgumentException → 409 그대로이되 예외 메시지를 더 이상 반사하지 않는다")
    void illegalArgumentKeepsStatusButStopsReflectingMessage() throws Exception {
        mockMvc.perform(get("/__envelope/illegal-argument"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ILLEGAL_ARGUMENT"))
                .andExpect(jsonPath("$.message").value(CommonErrorCode.ILLEGAL_ARGUMENT.getMessage()))
                .andExpect(jsonPath("$.message").value(not("internal-detail-that-must-not-leak")));
    }

    @Test
    @DisplayName("받을 수 없는 Content-Type → 415 UNSUPPORTED_MEDIA_TYPE — catch-all 이 500 으로 바꾸면 안 된다")
    void unsupportedMediaTypeKeepsItsStatus() throws Exception {
        mockMvc.perform(post("/__envelope/valid").contentType(MediaType.TEXT_PLAIN).content("name=x"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_MEDIA_TYPE"))
                // 예외가 만든 Accept(지원 타입 목록) 헤더도 함께 나가야 한다
                .andExpect(header().string("Accept", org.hamcrest.Matchers.containsString("application/json")));
    }

    @Test
    @DisplayName("만들 수 없는 Accept → 406 — catch-all 이 500 으로 바꾸면 안 된다 (봉투는 못 싣는다)")
    void notAcceptableKeepsItsStatus() throws Exception {
        // String 반환은 어떤 Accept 에도 써지므로 JSON 객체를 돌려주는 경로로 406 을 유발한다.
        // 이 경우만은 봉투를 단언하지 않는다 — 클라이언트가 JSON 을 거부한 상태라 스프링이 JSON 봉투를
        // 쓸 수 없고 본문을 비운다. 핸들러는 NOT_ACCEPTABLE 을 만들지만 전송이 불가능하다.
        // 지키는 것은 «상태가 406 이지 500 이 아니다» 하나다.
        mockMvc.perform(get("/__envelope/json").accept(MediaType.APPLICATION_XML))
                .andExpect(status().isNotAcceptable());
    }

    @Test
    @DisplayName("그 외 전부 → 500 INTERNAL_ERROR 고정 문구 — 내부 메시지는 응답에 없다")
    void anythingElseIsEnvelopedAs500() throws Exception {
        mockMvc.perform(get("/__envelope/boom"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.message").value(CommonErrorCode.INTERNAL_ERROR.getMessage()));
    }
}
