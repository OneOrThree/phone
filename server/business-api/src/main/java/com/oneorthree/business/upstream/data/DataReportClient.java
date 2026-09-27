package com.oneorthree.business.upstream.data;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.data.dto.ReportDeliveryView;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;

import java.util.Map;
import java.util.UUID;

import static com.oneorthree.business.upstream.data.DataPaths.userPath;

/** 신고 Gmail side effect를 직렬화하는 Data 영속 intent 클라이언트. */
public class DataReportClient {

    private static final String PATH = "/internal/users/{userId}/report-deliveries/{requestId}/{action}";
    private final InternalHttpClient http;

    public DataReportClient(InternalHttpClient http) {
        this.http = http;
    }

    public ReportDeliveryView claim(UUID userId, UUID requestId, String fingerprint, String caseId,
            UUID claimToken, boolean blockRequested, Deadline deadline) {
        return exchange(userId, requestId, "claim", Map.of(
                "fingerprint", fingerprint, "caseId", caseId, "claimToken", claimToken,
                "blockRequested", blockRequested), deadline);
    }

    public ReportDeliveryView prepare(UUID userId, UUID requestId, UUID leaseToken, UUID authorId,
            String subject, String body, Deadline deadline) {
        return exchange(userId, requestId, "prepare", Map.of(
                "leaseToken", leaseToken, "authorId", authorId, "subject", subject, "body", body), deadline);
    }

    public ReportDeliveryView renew(UUID userId, UUID requestId, UUID leaseToken, Deadline deadline) {
        return exchange(userId, requestId, "renew", Map.of("leaseToken", leaseToken), deadline);
    }

    public ReportDeliveryView emailConfirmed(UUID userId, UUID requestId, UUID leaseToken, Deadline deadline) {
        return exchange(userId, requestId, "email-confirmed", Map.of("leaseToken", leaseToken), deadline);
    }

    public ReportDeliveryView expire(UUID userId, UUID requestId, UUID leaseToken, Deadline deadline) {
        return exchange(userId, requestId, "expire", Map.of("leaseToken", leaseToken), deadline);
    }

    public ReportDeliveryView complete(UUID userId, UUID requestId, UUID leaseToken, boolean blocked,
            Deadline deadline) {
        return exchange(userId, requestId, "complete", Map.of("leaseToken", leaseToken, "blocked", blocked), deadline);
    }

    public void release(UUID userId, UUID requestId, UUID leaseToken, Deadline deadline) {
        http.execute(InternalCall.to(HttpMethod.POST, path(userId, requestId, "release"))
                .onBehalfOf(userId).body(Map.of("leaseToken", leaseToken)).idempotentCommand().build(), deadline);
    }

    private ReportDeliveryView exchange(UUID userId, UUID requestId, String action, Object body, Deadline deadline) {
        return http.exchange(InternalCall.to(HttpMethod.POST, path(userId, requestId, action))
                        .onBehalfOf(userId).body(body).idempotentCommand().build(),
                deadline, new ParameterizedTypeReference<ReportDeliveryView>() { });
    }

    private static String path(UUID userId, UUID requestId, String action) {
        return userPath(PATH, userId)
                .replace("{requestId}", requestId.toString())
                .replace("{action}", action);
    }
}
