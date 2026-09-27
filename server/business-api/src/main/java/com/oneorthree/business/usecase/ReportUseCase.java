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
import com.oneorthree.business.upstream.data.dto.FriendItem;
import com.oneorthree.business.upstream.data.dto.LetterView;
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
    private final UserBlockUseCase blocks;
    private final ReportMailGateway mail;

    public ReportReceipt report(AccessTokenClaims claims, UUID requestId, ReportTargetType targetType,
            UUID targetId, ReportReason reason, String description, String replyEmail, boolean blockUser,
            Deadline deadline) {
        Evidence evidence = evidence(claims.userId(), targetType, targetId, deadline);
        String caseId = caseId(claims.userId(), requestId);
        ReportMailGateway.ReportMail message = new ReportMailGateway.ReportMail(
                caseId,
                requestId.toString(),
                "[GROMO 신고] " + caseId + " / " + targetType,
                body(caseId, requestId, claims.userId(), targetType, targetId, evidence, reason,
                        description, replyEmail));
        try {
            mail.deliverAndConfirm(message);
        } catch (ReportMailException e) {
            throw new PublicApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null);
        }
        if (blockUser) {
            blocks.block(claims, evidence.authorId(), deadline);
        }
        return new ReportReceipt(caseId, blockUser);
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
        return value.replace("https://", "hxxps[:]//").replace("http://", "hxxp[:]//");
    }

    private static String base64(String value) {
        return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String value(String value) {
        return value == null || value.isBlank() ? "(none)" : value;
    }

    private static String caseId(UUID reporterId, UUID requestId) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest((reporterId + ":" + requestId).getBytes(StandardCharsets.UTF_8));
            return "GR-" + HexFormat.of().formatHex(digest, 0, 10).toUpperCase();
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
