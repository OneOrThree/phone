package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.appearance.service.CustomizationCatalogService;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 꾸미기 아이템 현황과 추첨 풀 편성 (GROMO-2829): 풀을 바꾸면 새 revision 만 발행하고 전후 풀을 영구 보존한다.
 * 승인·취소·발행·멱등 규칙은 {@link FocusPolicyAdminService} 와 같다.
 *
 * <p>추첨은 «현재(가장 큰) revision 의 아이템 행 전부» 가 후보다. 그래서 풀 변경 = 새 revision 에 정책 행을 그대로
 * 복사하고, 풀에 든 상품마다 «그 상품이 들어 있는 가장 큰 revision 의 행» 을 복사하는 것이다. 기존 revision 은
 * focus_settlements 가 FK 로 가리키므로 고치거나 지우지 않는다.
 */
@Service
@RequiredArgsConstructor
public class CustomizationRewardPoolAdminService {

    private static final String POOL_LOCK = "backoffice:customization-reward-pool";
    // 저장소 JSON 은 Jackson 2 로 읽는다 — 컨텍스트의 Jackson 3 빈을 주입받지 않는다(CustomizationCatalogService 와 같은 이유).
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final TypeReference<List<String>> STRINGS = new TypeReference<>() { };
    private static final TypeReference<Map<String, Object>> OBJECT = new TypeReference<>() { };
    /** 추첨 대상 분류와 등급. 신발·뗏목은 추첨이 쓰지 않는다. */
    private static final List<String> POOL_CATEGORIES = List.of("head", "neck");
    private static final List<String> RARITIES = List.of("common", "uncommon", "rare", "legendary");
    // 정규 문자열이 JS JSON.stringify 와 바이트까지 같으려면 이스케이프할 문자가 없어야 한다 — 상품 id 모양만 받는다.
    private static final Pattern PRODUCT_ID = Pattern.compile("[A-Za-z0-9._-]{1,80}");
    private static final String POLICY_COLUMNS = "minimum_active_seconds,rare_unlock_seconds,legendary_unlock_seconds,"
            + "time_half_seconds,rare_max_bonus_ppm,legendary_max_bonus_ppm,rewards_per_eligible_session,"
            + "duplicates_allowed,location_weights,category_weights,source_workbook_sha256";
    private static final String PUBLICATION_SELECT = "SELECT p.publication_id,p.approval_id,p.revision,"
            + "p.previous_revision,p.before_product_ids::text,p.after_product_ids::text,p.actor,p.approved_by,"
            + "p.approved_digest,p.published_at FROM customization_reward_pool_publications p";

    private final JdbcTemplate jdbc;
    private final CustomizationCatalogService catalog;

    // ------------------------------------------------------------------ 조회

    /** 아이템 현황: 보상 행이 있는 상품과 정적 꾸미기 상품의 합집합. 한 트랜잭션 스냅샷에서 읽는다. */
    @Transactional(readOnly = true)
    public ItemsView items() {
        Policy current = currentPolicy();
        Set<String> displayable = new HashSet<>();
        catalog.catalog().forEach(item -> displayable.add(item.productId()));
        Map<String, Long> owners = new HashMap<>();
        jdbc.query("SELECT product_id,count(*) FROM owned_products WHERE owner_type='user' GROUP BY product_id",
                rs -> {
                    owners.put(rs.getString(1), rs.getLong(2));
                });

        // 상품마다 가장 큰 revision 행 — 카탈로그(findCatRewardRenders)와 같은 고르는 법이다.
        Map<String, Item> byProduct = new HashMap<>();
        jdbc.query("SELECT DISTINCT ON (r.product_id) r.product_id,c.title,c.kind,r.category,r.rarity,"
                        + "r.render_data #>> '{source,path}',r.sort_order FROM customization_reward_items r"
                        + " JOIN catalog_assets c ON c.product_id=r.product_id"
                        + " ORDER BY r.product_id,r.revision DESC", rs -> {
                    String id = rs.getString(1);
                    byProduct.put(id, new Item(id, rs.getString(2), rs.getString(3), rs.getString(4),
                            rs.getString(5), rs.getString(6), false, false, 0, rs.getInt(7), null));
                });
        jdbc.query("SELECT m.product_id,c.title,c.kind,m.image_path,m.sort_order,m.retired_at"
                        + " FROM customization_asset_meta m JOIN catalog_assets c ON c.product_id=m.product_id",
                rs -> {
                    String id = rs.getString(1);
                    Item reward = byProduct.get(id);
                    Timestamp retired = rs.getTimestamp(6);
                    // 정적 행이 있으면 그림·퇴역은 정적 쪽, 등급·분류는 보상 행 쪽이다.
                    byProduct.put(id, new Item(id, rs.getString(2), rs.getString(3),
                            reward == null ? null : reward.category(), reward == null ? null : reward.rarity(),
                            rs.getString(4), false, false, 0, rs.getInt(5),
                            retired == null ? null : retired.toInstant()));
                });

        Set<String> inPool = new HashSet<>();
        jdbc.query("SELECT product_id,category FROM customization_reward_items WHERE revision=?", rs -> {
            if (positive(current.categoryWeights().get(rs.getString(2)))) {
                inPool.add(rs.getString(1));
            }
        }, current.revision());

        List<Item> items = byProduct.values().stream()
                .map(item -> new Item(item.productId(), item.title(), item.kind(), item.category(), item.rarity(),
                        item.imagePath(), displayable.contains(item.productId()),
                        inPool.contains(item.productId()), owners.getOrDefault(item.productId(), 0L),
                        item.sortOrder(), item.retiredAt()))
                .sorted(Comparator.comparing(Item::kind).thenComparingInt(Item::sortOrder)
                        .thenComparing(Item::productId))
                .toList();
        return new ItemsView(new PoolSummary(current.revision(), current.categoryWeights(),
                productIdsAt(current.revision())), items);
    }

    @Transactional(readOnly = true)
    public View get() {
        Policy current = currentPolicy();
        Instant created = jdbc.queryForObject("SELECT created_at FROM customization_reward_policies WHERE revision=?",
                Timestamp.class, current.revision()).toInstant();
        List<Publication> history = jdbc.query(PUBLICATION_SELECT + " ORDER BY p.revision DESC",
                (rs, index) -> mapPublication(rs));
        Instant publishedAt = history.isEmpty() || history.get(0).revision() != current.revision()
                ? created : history.get(0).publishedAt();
        return new View(new Revision(current.revision(), productIdsAt(current.revision()), publishedAt), history);
    }

    // ------------------------------------------------------------------ 승인·취소·발행

    @Transactional
    public Approval approve(UUID approvalId, ApproveRequest request, String actor) {
        if (approvalId == null || request == null || !validActor(actor) || request.expectedRevision() < 0) {
            throw badRequest();
        }
        validateShape(request.productIds());
        String digest = sha256(canonical(request.productIds()));
        if (!digest.equals(request.approvedDigest())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "승인 풀의 지문이 다릅니다.");
        }
        String requestDigest = sha256(request.expectedRevision() + ":" + digest + ":" + actor);
        lock();
        List<StoredApproval> existing = jdbc.query("SELECT expected_revision,approved_digest,approved_by,"
                        + "approved_at,request_digest,revoked_at FROM customization_reward_pool_approvals"
                        + " WHERE approval_id=?",
                (rs, index) -> new StoredApproval(new Approval(approvalId, rs.getInt("expected_revision"),
                        request.productIds(), rs.getString("approved_digest").trim(), rs.getString("approved_by"),
                        rs.getTimestamp("approved_at").toInstant()),
                        rs.getString("request_digest").trim(), rs.getTimestamp("revoked_at") != null), approvalId);
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
        Policy current = currentPolicy();
        if (current.revision() != request.expectedRevision()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "추첨 풀 revision이 변경되었습니다.");
        }
        validatePool(request.productIds(), current);
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        jdbc.update("INSERT INTO customization_reward_pool_approvals(approval_id,expected_revision,product_ids,"
                        + "approved_digest,request_digest,approved_by,approved_at) VALUES(?,?,?::jsonb,?,?,?,?)",
                approvalId, request.expectedRevision(), canonical(request.productIds()), digest, requestDigest,
                actor, Timestamp.from(now));
        return new Approval(approvalId, request.expectedRevision(), request.productIds(), digest, actor, now);
    }

    /** 로컬 변경안의 승인 취소와 함께 호출한다. 삭제 대신 누가 언제 취소했는지 보존한다. */
    @Transactional
    public void revoke(UUID approvalId, String actor) {
        if (approvalId == null || !validActor(actor)) {
            throw badRequest();
        }
        lock();
        List<Boolean> revoked = jdbc.query("SELECT revoked_at IS NOT NULL FROM customization_reward_pool_approvals"
                + " WHERE approval_id=?", (rs, index) -> rs.getBoolean(1), approvalId);
        if (revoked.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "승인 기록을 찾을 수 없습니다.");
        }
        Integer used = jdbc.queryForObject("SELECT count(*) FROM customization_reward_pool_publications"
                + " WHERE approval_id=?", Integer.class, approvalId);
        if (used != null && used > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 발행에 사용한 승인입니다.");
        }
        if (!revoked.get(0)) {
            jdbc.update("UPDATE customization_reward_pool_approvals SET revoked_at=?,revoked_by=?"
                    + " WHERE approval_id=? AND revoked_at IS NULL", Timestamp.from(Instant.now()), actor, approvalId);
        }
    }

    @Transactional
    public Publication publish(UUID publicationId, PublishRequest request, String actor) {
        if (publicationId == null || request == null || request.expectedRevision() < 0
                || request.approvalId() == null || !validActor(actor)) {
            throw badRequest();
        }
        validateShape(request.productIds());
        String canonical = canonical(request.productIds());
        String digest = sha256(canonical);
        if (!digest.equals(request.approvedDigest())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "승인 풀과 발행 풀이 다릅니다.");
        }
        String requestDigest = sha256(request.approvalId() + ":" + request.expectedRevision() + ":" + digest
                + ":" + actor);

        // 동일 UUID 재시도와 서로 다른 UUID의 동시 revision 발행을 모두 하나로 직렬화한다.
        lock();
        List<String> existing = jdbc.query("SELECT request_digest FROM customization_reward_pool_publications"
                + " WHERE publication_id=?", (rs, index) -> rs.getString(1).trim(), publicationId);
        if (!existing.isEmpty()) {
            if (!requestDigest.equals(existing.get(0))) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "발행 ID가 다른 요청에 사용되었습니다.");
            }
            return jdbc.queryForObject(PUBLICATION_SELECT + " WHERE p.publication_id=?",
                    (rs, index) -> mapPublication(rs), publicationId);
        }

        List<ApprovalEvidence> approvals = jdbc.query("SELECT expected_revision,approved_digest,approved_by,"
                        + "product_ids=?::jsonb AS snapshot_matches,revoked_at IS NULL AS active"
                        + " FROM customization_reward_pool_approvals WHERE approval_id=?",
                (rs, index) -> new ApprovalEvidence(rs.getInt(1), rs.getString(2).trim(), rs.getString(3),
                        rs.getBoolean(4), rs.getBoolean(5)), canonical, request.approvalId());
        if (approvals.size() != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "승인 기록을 찾을 수 없습니다.");
        }
        ApprovalEvidence approval = approvals.get(0);
        String approvedBy = approval.actor();
        if (approval.expectedRevision() != request.expectedRevision() || !digest.equals(approval.digest())
                || approvedBy.equals(actor) || !approval.snapshotMatches() || !approval.active()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "승인 기록과 발행 요청이 일치하지 않습니다.");
        }
        Integer used = jdbc.queryForObject("SELECT count(*) FROM customization_reward_pool_publications"
                + " WHERE approval_id=?", Integer.class, request.approvalId());
        if (used != null && used > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 발행에 사용한 승인입니다.");
        }
        Policy current = currentPolicy();
        int previous = current.revision();
        if (previous != request.expectedRevision() || previous == Integer.MAX_VALUE) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "추첨 풀 revision이 변경되었습니다.");
        }
        validatePool(request.productIds(), current);

        List<String> before = productIdsAt(previous);
        int next = previous + 1;
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        try {
            jdbc.update("INSERT INTO customization_reward_policies(revision," + POLICY_COLUMNS + ")"
                    + " SELECT ?," + POLICY_COLUMNS + " FROM customization_reward_policies WHERE revision=?",
                    next, previous);
            int copied = jdbc.update("INSERT INTO customization_reward_items(revision,product_id,source_asset_id,"
                    + "category,rarity,rarity_reason,render_data,sort_order)"
                    + " SELECT ?,product_id,source_asset_id,category,rarity,rarity_reason,render_data,sort_order"
                    + " FROM (SELECT DISTINCT ON (product_id) * FROM customization_reward_items"
                    + " WHERE product_id IN (SELECT jsonb_array_elements_text(?::jsonb))"
                    + " ORDER BY product_id,revision DESC) latest", next, canonical);
            if (copied != request.productIds().size()) {
                throw new IllegalStateException("추첨 풀 아이템 복사 건수가 다릅니다: " + copied);
            }
        } catch (DuplicateKeyException e) {
            // 수동 SQL처럼 이 서비스의 advisory lock을 쓰지 않은 동시 INSERT도 500 대신 충돌로 알린다.
            throw new ResponseStatusException(HttpStatus.CONFLICT, "추첨 풀 revision이 변경되었습니다.", e);
        }
        try {
            jdbc.update("INSERT INTO customization_reward_pool_publications(publication_id,approval_id,revision,"
                            + "previous_revision,before_product_ids,after_product_ids,request_digest,"
                            + "approved_digest,approved_by,actor,published_at)"
                            + " VALUES(?,?,?,?,?::jsonb,?::jsonb,?,?,?,?,?)", publicationId, request.approvalId(),
                    next, previous, canonical(before), canonical, requestDigest, digest, approvedBy, actor,
                    Timestamp.from(now));
        } catch (DuplicateKeyException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "승인 또는 발행 ID가 이미 사용되었습니다.", e);
        }
        return new Publication(publicationId, request.approvalId(), next, previous, request.productIds(), before,
                actor, approvedBy, digest, now);
    }

    // ------------------------------------------------------------------ 검증

    /** 1번 규칙: 1개 이상, 중복 없음, 오름차순. 정규 문자열이 이스케이프 없이 JS 와 같도록 id 모양도 본다. */
    private static void validateShape(List<String> productIds) {
        if (productIds == null || productIds.isEmpty()) {
            throw badRequest();
        }
        String last = null;
        for (String id : productIds) {
            if (id == null || !PRODUCT_ID.matcher(id).matches() || (last != null && id.compareTo(last) <= 0)) {
                throw badRequest();
            }
            last = id;
        }
    }

    /**
     * 2·3번 규칙. 추첨은 빈 (분류·등급) 칸을 조용히 다시 나누므로(CustomizationRewardDraw) 칸이 비면 발행하지 않는다.
     * 발행이 실제로 복사할 행(상품마다 가장 큰 revision)의 분류·등급으로 판정한다.
     */
    private void validatePool(List<String> productIds, Policy current) {
        Map<String, String[]> cells = new HashMap<>();
        jdbc.query("SELECT DISTINCT ON (product_id) product_id,category,rarity FROM customization_reward_items"
                        + " WHERE product_id IN (SELECT jsonb_array_elements_text(?::jsonb))"
                        + " ORDER BY product_id,revision DESC",
                rs -> {
                    cells.put(rs.getString(1), new String[] {rs.getString(2), rs.getString(3)});
                }, canonical(productIds));
        Set<String> filled = new HashSet<>();
        for (String id : productIds) {
            String[] cell = cells.get(id);
            if (cell == null || !POOL_CATEGORIES.contains(cell[0])) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "추첨 풀에 넣을 수 없는 상품입니다: " + id);
            }
            filled.add(cell[0] + "/" + cell[1]);
        }
        List<String> weighted = new ArrayList<>(current.categoryWeights().keySet());
        weighted.removeIf(category -> !positive(current.categoryWeights().get(category)));
        weighted.sort(Comparator.naturalOrder());
        for (String category : weighted) {
            for (String rarity : RARITIES) {
                if (!filled.contains(category + "/" + rarity)) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "추첨 풀에 " + category + " " + rarity + " 상품이 하나도 없습니다.");
                }
            }
        }
    }

    // ------------------------------------------------------------------ 도구

    private Policy currentPolicy() {
        List<Policy> rows = jdbc.query("SELECT revision,category_weights::text FROM customization_reward_policies"
                + " ORDER BY revision DESC LIMIT 1", (rs, index) -> new Policy(rs.getInt(1),
                parse(rs.getString(2), OBJECT)));
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "꾸미기 보상 정책이 없습니다.");
        }
        return rows.get(0);
    }

    private List<String> productIdsAt(int revision) {
        return jdbc.queryForList("SELECT product_id FROM customization_reward_items WHERE revision=?"
                + " ORDER BY product_id", String.class, revision);
    }

    private Publication mapPublication(ResultSet rs) throws SQLException {
        return new Publication(rs.getObject("publication_id", UUID.class), rs.getObject("approval_id", UUID.class),
                rs.getInt("revision"), rs.getInt("previous_revision"), parse(rs.getString(6), STRINGS),
                parse(rs.getString(5), STRINGS), rs.getString("actor"), rs.getString("approved_by"),
                rs.getString("approved_digest").trim(), rs.getTimestamp("published_at").toInstant());
    }

    private static <T> T parse(String json, TypeReference<T> type) {
        try {
            return JSON.readValue(json, type);
        } catch (JsonProcessingException e) {
            // jsonb CHECK 와 이 서비스의 쓰기 모양이 보장하므로 여기 오면 DB 가 깨진 것이다
            throw new IllegalStateException("저장된 JSON 을 읽지 못했습니다", e);
        }
    }

    private static boolean positive(Object weight) {
        return weight instanceof Number number && number.doubleValue() > 0;
    }

    private void lock() {
        jdbc.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", POOL_LOCK);
    }

    private static boolean validActor(String actor) {
        return actor != null && actor.matches("member-[1-3]");
    }

    /** JS JSON.stringify({productIds}) 와 바이트까지 같은 문자열. 상품 id 는 이스케이프할 문자가 없는 모양만 통과한다. */
    public static String canonical(List<String> productIds) {
        StringBuilder out = new StringBuilder("{\"productIds\":[");
        for (int i = 0; i < productIds.size(); i++) {
            out.append(i == 0 ? "" : ",").append('"').append(productIds.get(i)).append('"');
        }
        return out.append("]}").toString();
    }

    private static String sha256(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(bytes);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static ResponseStatusException badRequest() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "추첨 풀 값을 확인해 주세요.");
    }

    private record Policy(int revision, Map<String, Object> categoryWeights) { }

    public record ApproveRequest(int expectedRevision, List<String> productIds, String approvedDigest) { }

    public record Approval(UUID approvalId, int expectedRevision, List<String> productIds, String approvedDigest,
                           String approvedBy, Instant approvedAt) { }

    private record StoredApproval(Approval result, String requestDigest, boolean revoked) { }

    private record ApprovalEvidence(int expectedRevision, String digest, String actor, boolean snapshotMatches,
                                    boolean active) { }

    public record PublishRequest(UUID approvalId, int expectedRevision, List<String> productIds,
                                 String approvedDigest) { }

    public record Revision(int revision, List<String> productIds, Instant publishedAt) { }

    public record Publication(UUID publicationId, UUID approvalId, int revision, int previousRevision,
                              List<String> productIds, List<String> previousProductIds, String actor,
                              String approvedBy, String approvedDigest, Instant publishedAt) { }

    public record View(Revision current, List<Publication> history) { }

    public record PoolSummary(int revision, Map<String, Object> categoryWeights, List<String> productIds) { }

    public record Item(String productId, String title, String kind, String category, String rarity,
                       String imagePath, boolean displayable, boolean inPool, long ownerCount, int sortOrder,
                       Instant retiredAt) { }

    public record ItemsView(PoolSummary pool, List<Item> items) { }
}
