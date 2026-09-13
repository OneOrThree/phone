package com.oneorthree.notification;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/** 단일 DB 트랜잭션의 SQL 창구. 호출 서비스의 @Transactional 경계를 벗어나지 않는다. */
@Component
class Store {

    private final JdbcTemplate jdbc;

    Store(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    List<Map<String, Object>> rows(String sql, Object... args) {
        return jdbc.queryForList(sql, args);
    }

    Map<String, Object> one(String sql, Object... args) {
        List<Map<String, Object>> rows = rows(sql, args);
        return rows.isEmpty() ? null : rows.get(0);
    }

    int update(String sql, Object... args) {
        return jdbc.update(sql, args);
    }

    void lock(String key) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", rs -> { }, key);
    }

    Map<String, Object> command(String scope, String key, Object request, Supplier<Map<String, Object>> action) {
        return command(scope, key, request, action, false);
    }

    /**
     * 멱등 명령. 저장된 응답이 있으면 그대로 재생한다 — 등록 ownershipToken 처럼 «그때 돌려준 값»이
     * 계약인 명령은 이 재생이 맞다.
     *
     * <p>{@code reassert=true} 는 응답이 «약속한 상태»가 지금도 서 있어야 하는 명령용이다.
     * 그런 명령은 재생일 때도 같은 잠금 아래에서 action 을 다시 실행하고 «지금» 값을 돌려준다 —
     * 보류가 풀린 뒤 같은 키로 다시 온 요청에 과거의 「보류했다」를 재생하면, 실제로는 아무것도
     * 보호하지 않는 채 호출자가 다음 단계로 넘어간다(A22 ⓓ). action 은 반드시 멱등이어야 한다.
     */
    Map<String, Object> command(String scope, String key, Object request, Supplier<Map<String, Object>> action,
            boolean reassert) {
        return command(scope, key, request, action, reassert, null);
    }

    /**
     * {@code revalidate} 는 «재생 직전»에 지금 상태를 다시 보는 검증이다. 멱등 비교 기준에서 뺀
     * 인증 수명 값(등록의 {@code sessionEpoch})은 여기서 검사해야 한다 — 빼기만 하면 폐기된 세션의
     * 재시도까지 옛 성공 응답을 받는다. 실패하면 재생 대신 그 예외가 오른다.
     */
    Map<String, Object> command(String scope, String key, Object request, Supplier<Map<String, Object>> action,
            boolean reassert, Runnable revalidate) {
        if (key == null || key.isBlank() || key.length() > 200) {
            throw new NotificationFailure(400, "IDEMPOTENCY_KEY_REQUIRED");
        }
        lock("command:" + scope + ":" + key);
        String hash = Json.hash(request);
        Map<String, Object> saved = one("SELECT request_hash,response::text FROM commands"
                + " WHERE scope=? AND command_key=?", scope, key);
        if (saved != null) {
            if (!hash.equals(saved.get("request_hash"))) {
                throw new NotificationFailure(409, "IDEMPOTENCY_KEY_CONFLICT");
            }
            if (reassert) {
                return action.get();
            }
            if (revalidate != null) {
                revalidate.run();
            }
            return Json.map(saved.get("response"));
        }
        Map<String, Object> result = action.get();
        update("INSERT INTO commands(scope,command_key,request_hash,response) VALUES(?,?,?,?::jsonb)",
                scope, key, hash, Json.write(result));
        return result;
    }
}
