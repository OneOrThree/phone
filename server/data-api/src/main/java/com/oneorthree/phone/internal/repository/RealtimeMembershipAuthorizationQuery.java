package com.oneorthree.phone.internal.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.Map;
import java.util.UUID;

/** 여러 도메인의 판정을 단일 scalar SQL로 읽어 statement 사이의 상태 혼합/엔티티 캐시를 피한다. */
@Repository
@RequiredArgsConstructor
public class RealtimeMembershipAuthorizationQuery {
    private static final String AUTHORIZATION_SQL = """
            SELECT EXISTS (
                SELECT 1
                FROM users u
                JOIN auth_sessions s ON s.user_id = u.id
                JOIN group_members m ON m.user_id = u.id
                JOIN groups g ON g.id = m.group_id
                WHERE u.id = :userId
                  AND u.is_deleted = false
                  AND u.auth_generation = :authGeneration
                  AND s.id = :sessionId
                  AND s.revoked_at IS NULL
                  AND g.id = :islandId
                  AND g.deleted_at IS NULL
                  AND g.status IN ('WAITING', 'ACTIVE')
                  AND m.is_left = false
                  AND (m.left_reason IS NULL OR m.left_reason <> 'KICKED')
            )
            """;
    private final NamedParameterJdbcTemplate jdbc;

    /** DB 오류를 false로 숨기지 않는다. 행 잠금·receipt·version 초기화·writer 호출이 없다. */
    public boolean isAllowed(UUID userId, UUID sessionId, long authGeneration, UUID islandId) {
        Boolean allowed = jdbc.queryForObject(AUTHORIZATION_SQL, Map.of(
                "userId", userId,
                "sessionId", sessionId,
                "authGeneration", authGeneration,
                "islandId", islandId), Boolean.class);
        if (allowed == null) {
            throw new IllegalStateException("멤버십 인가 조회 결과가 없습니다.");
        }
        return allowed;
    }
}
