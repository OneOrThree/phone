package com.oneorthree.business.common.api;

import com.oneorthree.business.common.exception.CompositionCapacityExceededException;
import com.oneorthree.business.common.exception.UpstreamCredentialRejectedException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.exception.UpstreamTimeoutException;
import com.oneorthree.business.linkpreview.exception.PreviewException;
import com.oneorthree.business.linkpreview.dto.Preview;
import com.oneorthree.business.linkpreview.service.PreviewService;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** MVC 단독 스텁이 아니라 Boot가 등록한 두 Servlet 필터를 포함해 외부 와이어를 검증한다. */
@Import({PublicApiContractTest.ProbeController.class, PublicApiContractTest.UnknownLengthConfig.class})
class PublicApiContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.randomUUID();
    private static final String ROOT = "/me/_contract";

    @MockitoBean
    private PreviewService previewService;

    @Test
    void freezesPublishedErrorNames() {
        assertThat(ApiErrorCode.values()).extracting(Enum::name).containsExactlyInAnyOrder(
                "INVALID_REQUEST", "INVALID_PARAMETER", "INVALID_IDEMPOTENCY_KEY", "INVALID_CURSOR", "UNAUTHORIZED",
                "FORBIDDEN", "FACILITY_LOCKED", "NOT_FOUND", "USER_NOT_FOUND", "RESOURCE_NOT_FOUND", "PRODUCT_NOT_FOUND", "METHOD_NOT_ALLOWED", "VERSION_CONFLICT", "STATE_CONFLICT",
                "INSUFFICIENT_FUNDS", "IDEMPOTENCY_KEY_REUSED", "REQUEST_IN_PROGRESS", "CURSOR_EXPIRED",
                "INVITATION_EXPIRED", "REQUEST_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "OUT_OF_RANGE", "RATE_LIMITED", "INTERNAL_ERROR",
                "UPSTREAM_CONTRACT_ERROR", "UPSTREAM_AUTH_FAILED", "SERVICE_UNAVAILABLE", "UPSTREAM_TIMEOUT");
    }

    @Test
    void unauthorizedUsesCurrentServerRequestIdAndFourErrorFields() throws Exception {
        MvcResult first = mockMvc.perform(get(ROOT).header("X-Request-Id", "caller-controlled"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"))
                .andExpect(jsonPath("$.error.message").isString()).andExpect(jsonPath("$.error.length()").value(4))
                .andExpect(jsonPath("$.error.field").hasJsonPath()).andExpect(jsonPath("$.error.retryable").value(false))
                .andExpect(jsonPath("$.current").doesNotExist()).andExpect(jsonPath("$.data").doesNotExist())
                .andReturn();
        String id = first.getResponse().getHeader("X-Request-Id");
        UUID.fromString(id);
        assertThat(first.getResponse().getContentAsString()).contains("\"requestId\":\"" + id + "\"");
        assertThat(id).isNotEqualTo("caller-controlled");
        MvcResult second = mockMvc.perform(get(ROOT)).andReturn();
        assertThat(second.getResponse().getHeader("X-Request-Id")).isNotEqualTo(id);
    }

    @Test
    void wrapsDataExactlyOnceAndHandlesStringAndEmptyConverters() throws Exception {
        mockMvc.perform(auth(get(ROOT + "/object"))).andExpect(jsonPath("$.data.id").value("one"))
                .andExpect(jsonPath("$.data.data").doesNotExist());
        mockMvc.perform(auth(get(ROOT + "/wrapped"))).andExpect(jsonPath("$.data.id").value("one"))
                .andExpect(jsonPath("$.data.data").doesNotExist());
        mockMvc.perform(auth(get(ROOT + "/string"))).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.data").value("한글 \"문자열\""));
        mockMvc.perform(auth(get(ROOT + "/null"))).andExpect(status().isOk())
                .andExpect(content().json("{\"data\":null}"));
        mockMvc.perform(auth(get(ROOT + "/empty"))).andExpect(status().isOk())
                .andExpect(content().json("{\"data\":null}"));
        mockMvc.perform(auth(post(ROOT + "/created"))).andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value("one"));
        mockMvc.perform(auth(get(ROOT + "/page"))).andExpect(jsonPath("$.data.items").isEmpty())
                .andExpect(jsonPath("$.data.nextCursor").hasJsonPath());
    }

    @Test
    void preservesBinaryAndStreamingBodies() throws Exception {
        byte[] png = { (byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10 };
        when(previewService.thumbnail(anyString(), anyString())).thenReturn(png);
        mockMvc.perform(auth(get("/link-previews/p/thumbnail")).accept(MediaType.IMAGE_PNG))
                .andExpect(status().isOk()).andExpect(content().contentType(MediaType.IMAGE_PNG))
                .andExpect(content().bytes(png));
        MvcResult async = mockMvc.perform(auth(get(ROOT + "/stream")))
                .andExpect(request().asyncStarted()).andReturn();
        mockMvc.perform(asyncDispatch(async)).andExpect(content().bytes("raw-stream".getBytes(StandardCharsets.UTF_8)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"/link-previews/missing/thumbnail", "/api/v1/link-previews/missing/thumbnail"})
    void incompatibleThumbnailAcceptReturnsEmpty406(String path) throws Exception {
        mockMvc.perform(auth(get(path)).accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotAcceptable())
                .andExpect(content().bytes(new byte[0]))
                .andExpect(header().doesNotExist("Content-Type"))
                .andExpect(header().exists("X-Request-Id"));
        org.mockito.Mockito.verifyNoInteractions(previewService);
    }

    @Test
    void previewErrorsUseNewEnvelopeEvenWhenPngWasRequested() throws Exception {
        when(previewService.thumbnail(anyString(), anyString())).thenThrow(new PreviewException("NOT_FOUND"));
        mockMvc.perform(auth(get("/link-previews/missing/thumbnail")).accept(MediaType.IMAGE_PNG))
                .andExpect(status().isNotFound()).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
        mockMvc.perform(auth(get("/api/v1/link-previews/missing/thumbnail")).accept(MediaType.IMAGE_PNG))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"))
                .andExpect(jsonPath("$.error").doesNotExist());
    }

    @Test
    void previewAliasKeepsFailureDataAndUsesItsOwnThumbnailPath() throws Exception {
        Preview failed = new Preview("p", "FAILED", "https://example.com/file", null, null,
                null, null, null, "FETCH_TIMEOUT");
        when(previewService.request(anyString(), any(), anyString())).thenReturn(List.of(failed));
        mockMvc.perform(auth(post("/link-previews")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"urls\":[\"https://example.com/file\"]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data[0].errorCode").value("FETCH_TIMEOUT"))
                .andExpect(jsonPath("$.error").doesNotExist());
        Preview ready = new Preview("p", "READY", "https://example.com/file", "file", "application/pdf",
                12L, "FILE", "/api/v1/link-previews/p/thumbnail", null);
        when(previewService.get(anyString(), anyString())).thenReturn(ready);
        mockMvc.perform(auth(get("/link-previews/p")))
                .andExpect(jsonPath("$.data.thumbnailUrl").value("/link-previews/p/thumbnail"));
        mockMvc.perform(auth(get("/api/v1/link-previews/p")))
                .andExpect(jsonPath("$.thumbnailUrl").value("/api/v1/link-previews/p/thumbnail"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"INVALID_URL", "BLOCKED_ADDRESS", "FETCH_TIMEOUT", "REDIRECT_REJECTED",
            "NOT_PUBLIC_OR_NOT_FOUND", "UPSTREAM_ERROR", "UNSUPPORTED_CONTENT", "FILE_TOO_LARGE",
            "DRIVE_NOT_CONFIGURED", "INVALID_IMAGE", "IMAGE_TOO_LARGE", "THUMBNAIL_TOO_LARGE",
            "RENDER_TIMEOUT", "INVALID_PDF", "UNSUPPORTED_DRIVE_LINK", "FETCH_FAILED", "INVALID_REQUEST"})
    void previewExceptionCodesRemainSpecific(String code) throws Exception {
        when(previewService.get(anyString(), anyString())).thenThrow(new PreviewException(code));
        mockMvc.perform(auth(get("/link-previews/p"))).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value(code)).andExpect(jsonPath("$.error.retryable").value(false));
    }

    @ParameterizedTest
    @CsvSource({"timeout,504,UPSTREAM_TIMEOUT,true", "capacity,503,SERVICE_UNAVAILABLE,true",
            "credentials,502,UPSTREAM_AUTH_FAILED,false", "unknown,502,UPSTREAM_CONTRACT_ERROR,false",
            "mismatched,502,UPSTREAM_CONTRACT_ERROR,false", "unexpected,500,INTERNAL_ERROR,false",
            "receipt-version,409,STATE_CONFLICT,false", "key-conflict,409,IDEMPOTENCY_KEY_REUSED,false",
            "pending,409,REQUEST_IN_PROGRESS,true"})
    void classifiesErrorsWithoutLeakingUpstreamPayload(String kind, int expectedStatus, String code,
            boolean retryable) throws Exception {
        MvcResult result = mockMvc.perform(auth(get(ROOT + "/error/" + kind)))
                .andExpect(status().is(expectedStatus)).andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.error.retryable").value(retryable))
                .andExpect(jsonPath("$.error.field").hasJsonPath()).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("PRIVATE_RAW_DETAIL");
        if ("pending".equals(kind)) {
            assertThat(result.getResponse().getHeader("Retry-After")).isEqualTo("1");
        }
        if ("key-conflict".equals(kind)) {
            assertThat(result.getResponse().getContentAsString()).contains("Idempotency-Key");
        }
    }

    @Test
    void exposesOnlyExplicitPublicConflictState() throws Exception {
        mockMvc.perform(auth(get(ROOT + "/error/conflict"))).andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.field").value("expectedVersion"))
                .andExpect(jsonPath("$.current.version").value(4))
                .andExpect(jsonPath("$.current.resource.state").value("paused"))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    @Test
    void keepsLegacyAndInternalBodiesAndDomainReasons() throws Exception {
        mockMvc.perform(auth(get("/api/v1/_contract/object"))).andExpect(jsonPath("$.id").value("one"))
                .andExpect(jsonPath("$.data").doesNotExist());
        mockMvc.perform(auth(get("/internal/_contract/object"))).andExpect(jsonPath("$.id").value("one"));
        mockMvc.perform(auth(get("/api/v1/_contract/error/unknown"))).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("UNREGISTERED_DOMAIN"))
                .andExpect(jsonPath("$.message").value("PRIVATE_RAW_DETAIL"))
                .andExpect(jsonPath("$.retryAfterMs").value(1500));
        mockMvc.perform(auth(get("/api/v1/_contract/error/timeout"))).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("UPSTREAM_UNAVAILABLE"));
    }

    @Test
    void mvcFrameworkErrorsAreUniformAndKeepAllowHeader() throws Exception {
        mockMvc.perform(auth(get("/islands/not-a-real-route"))).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("RESOURCE_NOT_FOUND"));
        mockMvc.perform(auth(put(ROOT + "/object"))).andExpect(status().isMethodNotAllowed())
                .andExpect(header().exists("Allow")).andExpect(jsonPath("$.error.code").value("METHOD_NOT_ALLOWED"));
        mockMvc.perform(auth(post(ROOT + "/body")).contentType(MediaType.TEXT_PLAIN).content("wrong"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error.code").value("UNSUPPORTED_MEDIA_TYPE"));
        mockMvc.perform(auth(post(ROOT + "/body")).contentType(MediaType.APPLICATION_JSON).content("{"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        mockMvc.perform(auth(post(ROOT + "/body")).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.field").value("name"));
        mockMvc.perform(auth(post(ROOT + "/body")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"too long\"}"))
                .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.error.code").value("OUT_OF_RANGE"));
    }

    @Test
    void declaredAndUnknownLengthBodiesCannotBypassLimit() throws Exception {
        String huge = "{\"name\":\"" + "x".repeat(270_000) + "\"}";
        mockMvc.perform(auth(post(ROOT + "/body")).contentType(MediaType.APPLICATION_JSON).content(huge))
                .andExpect(status().isPayloadTooLarge()).andExpect(jsonPath("$.error.code").value("REQUEST_TOO_LARGE"));
        for (String route : List.of("/body", "/reader")) {
            mockMvc.perform(auth(post(ROOT + route)).contentType(MediaType.APPLICATION_JSON).content(huge)
                    .header("X-Test-Unknown-Length", "true"))
                    .andExpect(status().isPayloadTooLarge()).andExpect(jsonPath("$.error.code").value("REQUEST_TOO_LARGE"));
        }
    }

    @Test
    void stripsUserIdentityFromAllHeaderAccessors() throws Exception {
        mockMvc.perform(auth(get(ROOT + "/headers")).header("X-User-Id", "123", "456"))
                .andExpect(jsonPath("$.data.headerMissing").value(true))
                .andExpect(jsonPath("$.data.valuesEmpty").value(true))
                .andExpect(jsonPath("$.data.nameMissing").value(true))
                .andExpect(jsonPath("$.data.integer").value(-1))
                .andExpect(jsonPath("$.data.date").value(-1));
    }

    @ParameterizedTest
    @CsvSource({"/auth/sessions", "/auth/sessions/current", "/%6de/_contract", "/me;v=1/_contract"})
    void responseClassificationNeverOpensAuthentication(String path) throws Exception {
        mockMvc.perform(get(java.net.URI.create(path))).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
    }

    @ParameterizedTest
    @CsvSource({"USER_NOT_FOUND", "RESOURCE_NOT_FOUND", "PRODUCT_NOT_FOUND"})
    void upstreamMissingResourcesKeepRecoveryMeaning(String code) throws Exception {
        mockMvc.perform(auth(get(ROOT + "/error/" + code))).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value(code))
                .andExpect(jsonPath("$.error.retryable").value(false))
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("PRIVATE_RAW_DETAIL"))));
    }

    @Test
    void inactiveCallerKeepsPublicRecoveryAndLegacyStatus() throws Exception {
        mockMvc.perform(auth(get(ROOT + "/error/inactive"))).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("USER_NOT_FOUND"));
        mockMvc.perform(auth(get("/api/v1/_contract/error/inactive"))).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("USER_INACTIVE"));
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder builder) {
        return builder.header("Authorization", "Bearer " + Tokens.access(USER));
    }

    /** chunked transport와 같이 선언 길이를 모르는 요청을 실제 본문 필터 앞에 놓는다. */
    @TestConfiguration(proxyBeanMethods = false)
    static class UnknownLengthConfig {
        @Bean
        FilterRegistrationBean<Filter> unknownLengthTransport() {
            Filter filter = (request, response, chain) -> {
                HttpServletRequest http = (HttpServletRequest) request;
                if (http.getHeader("X-Test-Unknown-Length") == null) {
                    chain.doFilter(request, response);
                    return;
                }
                chain.doFilter(new HttpServletRequestWrapper(http) {
                    @Override
                    public int getContentLength() {
                        return -1;
                    }

                    @Override
                    public long getContentLengthLong() {
                        return -1;
                    }
                }, response);
            };
            FilterRegistrationBean<Filter> registration = new FilterRegistrationBean<>(filter);
            registration.setOrder(-10);
            registration.addUrlPatterns("/*");
            return registration;
        }
    }

    @RestController
    static class ProbeController {
        @GetMapping({ROOT + "/object", "/api/v1/_contract/object", "/internal/_contract/object"})
        Map<String, String> object() {
            return Map.of("id", "one");
        }

        @GetMapping(ROOT + "/page")
        Page page() {
            return new Page(List.of(), null);
        }

        @GetMapping(ROOT + "/wrapped")
        ApiSuccess<Map<String, String>> wrapped() {
            return new ApiSuccess<>(Map.of("id", "one"));
        }

        @GetMapping(ROOT + "/string")
        String string() {
            return "한글 \"문자열\"";
        }

        @GetMapping(ROOT + "/null")
        Object absent() {
            return null;
        }

        @GetMapping(ROOT + "/empty")
        ResponseEntity<Void> empty() {
            return ResponseEntity.noContent().build();
        }

        @PostMapping(ROOT + "/created")
        ResponseEntity<Map<String, String>> created() {
            return ResponseEntity.status(201).body(Map.of("id", "one"));
        }

        @GetMapping(ROOT + "/stream")
        StreamingResponseBody stream() {
            return output -> output.write("raw-stream".getBytes(StandardCharsets.UTF_8));
        }

        @PostMapping(value = ROOT + "/body", consumes = MediaType.APPLICATION_JSON_VALUE)
        Input body(@Valid @RequestBody Input input) {
            return input;
        }

        @PostMapping(ROOT + "/reader")
        String reader(HttpServletRequest request) throws IOException {
            return request.getReader().readLine();
        }

        @GetMapping(ROOT + "/headers")
        Map<String, Object> headers(HttpServletRequest request) {
            return Map.of("headerMissing", request.getHeader("x-user-id") == null,
                    "valuesEmpty", !request.getHeaders("X-USER-ID").hasMoreElements(),
                    "nameMissing", Collections.list(request.getHeaderNames()).stream()
                            .noneMatch(name -> "x-user-id".equalsIgnoreCase(name)),
                    "integer", request.getIntHeader("X-User-Id"), "date", request.getDateHeader("X-User-Id"));
        }

        @GetMapping({ROOT + "/error/{kind}", "/api/v1/_contract/error/{kind}"})
        Object error(@PathVariable String kind) {
            throw switch (kind) {
                case "USER_NOT_FOUND", "RESOURCE_NOT_FOUND", "PRODUCT_NOT_FOUND" ->
                        new UpstreamDomainException(404, kind, "PRIVATE_RAW_DETAIL", null);
                case "inactive" -> new com.oneorthree.business.common.exception.DomainException(
                        com.oneorthree.business.common.exception.CommonErrorCode.USER_INACTIVE);
                case "timeout" -> new UpstreamTimeoutException("PRIVATE_RAW_DETAIL");
                case "capacity" -> new CompositionCapacityExceededException("PRIVATE_RAW_DETAIL");
                case "credentials" -> new UpstreamCredentialRejectedException("PRIVATE_RAW_DETAIL");
                case "unknown" -> new UpstreamDomainException(409, "UNREGISTERED_DOMAIN", "PRIVATE_RAW_DETAIL", 1500L);
                case "mismatched" -> new UpstreamDomainException(404, "VERSION_CONFLICT", "PRIVATE_RAW_DETAIL", null);
                case "receipt-version" -> new UpstreamDomainException(409, "PUBLIC_COMMAND_CONTRACT_UNSUPPORTED", "x", null);
                case "key-conflict" -> new UpstreamDomainException(409, "IDEMPOTENCY_KEY_CONFLICT", "x", null);
                case "pending" -> new PublicApiException(ApiErrorCode.REQUEST_IN_PROGRESS, null);
                case "conflict" -> new PublicApiException(ApiErrorCode.VERSION_CONFLICT, "expectedVersion",
                        new PublicCurrentState(4, Map.of("state", "paused")));
                default -> new IllegalStateException("PRIVATE_RAW_DETAIL");
            };
        }
    }

    record Page(List<String> items, String nextCursor) {
    }

    record Input(@NotNull @Size(max = 4) String name) {
    }
}
