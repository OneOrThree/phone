package com.oneorthree.business.upstream.data;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import java.time.Instant;
import java.util.UUID;

/** 신고 접수 전용 클라이언트. 클라이언트 입력을 URL·주체 헤더로 사용하지 않는다. */
public class DataReportClient {
    private final InternalHttpClient http;

    public DataReportClient(InternalHttpClient http) {
        this.http = http;
    }

    public Receipt submit(UUID userId, UUID sessionId, Long authGeneration, Command body, Deadline deadline) {
        return http.exchange(InternalCall.to(HttpMethod.POST, "/internal/users/" + userId + "/reports")
                        .onBehalfOf(userId).body(new Submission(sessionId, authGeneration, body)).build(), deadline,
                new ParameterizedTypeReference<Receipt>() { });
    }

    public record Command(UUID requestId, String targetType, UUID targetId, UUID targetUserId,
                          String reason, String details, String submittedText) {
    }

    public record Submission(UUID sessionId, Long authGeneration, Command report) {
    }

    public record Receipt(@JsonProperty(required = true) UUID reportId,
                          @JsonProperty(required = true) Instant receivedAt) {
    }
}
