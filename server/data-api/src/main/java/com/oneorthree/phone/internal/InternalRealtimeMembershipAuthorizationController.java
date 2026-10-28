package com.oneorthree.phone.internal;

import com.oneorthree.phone.config.InternalCallAttributes;
import com.oneorthree.phone.internal.dto.RealtimeMembershipAuthorizationRequest;
import com.oneorthree.phone.internal.dto.RealtimeMembershipAuthorizationResponse;
import com.oneorthree.phone.internal.service.InternalRealtimeMembershipAuthorizationService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.Collections;

/** 단일 연결 주체의 현재 멤버십만 판정한다. 이벤트 전체 수신 허가나 재사용 가능한 자격이 아니다. */
@RestController
@RequiredArgsConstructor
@ConditionalOnProperty(prefix = "internal.realtime.authorization", name = "enabled", havingValue = "true")
public class InternalRealtimeMembershipAuthorizationController {
    private static final int MAX_BODY_BYTES = 1024;
    private final InternalRealtimeMembershipAuthorizationService service;

    /** 서비스 filter와 별도로 caller를 제한하여 Business의 넓은 허용목록도 이 조회를 열지 못한다. */
    @PostMapping(value = "/internal/realtime/membership-authorization", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<RealtimeMembershipAuthorizationResponse> authorize(
            HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        if (!"realtime".equals(request.getAttribute(InternalCallAttributes.CALLER))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).cacheControl(CacheControl.noStore()).build();
        }
        var subjects = Collections.list(request.getHeaders("X-User-Id"));
        if (subjects.size() != 1) {
            throw new IllegalArgumentException("검증된 단일 사용자 주체가 필요합니다.");
        }
        var userId = RealtimeMembershipAuthorizationRequest.identifier(subjects.get(0));
        if (request.getContentLengthLong() > MAX_BODY_BYTES) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).cacheControl(CacheControl.noStore()).build();
        }
        byte[] body = request.getInputStream().readNBytes(MAX_BODY_BYTES + 1);
        if (body.length > MAX_BODY_BYTES) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).cacheControl(CacheControl.noStore()).build();
        }
        var input = RealtimeMembershipAuthorizationRequest.fromJson(body);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new RealtimeMembershipAuthorizationResponse(service.isAllowed(userId, input)));
    }
}
