package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.appearance.dto.CustomizationCatalogItem;
import com.oneorthree.phone.appearance.repository.OwnedProductRepository;
import com.oneorthree.phone.appearance.repository.domain.CatalogAsset;
import com.oneorthree.phone.appearance.service.AppearanceEvents;
import com.oneorthree.phone.appearance.service.CustomizationCatalogService;
import com.oneorthree.phone.common.id.UuidV7;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 꾸미기 지급: 미리 계산(저장 없음) → 승인 → 다른 운영자의 실행. 집중 정책 승인·발행({@link FocusPolicyAdminService})과
 * 같은 멱등 규칙을 따르되, 발행 대신 사용자 수만큼 보유 행을 넣는 실행이 200명 단위 트랜잭션으로 나뉜다.
 *
 * <p>닉네임은 어디에도 저장하지 않는다 — 탈퇴하면 닉네임이 지워져야 하므로 승인에는 사용자 UUID 스냅샷만 남긴다.
 * 실행은 사용자 UUID 오름차순 커서로 진행하고, 요청 하나가 약 {@code budget-millis} 만 처리한 뒤 RUNNING 으로 돌려준다.
 * 호출자는 같은 grantId 로 다시 불러 이어 간다.
 *
 * <p>잠금 순서: 실행 행 → 사용자(공유) → 보유 행 삽입 → 인벤토리 사건. 탈퇴 트랜잭션은 사용자 배타 잠금 뒤에
 * 보유 행을 지우므로, 공유 잠금 없이 넣으면 탈퇴한 사람에게 보유 행이 남을 수 있다
 * ({@code CustomizationRewardService}, {@code OwnedProductRepository} 주석과 같은 규칙).
 */
@Service
@RequiredArgsConstructor
public class CustomizationGrantAdminService {

    private static final String LOCK = "backoffice:customization-grant";
    private static final String MODE_USERS = "USERS";
    private static final String MODE_ALL = "ALL";
    private static final int MAX_NICKNAMES = 500;
    private static final int CHUNK_SIZE = 200;
    private static final int MAX_REASON = 200;
    private static final Pattern UUID_TEXT = Pattern.compile(
            "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    private static final String EXECUTION_SELECT = "SELECT e.grant_id,e.approval_id,a.product_id,a.mode,a.reason,"
            + "e.status,e.target_count,e.granted_count,e.already_owned_count,e.skipped_count,e.approved_by,"
            + "e.actor,e.started_at,e.completed_at FROM customization_grant_executions e"
            + " JOIN customization_grant_approvals a ON a.approval_id=e.approval_id";

    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final UserQueryService userQueryService;
    private final OwnedProductRepository ownedProducts;
    private final AppearanceEvents appearanceEvents;
    private final CustomizationCatalogService catalog;
    private final PlatformTransactionManager transactionManager;
    private final Clock clock;

    /** 한 요청이 chunk 를 이어 도는 시간 예산. 적어도 chunk 하나는 처리하므로 0 이어도 진행은 멈추지 않는다. */
    @Value("${internal.customization-grant.budget-millis:8000}")
    private long budgetMillis = 8000;

    // ---------------------------------------------------------------- 미리 계산

    @Transactional(readOnly = true)
    public Preview preview(PreviewRequest request) {
        if (request == null) {
            throw badRequest("요청 본문이 필요합니다.");
        }
        String reason = validReason(request.reason());
        CustomizationCatalogItem item = grantable(request.productId());
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        List<String> nicknames = request.nicknames() == null ? List.of() : request.nicknames();
        if (MODE_ALL.equals(request.mode())) {
            if (!nicknames.isEmpty()) {
                throw badRequest("전체 지급에는 닉네임을 넣을 수 없습니다.");
            }
            int target = count("SELECT count(*) FROM users WHERE is_deleted=false"
                    + " AND (created_at IS NULL OR created_at <= ?)", Timestamp.from(now));
            int owned = count("SELECT count(*) FROM owned_products o JOIN users u ON u.id=o.user_id"
                    + " WHERE o.owner_type='user' AND o.product_id=? AND u.is_deleted=false"
                    + " AND (u.created_at IS NULL OR u.created_at <= ?)", item.productId(), Timestamp.from(now));
            return new Preview(item.productId(), item.title(), MODE_ALL, reason, List.of(), List.of(), target, owned,
                    target - owned, digest(item.productId(), MODE_ALL, List.of(), reason));
        }
        if (!MODE_USERS.equals(request.mode())) {
            throw badRequest("지급 대상 방식을 확인해 주세요.");
        }
        if (nicknames.isEmpty() || nicknames.size() > MAX_NICKNAMES) {
            throw badRequest("닉네임은 1개 이상 500개 이하로 넣어 주세요.");
        }
        Set<String> seen = new HashSet<>();
        List<Target> targets = new ArrayList<>();
        List<String> unknown = new ArrayList<>();
        for (String raw : nicknames) {
            String nickname = raw == null ? "" : raw.strip();
            if (nickname.isEmpty()) {
                throw badRequest("빈 닉네임이 있습니다.");
            }
            if (!seen.add(nickname.toLowerCase(Locale.ROOT))) {
                throw badRequest("대소문자를 무시하면 같은 닉네임이 중복되어 있습니다.");
            }
            User found = users.findActiveByNicknameIgnoreCase(nickname).orElse(null);
            if (found == null) {
                unknown.add(raw);
            } else {
                targets.add(new Target(found.getNickname(), found.getId()));
            }
        }
        List<String> ids = targets.stream().map(t -> t.userId().toString()).sorted().toList();
        int owned = ids.isEmpty() ? 0 : count("SELECT count(*) FROM owned_products WHERE owner_type='user'"
                + " AND product_id=? AND user_id IN (" + placeholders(ids.size()) + ")",
                withProduct(item.productId(), ids));
        String digest = unknown.isEmpty() ? digest(item.productId(), MODE_USERS, ids, reason) : null;
        return new Preview(item.productId(), item.title(), MODE_USERS, reason, targets, unknown, targets.size(), owned,
                targets.size() - owned, digest);
    }

    // ---------------------------------------------------------------- 승인·취소

    @Transactional
    public Approval approve(UUID approvalId, ApproveRequest request, String actor) {
        if (approvalId == null || request == null || !validActor(actor)) {
            throw badRequest("요청 본문이 필요합니다.");
        }
        String reason = validReason(request.reason());
        CustomizationCatalogItem item = grantable(request.productId());
        List<String> ids = snapshotIds(request);
        String digest = digest(item.productId(), request.mode(), ids, reason);
        if (!digest.equals(request.digest())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "승인 요청의 지문이 다릅니다.");
        }
        String requestDigest = sha256(digest + ":" + actor);
        lock();
        List<StoredApproval> existing = jdbc.query("SELECT approval_id,product_id,mode,user_ids::text,reason,digest,"
                        + "approved_by,approved_at,request_digest,revoked_at FROM customization_grant_approvals"
                        + " WHERE approval_id=?",
                (rs, index) -> new StoredApproval(new Approval(rs.getObject("approval_id", UUID.class),
                        rs.getString("product_id"), rs.getString("mode"), uuidsOf(rs.getString(4)),
                        rs.getString("reason"), rs.getString("digest").trim(), rs.getString("approved_by"),
                        rs.getTimestamp("approved_at").toInstant()), rs.getString("request_digest").trim(),
                        rs.getTimestamp("revoked_at") != null), approvalId);
        if (!existing.isEmpty()) {
            StoredApproval approval = existing.get(0);
            if (approval.revoked()) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "취소된 승인입니다.");
            }
            if (!requestDigest.equals(approval.requestDigest())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "승인 ID가 다른 요청에 사용되었습니다.");
            }
            return approval.result();
        }
        if (MODE_USERS.equals(request.mode())) {
            int active = count("SELECT count(*) FROM users WHERE is_deleted=false AND id IN ("
                    + placeholders(ids.size()) + ")", ids.stream().map(UUID::fromString).toArray());
            if (active != ids.size()) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "대상이 바뀌었습니다. 다시 미리 계산해 주세요.");
            }
        }
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        jdbc.update("INSERT INTO customization_grant_approvals(approval_id,product_id,mode,user_ids,reason,digest,"
                        + "request_digest,approved_by,approved_at) VALUES(?,?,?,?::jsonb,?,?,?,?,?)",
                approvalId, item.productId(), request.mode(), jsonArray(ids), reason, digest, requestDigest, actor,
                Timestamp.from(now));
        return new Approval(approvalId, item.productId(), request.mode(),
                ids.stream().map(UUID::fromString).toList(), reason, digest, actor, now);
    }

    /** 삭제 대신 누가 언제 취소했는지 남긴다. 이미 실행에 쓴 승인은 취소할 수 없다. */
    @Transactional
    public void revoke(UUID approvalId, String actor) {
        if (approvalId == null || !validActor(actor)) {
            throw badRequest("요청 본문이 필요합니다.");
        }
        lock();
        List<Boolean> revoked = jdbc.query("SELECT revoked_at IS NOT NULL FROM customization_grant_approvals"
                + " WHERE approval_id=?", (rs, index) -> rs.getBoolean(1), approvalId);
        if (revoked.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "승인 기록을 찾을 수 없습니다.");
        }
        if (count("SELECT count(*) FROM customization_grant_executions WHERE approval_id=?", approvalId) > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 실행에 사용한 승인입니다.");
        }
        if (!revoked.get(0)) {
            jdbc.update("UPDATE customization_grant_approvals SET revoked_at=?,revoked_by=?"
                    + " WHERE approval_id=? AND revoked_at IS NULL", Timestamp.from(clock.instant()), actor,
                    approvalId);
        }
    }

    // ---------------------------------------------------------------- 실행

    /** 첫 호출은 실행 행을 만들고, 이후 호출은 같은 요청이면 이어서 처리한다. 트랜잭션은 이 메서드 안에서 나눈다. */
    public Execution execute(UUID grantId, ExecuteRequest request, String actor) {
        if (grantId == null || request == null || request.approvalId() == null || request.digest() == null
                || !validActor(actor)) {
            throw badRequest("요청 본문이 필요합니다.");
        }
        String requestDigest = sha256(request.approvalId() + ":" + request.digest() + ":" + actor);
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.executeWithoutResult(status -> begin(grantId, request, actor, requestDigest));
        Instant deadline = clock.instant().plusMillis(budgetMillis);
        while (true) {
            Boolean done = transaction.execute(status -> runChunk(grantId));
            if (Boolean.TRUE.equals(done) || !clock.instant().isBefore(deadline)) {
                break;
            }
        }
        return execution(grantId);
    }

    /** 실행 행 생성(또는 같은 요청의 재호출 확인). advisory lock 으로 같은 승인·같은 grantId 의 경합을 줄 세운다. */
    private void begin(UUID grantId, ExecuteRequest request, String actor, String requestDigest) {
        lock();
        List<String> existing = jdbc.query("SELECT request_digest FROM customization_grant_executions"
                + " WHERE grant_id=?", (rs, index) -> rs.getString(1).trim(), grantId);
        if (!existing.isEmpty()) {
            if (!requestDigest.equals(existing.get(0))) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "실행 ID가 다른 요청에 사용되었습니다.");
            }
            return;
        }
        List<ApprovalRow> approvals = jdbc.query("SELECT mode,digest,approved_by,revoked_at IS NULL FROM"
                        + " customization_grant_approvals WHERE approval_id=?",
                (rs, index) -> new ApprovalRow(rs.getString(1), rs.getString(2).trim(), rs.getString(3),
                        rs.getBoolean(4)), request.approvalId());
        if (approvals.size() != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "승인 기록을 찾을 수 없습니다.");
        }
        ApprovalRow approval = approvals.get(0);
        if (!approval.active() || !approval.digest().equals(request.digest()) || approval.approvedBy().equals(actor)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "승인 기록과 실행 요청이 일치하지 않습니다.");
        }
        if (count("SELECT count(*) FROM customization_grant_executions WHERE approval_id=?",
                request.approvalId()) > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 실행에 사용한 승인입니다.");
        }
        Instant startedAt = clock.instant().truncatedTo(ChronoUnit.MICROS);
        int target = MODE_ALL.equals(approval.mode())
                ? count("SELECT count(*) FROM users WHERE is_deleted=false AND (created_at IS NULL OR created_at <= ?)",
                Timestamp.from(startedAt))
                : snapshotUsers(request.approvalId()).size();
        jdbc.update("INSERT INTO customization_grant_executions(grant_id,approval_id,request_digest,approved_by,actor,"
                        + "status,target_count,started_at) VALUES(?,?,?,?,?,'RUNNING',?,?)",
                grantId, request.approvalId(), requestDigest, approval.approvedBy(), actor, target,
                Timestamp.from(startedAt));
    }

    /** 최대 200명을 한 트랜잭션으로 처리한다. 끝났으면 true. 이 트랜잭션이 실행 행을 쥐어 같은 grantId 의 동시 호출을 줄 세운다. */
    private boolean runChunk(UUID grantId) {
        RunRow run = jdbc.queryForObject("SELECT e.status,e.cursor_user_id,e.started_at,a.product_id,a.mode,"
                + "a.approval_id FROM customization_grant_executions e JOIN customization_grant_approvals a"
                + " ON a.approval_id=e.approval_id WHERE e.grant_id=? FOR UPDATE OF e",
                (rs, index) -> new RunRow(rs.getString(1), rs.getObject(2, UUID.class),
                        rs.getTimestamp(3), rs.getString(4), rs.getString(5), rs.getObject(6, UUID.class)), grantId);
        if (run == null || "COMPLETED".equals(run.status())) {
            return true;
        }
        List<UUID> batch = nextBatch(run);
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        int granted = 0;
        int already = 0;
        int skipped = 0;
        for (UUID userId : batch) {
            if (userQueryService.findActiveForShare(userId).isEmpty()) {
                skipped++;
                continue;
            }
            int inserted = ownedProducts.insertUserProductIfAbsent(UuidV7.next(), userId, run.productId(),
                    "admin-grant:" + grantId, now);
            if (inserted == 1) {
                granted++;
                appearanceEvents.inventoryChanged(CatalogAsset.OWNER_USER, userId, userId, run.productId());
            } else {
                already++;
            }
        }
        boolean done = batch.size() < CHUNK_SIZE;
        UUID cursor = batch.isEmpty() ? run.cursor() : batch.get(batch.size() - 1);
        jdbc.update("UPDATE customization_grant_executions SET cursor_user_id=?,granted_count=granted_count+?,"
                        + "already_owned_count=already_owned_count+?,skipped_count=skipped_count+?,"
                        + "status=?,completed_at=? WHERE grant_id=?", cursor, granted, already, skipped,
                done ? "COMPLETED" : "RUNNING", done ? Timestamp.from(now) : null, grantId);
        return done;
    }

    private List<UUID> nextBatch(RunRow run) {
        if (MODE_ALL.equals(run.mode())) {
            // started_at 으로 대상을 고정한다 — 실행 도중 가입한 사용자는 받지 않는다.
            String sql = "SELECT id FROM users WHERE is_deleted=false AND (created_at IS NULL OR created_at <= ?)"
                    + (run.cursor() == null ? "" : " AND id > ?") + " ORDER BY id LIMIT " + CHUNK_SIZE;
            return run.cursor() == null
                    ? jdbc.queryForList(sql, UUID.class, run.startedAt())
                    : jdbc.queryForList(sql, UUID.class, run.startedAt(), run.cursor());
        }
        // 문자열 순서(소문자 hex)는 PostgreSQL uuid 순서와 같다. Java UUID.compareTo 는 부호 있는 비교라 쓰지 않는다.
        String after = run.cursor() == null ? "" : run.cursor().toString();
        return snapshotUsers(run.approvalId()).stream().filter(id -> id.toString().compareTo(after) > 0)
                .limit(CHUNK_SIZE).toList();
    }

    @Transactional(readOnly = true)
    public List<Execution> recent(int limit) {
        if (limit < 1 || limit > 100) {
            throw badRequest("limit 은 1~100 이어야 합니다.");
        }
        return jdbc.query(EXECUTION_SELECT + " ORDER BY e.started_at DESC, e.grant_id LIMIT ?",
                (rs, index) -> mapExecution(rs), limit);
    }

    private Execution execution(UUID grantId) {
        return jdbc.queryForObject(EXECUTION_SELECT + " WHERE e.grant_id=?", (rs, index) -> mapExecution(rs), grantId);
    }

    private static Execution mapExecution(java.sql.ResultSet rs) throws java.sql.SQLException {
        Timestamp completed = rs.getTimestamp("completed_at");
        return new Execution(rs.getObject("grant_id", UUID.class), rs.getObject("approval_id", UUID.class),
                rs.getString("product_id"), rs.getString("mode"), rs.getString("reason"), rs.getString("status"),
                rs.getInt("target_count"), rs.getInt("granted_count"), rs.getInt("already_owned_count"),
                rs.getInt("skipped_count"), rs.getString("approved_by"), rs.getString("actor"),
                rs.getTimestamp("started_at").toInstant(), completed == null ? null : completed.toInstant());
    }

    // ---------------------------------------------------------------- 공통

    private List<UUID> snapshotUsers(UUID approvalId) {
        String text = jdbc.queryForObject("SELECT user_ids::text FROM customization_grant_approvals"
                + " WHERE approval_id=?", String.class, approvalId);
        return uuidsOf(text);
    }

    private static List<UUID> uuidsOf(String jsonArray) {
        List<UUID> ids = new ArrayList<>();
        Matcher matcher = UUID_TEXT.matcher(jsonArray);
        while (matcher.find()) {
            ids.add(UUID.fromString(matcher.group()));
        }
        return ids;
    }

    /** 승인 요청의 대상 스냅샷을 검증하고 UUID 오름차순 문자열로 만든다. ALL 이면 비어 있어야 한다. */
    private static List<String> snapshotIds(ApproveRequest request) {
        List<UUID> raw = request.userIds() == null ? List.of() : request.userIds();
        if (MODE_ALL.equals(request.mode())) {
            if (!raw.isEmpty()) {
                throw badRequest("전체 지급에는 사용자 목록을 넣을 수 없습니다.");
            }
            return List.of();
        }
        if (!MODE_USERS.equals(request.mode())) {
            throw badRequest("지급 대상 방식을 확인해 주세요.");
        }
        if (raw.isEmpty() || raw.size() > MAX_NICKNAMES || raw.contains(null)) {
            throw badRequest("대상은 1명 이상 500명 이하여야 합니다.");
        }
        List<String> ids = raw.stream().map(UUID::toString).sorted().toList();
        if (new HashSet<>(ids).size() != ids.size()) {
            throw badRequest("대상 사용자가 중복되어 있습니다.");
        }
        return ids;
    }

    private CustomizationCatalogItem grantable(String productId) {
        if (productId == null) {
            throw badRequest("상품을 확인해 주세요.");
        }
        return catalog.catalog().stream()
                .filter(i -> i.productId().equals(productId) && i.retiredAt() == null)
                .findFirst()
                .orElseThrow(() -> badRequest("지급할 수 없는 상품입니다."));
    }

    private static String validReason(String reason) {
        String stripped = reason == null ? "" : reason.strip();
        if (stripped.isEmpty() || stripped.length() > MAX_REASON) {
            throw badRequest("사유는 1~200자로 적어 주세요.");
        }
        for (int i = 0; i < stripped.length(); i++) {
            char c = stripped.charAt(i);
            if (c <= 0x1F || c == 0x7F) {
                throw badRequest("사유에 제어 문자를 넣을 수 없습니다.");
            }
        }
        return stripped;
    }

    /**
     * JS JSON.stringify 와 바이트 단위로 같은 정규 문자열. 키 순서는 고정이고, 사유의 제어 문자는 미리 막았으므로
     * 이스케이프는 {@code "} 와 {@code \} 둘뿐이다. Jackson 기본 설정에 기대지 않는다.
     */
    public static String canonical(String productId, String mode, List<String> sortedUserIds, String reason) {
        StringBuilder out = new StringBuilder("{\"productId\":").append(quote(productId))
                .append(",\"mode\":").append(quote(mode)).append(",\"userIds\":").append(jsonArray(sortedUserIds))
                .append(",\"reason\":").append(quote(reason)).append('}');
        return out.toString();
    }

    public static String digest(String productId, String mode, List<String> sortedUserIds, String reason) {
        return sha256(canonical(productId, mode, sortedUserIds, reason));
    }

    private static String jsonArray(List<String> values) {
        StringBuilder out = new StringBuilder("[");
        for (int i = 0; i < values.size(); i++) {
            out.append(i == 0 ? "" : ",").append(quote(values.get(i)));
        }
        return out.append(']').toString();
    }

    private static String quote(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private static String sha256(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(bytes);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private void lock() {
        jdbc.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", LOCK);
    }

    private int count(String sql, Object... args) {
        Integer value = jdbc.queryForObject(sql, Integer.class, args);
        return value == null ? 0 : value;
    }

    private static String placeholders(int n) {
        return String.join(",", java.util.Collections.nCopies(n, "?"));
    }

    private static Object[] withProduct(String productId, List<String> ids) {
        Object[] args = new Object[ids.size() + 1];
        args[0] = productId;
        for (int i = 0; i < ids.size(); i++) {
            args[i + 1] = UUID.fromString(ids.get(i));
        }
        return args;
    }

    private static boolean validActor(String actor) {
        return actor != null && actor.matches("member-[1-3]");
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    public record PreviewRequest(String productId, String mode, List<String> nicknames, String reason) { }

    public record Target(String nickname, UUID userId) { }

    public record Preview(String productId, String productTitle, String mode, String reason, List<Target> targets,
                          List<String> unknownNicknames, int targetCount, int alreadyOwnedCount, int newCount,
                          String digest) { }

    public record ApproveRequest(String productId, String mode, List<UUID> userIds, String reason, String digest) { }

    public record Approval(UUID approvalId, String productId, String mode, List<UUID> userIds, String reason,
                           String digest, String approvedBy, Instant approvedAt) { }

    public record ExecuteRequest(UUID approvalId, String digest) { }

    public record Execution(UUID grantId, UUID approvalId, String productId, String mode, String reason, String status,
                            int targetCount, int grantedCount, int alreadyOwnedCount, int skippedCount,
                            String approvedBy, String actor, Instant startedAt, Instant completedAt) { }

    private record StoredApproval(Approval result, String requestDigest, boolean revoked) { }

    private record ApprovalRow(String mode, String digest, String approvedBy, boolean active) { }

    private record RunRow(String status, UUID cursor, Timestamp startedAt, String productId, String mode,
                          UUID approvalId) { }
}
