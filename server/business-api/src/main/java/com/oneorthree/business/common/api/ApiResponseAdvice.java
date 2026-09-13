package com.oneorthree.business.common.api;

import org.springframework.core.MethodParameter;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.StringHttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;
import tools.jackson.databind.ObjectMapper;

/** 신규 JSON만 포장하며 선택된 String converter에는 JSON 문자열을 전달한다. */
@RestControllerAdvice
public final class ApiResponseAdvice implements ResponseBodyAdvice<Object> {

    private final ObjectMapper mapper;

    public ApiResponseAdvice(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) {
        return true;
    }

    @Override
    public Object beforeBodyWrite(Object body, MethodParameter returnType, MediaType selectedContentType,
            Class<? extends HttpMessageConverter<?>> selectedConverterType,
            ServerHttpRequest request, ServerHttpResponse response) {
        if (!(request instanceof ServletServerHttpRequest servletRequest)
                || !(response instanceof ServletServerHttpResponse servletResponse)
                || !PublicApiRoutes.usesEnvelope(servletRequest.getServletRequest())) {
            return body;
        }
        int status = servletResponse.getServletResponse().getStatus();
        if (status < 200 || status >= 300 || body instanceof ApiErrorResponse
                || body instanceof byte[] || body instanceof Resource
                || MediaType.TEXT_EVENT_STREAM.isCompatibleWith(selectedContentType)) {
            return body;
        }
        // 원본의 데이터 없는 신규 mutation도 data:null을 반환한다. 바이너리/streaming은 위에서 제외한다.
        if (status == 204) {
            servletResponse.getServletResponse().setStatus(200);
        }
        response.getHeaders().remove(HttpHeaders.CONTENT_LENGTH);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        Object envelope = body instanceof ApiSuccess<?> ? body : new ApiSuccess<>(body);
        if (StringHttpMessageConverter.class.isAssignableFrom(selectedConverterType)) {
            return mapper.writeValueAsString(envelope);
        }
        return envelope;
    }
}
