package com.oneorthree.phone.internal.service;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.dao.DuplicateKeyException;
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
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

/** 집중·황금 물고기 운영 정책: 새 revision만 발행하고 전후값을 영구 보존한다. */
@Service
@RequiredArgsConstructor
public class FocusPolicyAdminService {

    private static final String PUBLICATION_SELECT = "SELECT p.publication_id,p.approval_id,r.revision,"
            + "COALESCE(LAG(r.revision) OVER (ORDER BY r.revision),0) AS prior_revision,"
            + "p.previous_revision,"
            + "p.actor,p.approved_by,p.approved_digest,COALESCE(p.published_at,r.published_at) AS published_at,"
            + "r.seconds_per_fish,r.daily_cap_fish,r.personal_share_percent,"
            + "r.golden_fish_reward,r.golden_max_members,r.golden_chance_ppm"
            + " FROM focus_reward_policies r LEFT JOIN focus_reward_policy_publications p ON p.revision=r.revision";
    private static final String POLICY_LOCK = "backoffice:focus-policy-revision";
    private final JdbcTemplate jdbc;

    @Transactional(readOnly = true)
    public View get() {
        // 한 SQL 스냅샷에서 현재값과 이력을 함께 읽어 발행 경합 시 서로 다른 revision이 섞이지 않게 한다.
        List<Publication> history = jdbc.query(PUBLICATION_SELECT + " ORDER BY r.revision DESC",
                (rs, index) -> mapPublication(rs));
        if (history.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "집중 보상 정책이 없습니다.");
        }
        Publication latest = history.get(0);
        return new View(new Revision(latest.revision(), latest.policy(), latest.publishedAt()), history);
    }

    @Transactional
    public Approval approve(UUID approvalId, ApproveRequest request, String actor) {
        if (approvalId == null || request == null || request.policy() == null || !validActor(actor)
                || request.expectedRevision() < 0) {
            throw badRequest();
        }
        validate(request.policy());
        String digest = sha256(canonical(request.policy()));
        if (!digest.equals(request.approvedDigest())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "승인 정책의 지문이 다릅니다.");
        }
        String requestDigest = sha256(request.expectedRevision() + ":" + digest + ":" + actor);
        lock();
        List<StoredApproval> existing = jdbc.query("SELECT approval_id,expected_revision,policy_digest,approved_by,"
                        + "approved_at,request_digest,revoked_at FROM focus_reward_policy_approvals"
                        + " WHERE approval_id=?",
                (rs, index) -> new StoredApproval(new Approval(rs.getObject("approval_id", UUID.class),
                        rs.getInt("expected_revision"), request.policy(), rs.getString("policy_digest").trim(),
                        rs.getString("approved_by"), rs.getTimestamp("approved_at").toInstant()),
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
        if (currentRevision() != request.expectedRevision()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "정책 revision이 변경되었습니다.");
        }
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        jdbc.update("INSERT INTO focus_reward_policy_approvals(approval_id,expected_revision,policy_snapshot,"
                        + "policy_digest,request_digest,approved_by,approved_at) VALUES(?,?,?::jsonb,?,?,?,?)",
                approvalId, request.expectedRevision(), canonical(request.policy()), digest, requestDigest,
                actor, Timestamp.from(now));
        return new Approval(approvalId, request.expectedRevision(), request.policy(), digest, actor, now);
    }

    /** 로컬 변경안의 승인 취소와 함께 호출한다. 삭제 대신 누가 언제 취소했는지 보존한다. */
    @Transactional
    public void revoke(UUID approvalId, String actor) {
        if (approvalId == null || !validActor(actor)) {
            throw badRequest();
        }
        lock();
        List<Boolean> revoked = jdbc.query("SELECT revoked_at IS NOT NULL FROM focus_reward_policy_approvals"
                + " WHERE approval_id=?", (rs, index) -> rs.getBoolean(1), approvalId);
        if (revoked.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "승인 기록을 찾을 수 없습니다.");
        }
        Integer used = jdbc.queryForObject("SELECT count(*) FROM focus_reward_policy_publications"
                + " WHERE approval_id=?", Integer.class, approvalId);
        if (used != null && used > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 발행에 사용한 승인입니다.");
        }
        if (!revoked.get(0)) {
            jdbc.update("UPDATE focus_reward_policy_approvals SET revoked_at=?,revoked_by=?"
                    + " WHERE approval_id=? AND revoked_at IS NULL", Timestamp.from(Instant.now()), actor, approvalId);
        }
    }

    @Transactional
    public Publication publish(UUID publicationId, PublishRequest request, String actor) {
        if (publicationId == null || request == null || request.policy() == null || request.expectedRevision() < 0
                || request.approvalId() == null || !validActor(actor)) {
            throw badRequest();
        }
        validate(request.policy());
        String digest = sha256(canonical(request.policy()));
        if (!digest.equals(request.approvedDigest())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "승인 정책과 발행 정책이 다릅니다.");
        }
        String requestDigest = sha256(request.approvalId() + ":" + request.expectedRevision() + ":" + digest
                + ":" + actor);

        // 동일 UUID 재시도와 서로 다른 UUID의 동시 revision 발행을 모두 하나로 직렬화한다.
        lock();
        List<String> existing = jdbc.query("SELECT request_digest FROM focus_reward_policy_publications"
                        + " WHERE publication_id=?", (rs, index) -> rs.getString(1).trim(), publicationId);
        if (!existing.isEmpty()) {
            if (!requestDigest.equals(existing.get(0))) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "발행 ID가 다른 요청에 사용되었습니다.");
            }
            return publication(publicationId);
        }

        List<ApprovalEvidence> approvals = jdbc.query("SELECT expected_revision,policy_digest,approved_by,"
                        + "policy_snapshot=?::jsonb AS snapshot_matches,revoked_at IS NULL AS active"
                        + " FROM focus_reward_policy_approvals WHERE approval_id=?",
                (rs, index) -> new ApprovalEvidence(rs.getInt(1), rs.getString(2).trim(), rs.getString(3),
                        rs.getBoolean(4), rs.getBoolean(5)), canonical(request.policy()), request.approvalId());
        if (approvals.size() != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "승인 기록을 찾을 수 없습니다.");
        }
        ApprovalEvidence approval = approvals.get(0);
        String approvedBy = approval.actor();
        if (approval.expectedRevision() != request.expectedRevision() || !digest.equals(approval.digest())
                || approvedBy.equals(actor) || !approval.snapshotMatches() || !approval.active()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "승인 기록과 발행 요청이 일치하지 않습니다.");
        }
        Integer used = jdbc.queryForObject("SELECT count(*) FROM focus_reward_policy_publications"
                + " WHERE approval_id=?", Integer.class, request.approvalId());
        if (used != null && used > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 발행에 사용한 승인입니다.");
        }
        int previous = currentRevision();
        if (previous != request.expectedRevision() || previous == Integer.MAX_VALUE) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "정책 revision이 변경되었습니다.");
        }
        String before = previous == 0 ? "null" : canonical(policy(previous));
        int next = previous + 1;
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        Policy policy = request.policy();
        try {
            jdbc.update("INSERT INTO focus_reward_policies(revision,seconds_per_fish,daily_cap_fish,"
                            + "personal_share_percent,golden_fish_reward,golden_max_members,"
                            + "golden_chance_ppm,published_at)"
                            + " VALUES(?,?,?,?,?,?,?,?)", next, policy.secondsPerFish(), policy.dailyCapFish(),
                    policy.personalSharePercent(), policy.goldenFishReward(), policy.goldenMaxMembers(),
                    joinChance(policy.goldenChancePpm()), Timestamp.from(now));
        } catch (DuplicateKeyException e) {
            // 수동 SQL처럼 이 서비스의 advisory lock을 쓰지 않은 동시 INSERT도 500 대신 충돌로 알린다.
            throw new ResponseStatusException(HttpStatus.CONFLICT, "정책 revision이 변경되었습니다.", e);
        }
        jdbc.update("INSERT INTO focus_reward_policy_publications(publication_id,approval_id,revision,"
                        + "previous_revision,"
                        + "before_policy,after_policy,request_digest,approved_digest,approved_by,actor,published_at)"
                        + " VALUES(?,?,?,?,?::jsonb,?::jsonb,?,?,?,?,?)", publicationId, request.approvalId(),
                next, previous, before, canonical(policy), requestDigest, digest, approvedBy, actor,
                Timestamp.from(now));
        return new Publication(publicationId, request.approvalId(), next, previous, actor, approvedBy, digest,
                now, policy);
    }

    private Publication publication(UUID id) {
        return jdbc.queryForObject(PUBLICATION_SELECT + " WHERE p.publication_id=?",
                (rs, index) -> mapPublication(rs), id);
    }

    private static Publication mapPublication(ResultSet rs) throws SQLException {
        UUID id = rs.getObject("publication_id", UUID.class);
        int revision = rs.getInt("revision");
        return new Publication(id, rs.getObject("approval_id", UUID.class), revision,
                id == null ? rs.getInt("prior_revision") : rs.getInt("previous_revision"),
                rs.getString("actor"), rs.getString("approved_by"), rs.getString("approved_digest"),
                rs.getTimestamp("published_at").toInstant(),
                new Policy(rs.getInt("seconds_per_fish"), rs.getInt("daily_cap_fish"),
                        rs.getInt("personal_share_percent"), rs.getInt("golden_fish_reward"),
                        rs.getInt("golden_max_members"), parseChance(rs.getString("golden_chance_ppm"))));
    }

    private Policy policy(int revision) {
        return jdbc.queryForObject("SELECT seconds_per_fish,daily_cap_fish,personal_share_percent,"
                        + "golden_fish_reward,golden_max_members,golden_chance_ppm FROM focus_reward_policies"
                        + " WHERE revision=?", (rs, index) -> new Policy(rs.getInt(1), rs.getInt(2), rs.getInt(3),
                        rs.getInt(4), rs.getInt(5), parseChance(rs.getString(6))), revision);
    }

    private void lock() {
        jdbc.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", POLICY_LOCK);
    }

    private int currentRevision() {
        Integer current = jdbc.queryForObject("SELECT max(revision) FROM focus_reward_policies", Integer.class);
        return current == null ? 0 : current;
    }

    private static boolean validActor(String actor) {
        return actor != null && actor.matches("member-[1-3]");
    }

    private static void validate(Policy policy) {
        // 적립 정산은 activeSeconds/secondsPerFish 회 순회하며 지급분마다 원장을 쓰므로
        // 1초 설정은 하루 86,400회 순회할 수 있다. 일일 지급 상한은 현행 480마리의 두 배까지만 연다.
        if (policy.secondsPerFish() < 30 || policy.secondsPerFish() > 86400
                || policy.dailyCapFish() < 0 || policy.dailyCapFish() > 960
                || policy.personalSharePercent() != 0
                || policy.goldenFishReward() < 0 || policy.goldenFishReward() > 1000
                || policy.goldenMaxMembers() < 2 || policy.goldenMaxMembers() > 15
                || policy.goldenChancePpm() == null
                || policy.goldenChancePpm().size() != policy.goldenMaxMembers() - 1) {
            throw badRequest();
        }
        for (Integer chance : policy.goldenChancePpm()) {
            if (chance == null || chance < 0 || chance > 1_000_000) {
                throw badRequest();
            }
        }
    }

    private static List<Integer> parseChance(String value) {
        try {
            return List.of(value.split(",")).stream().map(String::strip).map(Integer::parseInt).toList();
        } catch (RuntimeException e) {
            // 기존 운영 DB에 파싱 불가능한 정책이 있으면 발행·조회 모두 닫고 복구를 요구한다.
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "저장된 확률 정책이 손상되었습니다.", e);
        }
    }

    private static String joinChance(List<Integer> chances) {
        return chances.stream().map(String::valueOf).reduce((a, b) -> a + "," + b).orElseThrow();
    }

    /** JS JSON.stringify의 고정 필드 순서와 정확히 같은 ASCII 바이트열. */
    public static String canonical(Policy policy) {
        return "{\"secondsPerFish\":" + policy.secondsPerFish()
                + ",\"dailyCapFish\":" + policy.dailyCapFish()
                + ",\"personalSharePercent\":" + policy.personalSharePercent()
                + ",\"goldenFishReward\":" + policy.goldenFishReward()
                + ",\"goldenMaxMembers\":" + policy.goldenMaxMembers()
                + ",\"goldenChancePpm\":[" + joinChance(policy.goldenChancePpm()) + "]}";
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
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "정책 값을 확인해 주세요.");
    }

    public record Policy(int secondsPerFish, int dailyCapFish, int personalSharePercent,
                         int goldenFishReward, int goldenMaxMembers, List<Integer> goldenChancePpm) { }

    public record ApproveRequest(int expectedRevision, Policy policy, String approvedDigest) { }

    public record Approval(UUID approvalId, int expectedRevision, Policy policy, String approvedDigest,
                           String approvedBy, Instant approvedAt) { }

    private record StoredApproval(Approval result, String requestDigest, boolean revoked) { }

    private record ApprovalEvidence(int expectedRevision, String digest, String actor, boolean snapshotMatches,
                                    boolean active) { }

    public record PublishRequest(UUID approvalId, int expectedRevision, Policy policy, String approvedDigest) { }

    public record Revision(int revision, Policy policy, Instant publishedAt) { }

    public record Publication(UUID publicationId, UUID approvalId, int revision, int previousRevision, String actor,
                              String approvedBy, String approvedDigest, Instant publishedAt, Policy policy) { }

    public record View(Revision current, List<Publication> history) { }
}
