package com.oneorthree.business.usecase;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.report.ReportMailException;
import com.oneorthree.business.report.ReportMailGateway;
import com.oneorthree.business.upstream.data.DataFriendClient;
import com.oneorthree.business.upstream.data.DataReportClient;
import com.oneorthree.business.upstream.data.dto.FriendItem;
import com.oneorthree.business.upstream.data.dto.LetterView;
import com.oneorthree.business.upstream.data.dto.ReportDeliveryView;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

/** 친구 프로필·받은 편지의 서버 원문을 확인해 운영 메일함에 접수한다. */
@Service
@RequiredArgsConstructor
public class ReportUseCase {

    private final DataFriendClient data;
    private final DataReportClient deliveries;
    private final UserBlockUseCase blocks;
    private final ReportMailGateway mail;

    public ReportReceipt report(AccessTokenClaims claims, UUID requestId, ReportTargetType targetType,
            UUID targetId, ReportReason reason, String description, String replyEmail, boolean blockUser,
            Deadline deadline) {
        String caseId = caseId(claims.userId(), requestId);
        String fingerprint = fingerprint(targetType, targetId, reason, description, replyEmail, blockUser);
        ReportDeliveryView delivery = deliveries.claim(claims.userId(), requestId, fingerprint, caseId,
                blockUser, deadline);
        if (delivery.completed()) {
            return new ReportReceipt(delivery.caseId(), Boolean.TRUE.equals(delivery.blocked()));
        }
        UUID leaseToken = delivery.leaseToken();
        try {
            if (!delivery.emailConfirmed() && !delivery.prepared()) {
                Evidence evidence = evidence(claims.userId(), targetType, targetId, deadline);
                String subject = "[GROMO 신고] " + caseId + " / " + targetType;
                String mailBody = body(caseId, requestId, claims.userId(), targetType, targetId, evidence, reason,
                        description, replyEmail);
                delivery = deliveries.prepare(claims.userId(), requestId, leaseToken, evidence.authorId(),
                        subject, mailBody, deadline);
            }
            if (!delivery.emailConfirmed()) {
                ReportMailGateway.ReportMail message = new ReportMailGateway.ReportMail(
                        delivery.caseId(), requestId.toString(), delivery.confirmationToken().toString(),
                        delivery.subject(), delivery.body());
                mail.deliverAndConfirm(message,
                        () -> deliveries.renew(claims.userId(), requestId, leaseToken, Deadline.unbounded()));
                delivery = deliveries.emailConfirmed(claims.userId(), requestId, leaseToken, Deadline.unbounded());
            }
            // Gmail 확인은 상류 조합 3초 예산보다 길 수 있다. 확인된 외부 side effect의 후처리를
            // 이미 만료된 deadline으로 건너뛰지 않도록 각 Data 호출 자체의 timeout만 적용한다.
            Deadline finalization = Deadline.unbounded();
            boolean blocked = false;
            if (delivery.blockRequested()) {
                try {
                    blocks.block(claims, delivery.authorId(), finalization);
                    blocked = true;
                } catch (PublicApiException e) {
                    if (e.getErrorCode() != ApiErrorCode.NOT_FOUND) {
                        throw e;
                    }
                    // 메일 접수 뒤 상대가 탈퇴한 경우에도 intent를 끝낸다. 존재하지 않는 계정은 차단할 수 없다.
                }
            }
            ReportDeliveryView completed = deliveries.complete(
                    claims.userId(), requestId, leaseToken, blocked, finalization);
            return new ReportReceipt(completed.caseId(), Boolean.TRUE.equals(completed.blocked()));
        } catch (ReportMailException e) {
            // SMTP 성공 뒤 IMAP 반영만 늦은 실패일 수 있다. lease를 유지해야 즉시 재발송되지 않고,
            // 만료 뒤 같은 confirmation token으로 메일함을 먼저 확인한 다음에만 재시도한다.
            if (!e.deliveryMayHaveOccurred()) {
                release(claims.userId(), requestId, leaseToken);
            }
            throw new PublicApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null);
        } catch (RuntimeException e) {
            release(claims.userId(), requestId, leaseToken);
            throw e;
        }
    }

    private void release(UUID reporterId, UUID requestId, UUID leaseToken) {
        if (leaseToken == null) {
            return;
        }
        try {
            deliveries.release(reporterId, requestId, leaseToken, Deadline.unbounded());
        } catch (RuntimeException ignored) {
            // lease는 유한 시간 뒤 만료된다. 원래 실패를 release 최선 노력의 실패로 덮지 않는다.
        }
    }

    private Evidence evidence(UUID reporterId, ReportTargetType type, UUID targetId, Deadline deadline) {
        if (type == ReportTargetType.USER) {
            List<FriendItem> friends = data.fetchFriends(reporterId, null, deadline);
            FriendItem friend = friends == null ? null : friends.stream()
                    .filter(item -> targetId.equals(item.userId()))
                    .findFirst().orElse(null);
            if (friend == null) {
                throw new PublicApiException(ApiErrorCode.NOT_FOUND, "targetId");
            }
            return new Evidence(friend.userId(), "nickname", friend.nickname() == null ? "탈퇴한 사용자" : friend.nickname(),
                    null);
        }
        try {
            LetterView letter = data.fetchLetter(reporterId, targetId, deadline);
            if (letter == null || !reporterId.equals(letter.receiverId()) || reporterId.equals(letter.senderId())) {
                throw new PublicApiException(ApiErrorCode.FORBIDDEN, "targetId");
            }
            return new Evidence(letter.senderId(), "content", letter.content(), letter.createdAt());
        } catch (UpstreamDomainException e) {
            if (e.getStatus() == 404 && "LETTER_NOT_FOUND".equals(e.getCode())) {
                throw new PublicApiException(ApiErrorCode.NOT_FOUND, "targetId");
            }
            if (e.getStatus() == 403 && "NOT_LETTER_PARTICIPANT".equals(e.getCode())) {
                throw new PublicApiException(ApiErrorCode.FORBIDDEN, "targetId");
            }
            throw e;
        }
    }

    private static String body(String caseId, UUID requestId, UUID reporterId, ReportTargetType targetType,
            UUID targetId, Evidence evidence, ReportReason reason, String description, String replyEmail) {
        String safeOriginal = defang(evidence.original());
        String safeDescription = defang(description == null ? "" : description);
        return "caseId: " + caseId + "\n"
                + "requestId: " + requestId + "\n"
                + "reporterId: " + reporterId + "\n"
                + "targetType: " + targetType + "\n"
                + "targetId: " + targetId + "\n"
                + "field: " + evidence.field() + "\n"
                + "authorId: " + evidence.authorId() + "\n"
                + "createdAt: " + value(evidence.createdAt()) + "\n"
                + "reason: " + reason + "\n"
                + "replyEmailUnverified: " + value(replyEmail) + "\n"
                + "receivedAt: " + Instant.now() + "\n\n"
                + "[SERVER VERIFIED ORIGINAL - SAFE DISPLAY]\n" + safeOriginal + "\n\n"
                + "[SERVER VERIFIED ORIGINAL - BASE64 UTF-8]\n" + base64(evidence.original()) + "\n\n"
                + "[USER DESCRIPTION - SAFE DISPLAY]\n" + safeDescription + "\n\n"
                + "[USER DESCRIPTION - BASE64 UTF-8]\n" + base64(description == null ? "" : description) + "\n";
    }

    private static String defang(String value) {
        // 한 줄로 고정해 비신뢰 원문이 운영 메일의 섹션 경계를 주입하지 못하게 한 뒤 링크도 끊는다.
        return value.replace("\\", "\\\\")
                .replace("\r", "\\r")
                .replace("\n", "\\n")
                .replace("[", "\\[")
                .replace("]", "\\]")
                .replace(":", "[:]")
                .replace(".", "[.]")
                .replace("@", "[@]");
    }

    private static String base64(String value) {
        return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String value(String value) {
        return value == null || value.isBlank() ? "(none)" : value;
    }

    private static String caseId(UUID reporterId, UUID requestId) {
        return "GR-" + sha256(reporterId + ":" + requestId).substring(0, 20).toUpperCase();
    }

    private static String fingerprint(ReportTargetType targetType, UUID targetId, ReportReason reason,
            String description, String replyEmail, boolean blockUser) {
        return sha256(part(targetType.name()) + part(targetId.toString()) + part(reason.name())
                + part(description) + part(replyEmail) + part(Boolean.toString(blockUser)));
    }

    private static String part(String value) {
        return value == null ? "-1:" : value.length() + ":" + value;
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required", e);
        }
    }

    private record Evidence(UUID authorId, String field, String original, String createdAt) {
    }

    public enum ReportTargetType { USER, LETTER }

    public enum ReportReason {
        HARASSMENT, HATE, SPAM_FRAUD, SEXUAL, CHILD_SAFETY, THREAT, PRIVACY_IMPERSONATION, OTHER
    }

    public record ReportReceipt(
            @JsonProperty(required = true) String caseId,
            @JsonProperty(required = true) boolean blocked) {
    }
}
