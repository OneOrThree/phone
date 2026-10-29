package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.content.exception.ContentErrorCode;
import com.oneorthree.phone.content.exception.ContentException;
import com.oneorthree.phone.content.repository.ContentStore;
import com.oneorthree.phone.content.service.ContentJson;
import com.oneorthree.phone.internal.dto.ConstructionPolicyApplied;
import com.oneorthree.phone.internal.dto.ConstructionPolicyRequest;
import com.oneorthree.phone.internal.dto.ConstructionPolicyView;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** 건설 정책 포인터와 관리 발행 영수증을 같은 트랜잭션으로 전환한다. */
@Service
@RequiredArgsConstructor
public class ConstructionPolicyAdminService {
    private static final String KIND = "CONSTRUCTION";
    private final JdbcTemplate jdbc;
    private final ContentStore store;
    private final Clock clock;

    @Transactional(readOnly = true)
    public ConstructionPolicyView current() {
        // 포인터와 행을 한 SQL 스냅샷에서 읽어 조회 도중 정책이 바뀌어도 섞이지 않는다.
        var rows = jdbc.query("SELECT p.revision,p.published_at,b.id,b.display_name,c.cost,c.build_seconds"
                        + " FROM construction_cost_policy_publication p CROSS JOIN construction_buildings b"
                        + " LEFT JOIN construction_cost_policies c ON c.revision=p.revision AND c.building_id=b.id"
                        + " WHERE p.singleton=true ORDER BY b.display_order,b.id",
                (rs, row) -> {
                    if (rs.getObject("cost") == null || rs.getObject("build_seconds") == null) {
                        throw new IllegalStateException("현재 정책에 건물별 비용·공사 시간이 없습니다.");
                    }
                    return new CurrentRow(rs.getInt("revision"), rs.getTimestamp("published_at").toInstant(),
                            new ConstructionPolicyView.Item(rs.getString("id"), rs.getString("display_name"),
                                    rs.getInt("cost"), rs.getInt("build_seconds")));
                });
        if (rows.isEmpty()) {
            throw new IllegalStateException("현재 건설 정책 또는 건물 목록이 없습니다.");
        }
        return new ConstructionPolicyView(rows.get(0).revision(), rows.get(0).publishedAt(),
                rows.stream().map(CurrentRow::item).toList());
    }

    @Transactional
    public ConstructionPolicyApplied apply(UUID id, ConstructionPolicyRequest request, String actor) {
        Normalized input = normalize(request);
        String digest = ContentJson.digest(input);
        store.lock(id);
        String replay = store.replay(id, KIND, digest);
        if (replay != null) {
            return ContentJson.read(replay, ConstructionPolicyApplied.class);
        }
        // 착공 명령과 같은 행을 잠근다. 섬·지갑에는 접근하지 않아 잠금 순서를 역전하지 않는다.
        List<Integer> locked = jdbc.queryForList("SELECT revision FROM construction_cost_policy_publication"
                + " WHERE singleton=true FOR UPDATE", Integer.class);
        if (locked.size() != 1) {
            throw new IllegalStateException("현재 비용 정책 publication이 없습니다.");
        }
        if (locked.get(0) != input.expectedCostPolicyVersion()) {
            throw new ContentException(ContentErrorCode.CONTENT_REVIEW_STALE);
        }
        ConstructionPolicyView before = current();
        Set<String> expected = new HashSet<>(before.items().stream()
                .map(ConstructionPolicyView.Item::buildingId).toList());
        if (!expected.equals(new HashSet<>(input.items().stream().map(PolicyValue::buildingId).toList()))) {
            throw new ContentException(ContentErrorCode.INVALID_REQUEST);
        }
        Integer maximum = jdbc.queryForObject("SELECT COALESCE(MAX(revision),0) FROM construction_cost_policies",
                Integer.class);
        if (maximum == null || maximum == Integer.MAX_VALUE) {
            throw new IllegalStateException("새 건설 정책 revision을 만들 수 없습니다.");
        }
        int next = maximum + 1;
        Instant now = clock.instant();
        for (PolicyValue item : input.items()) {
            jdbc.update("INSERT INTO construction_cost_policies(revision,building_id,cost,build_seconds)"
                    + " VALUES(?,?,?,?)", next, item.buildingId(), item.cost(), item.buildSeconds());
        }
        jdbc.update("UPDATE construction_cost_policy_publication SET revision=?,published_at=?"
                + " WHERE singleton=true", next, Timestamp.from(now));
        ConstructionPolicyApplied result = new ConstructionPolicyApplied(id, before.costPolicyVersion(), next,
                now, actor, before.items(), current().items());
        store.record(id, KIND, digest, ContentJson.write(result), actor, now);
        return result;
    }

    private Normalized normalize(ConstructionPolicyRequest request) {
        if (request == null || request.items() == null || request.items().isEmpty()
                || request.items().size() > 100) {
            throw new ContentException(ContentErrorCode.INVALID_REQUEST);
        }
        int revision = integer(request.expectedCostPolicyVersion());
        Set<String> ids = new HashSet<>();
        List<PolicyValue> values = request.items().stream().map(item -> {
            if (item == null || item.buildingId() == null || !ids.add(item.buildingId())) {
                throw new ContentException(ContentErrorCode.INVALID_REQUEST);
            }
            int cost = integer(item.cost());
            if (cost == 0) {
                throw new ContentException(ContentErrorCode.INVALID_REQUEST);
            }
            return new PolicyValue(item.buildingId(), cost, integer(item.buildSeconds()));
        }).sorted(Comparator.comparing(PolicyValue::buildingId)).toList();
        return new Normalized(revision, values);
    }

    private int integer(BigDecimal value) {
        try {
            if (value == null || value.signum() < 0) {
                throw new ArithmeticException();
            }
            return value.intValueExact();
        } catch (ArithmeticException invalid) {
            throw new ContentException(ContentErrorCode.INVALID_REQUEST);
        }
    }

    private record CurrentRow(int revision, Instant publishedAt, ConstructionPolicyView.Item item) { }

    private record PolicyValue(String buildingId, int cost, int buildSeconds) { }

    private record Normalized(int expectedCostPolicyVersion, List<PolicyValue> items) { }
}
