package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.exception.RateLimitedException;
import com.oneorthree.phone.common.id.UuidV7;
import com.oneorthree.phone.internal.dto.ReportDeliveryClaimRequest;
import com.oneorthree.phone.internal.dto.ReportDeliveryPrepareRequest;
import com.oneorthree.phone.internal.dto.ReportDeliveryView;
import com.oneorthree.phone.internal.exception.ReportDeliveryErrorCode;
import com.oneorthree.phone.internal.exception.ReportDeliveryException;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * SMTP 외부 side effect의 영속 intent와 lease를 관리한다. DB 트랜잭션 중에는 메일을 보내지 않는다.
 * 같은 사용자·requestId는 한 행으로 수렴하고, lease token이 늦은 작업자의 완료를 막는다.
 */
@Service
public class InternalReportDeliveryService {

    static final Duration LEASE = Duration.ofMinutes(5);
    static final Duration SNAPSHOT_RETENTION = Duration.ofHours(23);
    private static final Duration RATE_WINDOW = Duration.ofHours(1);

    private final JdbcTemplate jdbc;
    private final UserQueryService users;
    private final Clock clock;
    private final int maxPerHour;

    public InternalReportDeliveryService(JdbcTemplate jdbc, UserQueryService users, Clock clock,
            @Value("${report.delivery.rate-limit.max-per-hour:10}") int maxPerHour) {
        if (maxPerHour <= 0) {
            throw new IllegalArgumentException("report.delivery.rate-limit.max-per-hour는 양수여야 합니다.");
        }
        this.jdbc = jdbc;
        this.users = users;
        this.clock = clock;
        this.maxPerHour = maxPerHour;
    }

    @Transactional
    public ReportDeliveryView claim(UUID reporterId, UUID requestId, ReportDeliveryClaimRequest request) {
        // claim과 prepare를 같은 순서(advisory → users → report_deliveries)로 직렬화한다.
        // 재선점 전에 author를 먼저 읽고 users 공유 잠금을 잡아, 탈퇴가 이미 users 배타 잠금을
        // 획득한 경우 그 커밋과 snapshot 정리가 끝난 뒤에만 report 행을 볼 수 있게 한다.
        lockIntent(reporterId);
        ReportRow observed = find(reporterId, requestId);
        boolean authorActive = observed == null || observed.authorId() == null
                ? lockReporter(reporterId)
                : lockClaimParticipants(reporterId, observed.authorId());
        Instant now = clock.instant();
        ReportRow row = findForUpdate(reporterId, requestId);
        if (row == null) {
            enforceRateLimit(reporterId, now);
            jdbc.update("insert into report_deliveries "
                            + "(id, reporter_id, request_id, case_id, confirmation_token, request_fingerprint, "
                            + "block_requested, status, created_at, updated_at) "
                            + "values (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)",
                    UuidV7.next(), reporterId, requestId, request.caseId(), UuidV7.next(), request.fingerprint(),
                    request.blockRequested(), Timestamp.from(now), Timestamp.from(now));
            row = findForUpdate(reporterId, requestId);
        }
        if (!row.fingerprint().equals(request.fingerprint())
                || !row.caseId().equals(request.caseId())
                || row.blockRequested() != request.blockRequested()) {
            throw new ReportDeliveryException(ReportDeliveryErrorCode.IDEMPOTENCY_KEY_REUSED);
        }
        if (row.completed()) {
            return view(row);
        }
        if (row.expired()) {
            return view(row);
        }
        if (row.leaseExpiresAt() != null && row.leaseExpiresAt().isAfter(now)) {
            if (snapshotRetentionElapsed(row, now)) {
                // 이미 시작된 작업을 정리로 끊지는 않지만, 보존 기한 뒤 응답 재생으로 새 외부 작업을
                // 시작하게 하지도 않는다. lease 만료 뒤 종결 상태로 수렴한다.
                throw new ReportDeliveryException(ReportDeliveryErrorCode.REQUEST_IN_PROGRESS);
            }
            if (request.claimToken().equals(row.leaseToken())) {
                // 동일 내부 HTTP 명령의 응답만 유실된 경우 같은 lease 영수증을 재생한다.
                return view(row);
            }
            throw new ReportDeliveryException(ReportDeliveryErrorCode.REQUEST_IN_PROGRESS);
        }
        if (snapshotRetentionElapsed(row, now)) {
            return terminateForRetention(row, now, reporterId, requestId);
        }
        if (row.authorId() != null && (observed == null || !row.authorId().equals(observed.authorId()))) {
            // prepare도 advisory lock을 사용하므로 정상 경로에서는 author가 바뀔 수 없다. 잠기지 않은
            // author를 report 잠금 뒤 뒤늦게 신뢰하지 않고 안전하게 중단한다.
            throw new ReportDeliveryException(ReportDeliveryErrorCode.STATE_CONFLICT);
        }
        if ("PENDING".equals(row.status()) && row.authorId() != null && !authorActive) {
            // SMTP 성공 뒤 email-confirmed 기록만 유실됐을 수 있다. PII snapshot은 즉시 지우되
            // confirmation token 확인 전에는 미접수로 단정하지 않는다.
            jdbc.update("update report_deliveries set status='CONFIRM_ONLY', author_id=null, mail_subject=null, "
                            + "mail_body=null, snapshot_stored_at=null, lease_token=null, lease_expires_at=null, "
                            + "updated_at=? where id=?",
                    Timestamp.from(now), row.id());
            row = Objects.requireNonNull(findForUpdate(reporterId, requestId));
        }
        jdbc.update("update report_deliveries set lease_token=?, lease_expires_at=?, updated_at=? where id=?",
                request.claimToken(), Timestamp.from(now.plus(LEASE)), Timestamp.from(now), row.id());
        return view(Objects.requireNonNull(findForUpdate(reporterId, requestId)));
    }

    @Transactional
    public ReportDeliveryView prepare(UUID reporterId, UUID requestId, ReportDeliveryPrepareRequest request) {
        lockIntent(reporterId);
        lockActiveParticipants(reporterId, request.authorId());
        ReportRow row = ownedPending(reporterId, requestId, request.leaseToken());
        if (!"PENDING".equals(row.status())) {
            throw new ReportDeliveryException(ReportDeliveryErrorCode.STATE_CONFLICT);
        }
        if (row.authorId() == null) {
            Instant now = clock.instant();
            jdbc.update("update report_deliveries set author_id=?, mail_subject=?, mail_body=?, "
                            + "snapshot_stored_at=?, updated_at=? where id=?",
                    request.authorId(), request.subject(), request.body(), Timestamp.from(now),
                    Timestamp.from(now), row.id());
        } else if (!row.authorId().equals(request.authorId())
                || !row.subject().equals(request.subject()) || !row.body().equals(request.body())) {
            throw new ReportDeliveryException(ReportDeliveryErrorCode.STATE_CONFLICT);
        }
        return view(Objects.requireNonNull(findForUpdate(reporterId, requestId)));
    }

    @Transactional
    public ReportDeliveryView renew(UUID reporterId, UUID requestId, UUID leaseToken) {
        ReportRow row = ownedPending(reporterId, requestId, leaseToken);
        Instant now = clock.instant();
        if (snapshotRetentionElapsed(row, now)) {
            throw new ReportDeliveryException(ReportDeliveryErrorCode.STATE_CONFLICT);
        }
        jdbc.update("update report_deliveries set lease_expires_at=?, updated_at=? where id=?",
                Timestamp.from(now.plus(LEASE)), Timestamp.from(now), row.id());
        return view(Objects.requireNonNull(findForUpdate(reporterId, requestId)));
    }

    @Transactional
    public ReportDeliveryView emailConfirmed(UUID reporterId, UUID requestId, UUID leaseToken) {
        ReportRow row = ownedPending(reporterId, requestId, leaseToken);
        if ("EMAIL_CONFIRMED".equals(row.status())) {
            return view(row);
        }
        if (!"PENDING".equals(row.status()) || row.authorId() == null) {
            throw new ReportDeliveryException(ReportDeliveryErrorCode.STATE_CONFLICT);
        }
        Instant now = clock.instant();
        jdbc.update("update report_deliveries set status='EMAIL_CONFIRMED', mail_subject=null, mail_body=null, "
                        + "updated_at=? where id=?",
                Timestamp.from(now), row.id());
        return view(Objects.requireNonNull(findForUpdate(reporterId, requestId)));
    }

    @Transactional
    public ReportDeliveryView expire(UUID reporterId, UUID requestId, UUID leaseToken) {
        ReportRow row = ownedPending(reporterId, requestId, leaseToken);
        if (!"CONFIRM_ONLY".equals(row.status())) {
            throw new ReportDeliveryException(ReportDeliveryErrorCode.STATE_CONFLICT);
        }
        Instant now = clock.instant();
        jdbc.update("update report_deliveries set status='EXPIRED', lease_token=null, lease_expires_at=null, "
                + "updated_at=? where id=?", Timestamp.from(now), row.id());
        return view(Objects.requireNonNull(findForUpdate(reporterId, requestId)));
    }

    @Transactional
    public ReportDeliveryView complete(UUID reporterId, UUID requestId, UUID leaseToken, boolean blocked) {
        ReportRow row = findForUpdate(reporterId, requestId);
        if (row == null) {
            throw new ReportDeliveryException(ReportDeliveryErrorCode.NOT_FOUND);
        }
        if (row.completed()) {
            return view(row);
        }
        requireLease(row, leaseToken);
        boolean normal = "EMAIL_CONFIRMED".equals(row.status()) && row.authorId() != null;
        boolean confirmationOnly = "CONFIRM_ONLY".equals(row.status()) && !blocked;
        if (!(normal || confirmationOnly) || blocked && !row.blockRequested()) {
            throw new ReportDeliveryException(ReportDeliveryErrorCode.STATE_CONFLICT);
        }
        Instant now = clock.instant();
        jdbc.update("update report_deliveries set status='COMPLETED', blocked=?, completed_at=?, updated_at=?, "
                        + "lease_token=null, lease_expires_at=null, author_id=null, mail_subject=null, mail_body=null, "
                        + "snapshot_stored_at=null where id=?",
                blocked, Timestamp.from(now), Timestamp.from(now), row.id());
        return view(Objects.requireNonNull(findForUpdate(reporterId, requestId)));
    }

    @Transactional
    public void release(UUID reporterId, UUID requestId, UUID leaseToken) {
        // 완료 응답 유실 뒤 release가 와도 완료 영수증은 건드리지 않는다. 토큰 조건이 새 작업자의 lease도 보호한다.
        jdbc.update("update report_deliveries set lease_token=null, lease_expires_at=null, updated_at=? "
                        + "where reporter_id=? and request_id=? "
                        + "and status in ('PENDING', 'EMAIL_CONFIRMED', 'CONFIRM_ONLY') "
                        + "and lease_token=?",
                Timestamp.from(clock.instant()), reporterId, requestId, leaseToken);
    }

    private ReportRow ownedPending(UUID reporterId, UUID requestId, UUID token) {
        ReportRow row = findForUpdate(reporterId, requestId);
        if (row == null) {
            throw new ReportDeliveryException(ReportDeliveryErrorCode.NOT_FOUND);
        }
        if (row.completed() || row.expired()) {
            throw new ReportDeliveryException(ReportDeliveryErrorCode.STATE_CONFLICT);
        }
        requireLease(row, token);
        return row;
    }

    private void requireLease(ReportRow row, UUID token) {
        Instant now = clock.instant();
        if (!token.equals(row.leaseToken()) || row.leaseExpiresAt() == null || !row.leaseExpiresAt().isAfter(now)) {
            throw new ReportDeliveryException(ReportDeliveryErrorCode.REQUEST_IN_PROGRESS);
        }
    }

    private boolean snapshotRetentionElapsed(ReportRow row, Instant now) {
        return row.snapshotStoredAt() != null
                && !row.snapshotStoredAt().isAfter(now.minus(SNAPSHOT_RETENTION));
    }

    private ReportDeliveryView terminateForRetention(ReportRow row, Instant now,
            UUID reporterId, UUID requestId) {
        if ("PENDING".equals(row.status())) {
            jdbc.update("update report_deliveries set status='EXPIRED', author_id=null, mail_subject=null, "
                            + "mail_body=null, snapshot_stored_at=null, lease_token=null, lease_expires_at=null, "
                            + "updated_at=? where id=?",
                    Timestamp.from(now), row.id());
        } else if ("EMAIL_CONFIRMED".equals(row.status())) {
            jdbc.update("update report_deliveries set status='COMPLETED', blocked=false, completed_at=?, "
                            + "author_id=null, mail_subject=null, mail_body=null, snapshot_stored_at=null, "
                            + "lease_token=null, lease_expires_at=null, updated_at=? where id=?",
                    Timestamp.from(now), Timestamp.from(now), row.id());
        }
        return view(Objects.requireNonNull(findForUpdate(reporterId, requestId)));
    }

    private void enforceRateLimit(UUID reporterId, Instant now) {
        Instant since = now.minus(RATE_WINDOW);
        List<Instant> attempts = jdbc.query("select created_at from report_deliveries "
                        + "where reporter_id=? and created_at>? order by created_at asc",
                (rs, rowNum) -> rs.getTimestamp(1).toInstant(), reporterId, Timestamp.from(since));
        if (attempts.size() >= maxPerHour) {
            long retryAfter = Duration.between(now, attempts.get(0).plus(RATE_WINDOW)).toMillis();
            throw new RateLimitedException(Math.max(1, retryAfter));
        }
    }

    private void lockIntent(UUID reporterId) {
        // 사용자별 신규 intent 생성, 시간 한도 판정, snapshot author 확정을 함께 직렬화한다.
        jdbc.query("select pg_advisory_xact_lock(hashtextextended(?, 0))", rs -> null,
                "report-delivery:" + reporterId);
    }

    private boolean lockReporter(UUID reporterId) {
        users.getCallerForShare(reporterId);
        return true;
    }

    private boolean lockClaimParticipants(UUID reporterId, UUID authorId) {
        if (reporterId.equals(authorId)) {
            users.getCallerForShare(reporterId);
            return true;
        }
        if (reporterId.compareTo(authorId) < 0) {
            users.getCallerForShare(reporterId);
            return users.findActiveForShare(authorId).isPresent();
        }
        boolean authorActive = users.findActiveForShare(authorId).isPresent();
        users.getCallerForShare(reporterId);
        return authorActive;
    }

    private void lockActiveParticipants(UUID reporterId, UUID authorId) {
        // 탈퇴는 user → report_deliveries 순서다. 같은 순서로 공유 잠금을 잡아 snapshot 저장 뒤 탈퇴가
        // 끼어들 수 없게 하고, 서로를 신고하는 두 요청도 UUID 순서로 잠가 교착을 막는다.
        if (reporterId.equals(authorId)) {
            users.getCallerForShare(reporterId);
        } else if (reporterId.compareTo(authorId) < 0) {
            users.getCallerForShare(reporterId);
            users.getTargetForShare(authorId);
        } else {
            users.getTargetForShare(authorId);
            users.getCallerForShare(reporterId);
        }
    }

    private ReportRow findForUpdate(UUID reporterId, UUID requestId) {
        return find(reporterId, requestId, " for update");
    }

    private ReportRow find(UUID reporterId, UUID requestId) {
        return find(reporterId, requestId, "");
    }

    private ReportRow find(UUID reporterId, UUID requestId, String lockClause) {
        List<ReportRow> rows = jdbc.query("select id, case_id, confirmation_token, request_fingerprint, "
                        + "block_requested, author_id, "
                        + "mail_subject, mail_body, snapshot_stored_at, status, lease_token, lease_expires_at, blocked "
                        + "from report_deliveries where reporter_id=? and request_id=?" + lockClause,
                InternalReportDeliveryService::row, reporterId, requestId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private static ReportRow row(ResultSet rs, int rowNum) throws SQLException {
        Timestamp expires = rs.getTimestamp("lease_expires_at");
        Timestamp snapshotStored = rs.getTimestamp("snapshot_stored_at");
        return new ReportRow(
                rs.getObject("id", UUID.class), rs.getString("case_id"),
                rs.getObject("confirmation_token", UUID.class),
                rs.getString("request_fingerprint"), rs.getBoolean("block_requested"),
                rs.getObject("author_id", UUID.class), rs.getString("mail_subject"), rs.getString("mail_body"),
                rs.getString("status"), rs.getObject("lease_token", UUID.class),
                expires == null ? null : expires.toInstant(),
                snapshotStored == null ? null : snapshotStored.toInstant(), (Boolean) rs.getObject("blocked"));
    }

    private static ReportDeliveryView view(ReportRow row) {
        return new ReportDeliveryView(row.status(), row.caseId(), row.confirmationToken(),
                row.leaseToken(), row.authorId(), row.subject(), row.body(), row.blockRequested(), row.blocked());
    }

    private record ReportRow(UUID id, String caseId, UUID confirmationToken, String fingerprint, boolean blockRequested,
                             UUID authorId, String subject, String body, String status, UUID leaseToken,
                             Instant leaseExpiresAt, Instant snapshotStoredAt, Boolean blocked) {
        boolean completed() {
            return "COMPLETED".equals(status);
        }

        boolean expired() {
            return "EXPIRED".equals(status);
        }
    }
}
