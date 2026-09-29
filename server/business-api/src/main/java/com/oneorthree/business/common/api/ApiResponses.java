package com.oneorthree.business.common.api;

import com.oneorthree.business.common.exception.ErrorResponse;
import com.oneorthree.business.config.RequestEnvelopeFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Servlet 필터와 MVC advice가 같은 DTO/serializer로 오류를 만든다. */
@Component
@Slf4j
public final class ApiResponses {

    private final ObjectMapper mapper;

    public ApiResponses(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public ResponseEntity<Object> error(HttpServletRequest request, ApiErrorCode code, String field,
            PublicCurrentState current) {
        if (current != null && code.getStatus().value() != 409) {
            throw new IllegalArgumentException("Only a conflict may expose current state");
        }
        var response = ResponseEntity.status(transportStatus(request, code)).contentType(MediaType.APPLICATION_JSON);
        if (code == ApiErrorCode.REQUEST_IN_PROGRESS) {
            response.header("Retry-After", "1");
        }
        return response.body(envelope(request, code.name(), code.getMessage(), field, code.isRetryable(), current));
    }

    public ApiErrorResponse envelope(HttpServletRequest request, String code, String message, String field,
            boolean retryable, PublicCurrentState current) {
        return new ApiErrorResponse(new ApiErrorResponse.Error(code, message, field, retryable),
                requestId(request), current);
    }

    public void writeFilterError(HttpServletRequest request, HttpServletResponse response, ApiErrorCode code,
            String legacyMessage) throws IOException {
        response.setStatus(transportStatus(request, code).value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        Object body = PublicApiRoutes.usesEnvelope(request)
                ? envelope(request, code.name(), code.getMessage(), null, code.isRetryable(), null)
                : new ErrorResponse(code.name(), legacyMessage);
        response.getWriter().write(mapper.writeValueAsString(body));
    }

    /** 앱 공개 계약만 4xx로 변환한다. 내부 분류와 재시도 여부는 전송 상태와 독립이다. */
    private HttpStatus transportStatus(HttpServletRequest request, ApiErrorCode code) {
        HttpStatus internal = code.getStatus();
        if (PublicApiRoutes.usesEnvelope(request) && internal.is5xxServerError()) {
            log.error("business_public_failure request_id={} internal_status={} public_status=400 code={}",
                    requestId(request), internal.value(), code.name());
            return HttpStatus.BAD_REQUEST;
        }
        return internal;
    }

    private String requestId(HttpServletRequest request) {
        Object id = request.getAttribute(RequestEnvelopeFilter.REQUEST_ID);
        if (id instanceof String value) {
            return value;
        }
        // MVC 단독 테스트/비표준 디스패치도 사용자 제공 헤더를 추적 ID로 신뢰하지 않는다.
        String created = UUID.randomUUID().toString();
        request.setAttribute(RequestEnvelopeFilter.REQUEST_ID, created);
        return created;
    }
}
