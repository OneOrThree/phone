package com.oneorthree.notification;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@Service
class DeviceService {

    private final Store store;
    private final boolean generationRequired;

    DeviceService(Store store, @Value("${notification.generation-required:false}") boolean generationRequired) {
        this.store = store;
        this.generationRequired = generationRequired;
    }

    /**
     * 기기 등록. 멱등 비교 기준은 <b>의도</b>(기기 · 소유권 · 1회용 자격)이고 {@code sessionEpoch} 는
     * 뺀다 — 등록이 커밋된 뒤 응답만 유실되고 재시도 전에 RT 가 회전하면 같은 의도의 재시도가 새 epoch
     * 를 싣고 오므로, 본문 전체 해시로는 영구 {@code IDEMPOTENCY_KEY_CONFLICT} 가 되어 앱이 복구되지
     * 못한다. 대신 <b>재생 때도</b> 같은 fencing 을 «지금» 값으로 다시 본다: 폐기된 세션 · 낡은 세대의
     * 재시도는 옛 성공 응답을 받지 못한다.
     */
    @Transactional
    public Map<String, Object> register(UUID user, Map<String, Object> body, String key) {
        return store.command("device-register:" + user, key, intent(body),
                () -> registerLocked(user, body, false), false, () -> registerLocked(user, body, true));
    }

    /**
     * 멱등 비교 기준. {@code authGeneration} 은 남긴다 — 세대가 오른 등록은 「같은 의도」가 아니라
     * 이미 폐기된 등록이고, 그 재생은 죽은 기기 행에 성공을 돌려주게 된다.
     */
    private Map<String, Object> intent(Map<String, Object> body) {
        Map<String, Object> intent = new LinkedHashMap<>(body);
        intent.remove("sessionEpoch");
        return intent;
    }

    private Map<String, Object> registerLocked(UUID user, Map<String, Object> body, boolean replay) {
        store.lock("device-ownership");
        Map<String, Object> fence = userFence(user);
        Long generation = Json.nullableNumber(body, "authGeneration");
        if (Boolean.TRUE.equals(fence.get("withdrawn")) || (generationRequired && generation == null)
                || (generation != null && generation < ((Number) fence.get("auth_generation")).longValue())) {
            throw new NotificationFailure(409, "STALE_AUTH_GENERATION");
        }
        String token = Json.text(body, "deviceToken");
        String bootstrap = Json.nullableText(body, "deviceBootstrap");
        String hash = bootstrap == null ? null : Json.digest(bootstrap);
        Long epoch = Json.nullableNumber(body, "sessionEpoch");
        String ownership = Json.nullableText(body, "ownershipToken");
        Map<String, Object> previous = store.one("SELECT * FROM device_tokens WHERE device_token=? FOR UPDATE", token);
        Map<String, Object> knownOwner = ownership == null ? null
                : store.one("SELECT * FROM device_tokens WHERE ownership_token::text=? FOR UPDATE", ownership);
        // CAS 재등록에서 자격이 생략되어도 기존 세션 연결을 버리지 않는다.
        if (hash == null && knownOwner != null && user.equals(knownOwner.get("user_id"))) {
            hash = (String) knownOwner.get("bootstrap_hash");
            epoch = knownOwner.get("session_epoch") == null ? null
                    : ((Number) knownOwner.get("session_epoch")).longValue();
        }
        Map<String, Object> session = null;
        if (hash != null) {
            if (epoch == null) {
                throw new NotificationFailure(400, "SESSION_EPOCH_REQUIRED");
            }
            session = store.one("SELECT * FROM session_fences WHERE bootstrap_hash=? FOR UPDATE", hash);
            if (session != null && (!user.equals(session.get("user_id"))
                    || Boolean.TRUE.equals(session.get("revoked"))
                    || epoch < ((Number) session.get("epoch")).longValue())) {
                throw new NotificationFailure(409, "SESSION_REVOKED");
            }
        }
        if (replay) {
            // 저장된 응답을 돌려주기 직전이다. 세 축 검증은 위에서 «지금» 값으로 끝냈고, 소유권은 첫
            // 요청이 이미 옮겼으므로 CAS 는 다시 보지 않는다 — 보면 자기가 성공시킨 등록의 재시도가
            // 제 손으로 회전시킨 소유권에 걸린다.
            return null;
        }
        boolean cas = knownOwner != null && user.equals(knownOwner.get("user_id"))
                && Boolean.TRUE.equals(knownOwner.get("active"))
                && (previous == null || ownership.equals(previous.get("ownership_token").toString()));
        boolean freshBootstrap = hash != null
                && (session == null || !Boolean.TRUE.equals(session.get("used")));
        boolean legacyWindow = !generationRequired && generation == null && hash == null && previous == null
                && ((Number) fence.get("auth_generation")).longValue() == 0;
        if (!cas && !freshBootstrap && !legacyWindow) {
            throw new NotificationFailure(409, "DEVICE_OWNERSHIP_CONFLICT");
        }
        if (hash != null) {
            store.update("INSERT INTO session_fences(bootstrap_hash,user_id,epoch,used) VALUES(?,?,?,true)"
                    + " ON CONFLICT(bootstrap_hash) DO UPDATE SET epoch=GREATEST(session_fences.epoch,EXCLUDED.epoch),"
                    + "used=true", hash, user, epoch);
        }
        UUID next = UUID.randomUUID();
        if (cas && !token.equals(knownOwner.get("device_token"))) {
            // FCM 토큰 회전도 기존 소유권을 확인한 뒤 교체한다.
            store.update("UPDATE device_tokens SET active=false WHERE ownership_token=?",
                    knownOwner.get("ownership_token"));
        }
        store.update("INSERT INTO device_tokens(device_token,user_id,ownership_token,auth_generation,"
                + "bootstrap_hash,session_epoch) VALUES(?,?,?,?,?,?) ON CONFLICT(device_token) DO UPDATE SET "
                + "user_id=EXCLUDED.user_id,ownership_token=EXCLUDED.ownership_token,"
                + "ownership_version=device_tokens.ownership_version+1,auth_generation=EXCLUDED.auth_generation,"
                + "bootstrap_hash=EXCLUDED.bootstrap_hash,session_epoch=EXCLUDED.session_epoch,"
                + "active=true,updated_at=now()",
                token, user, next, generation, hash, epoch);
        return Map.of("ownershipToken", next.toString());
    }

    @Transactional
    public Map<String, Object> delete(UUID user, String token, String owner, Long generation,
            String key) {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("deviceToken", token);
        request.put("ownershipToken", owner);
        request.put("authGeneration", generation);
        return store.command("device-delete:" + user, key, request, () -> {
            deleteLocked(user, token, owner, generation);
            return Map.of("applied", true);
        });
    }

    void deleteLocked(UUID user, String token, String owner, Long generation) {
        store.lock("device-ownership");
        userFence(user);
        if (token != null) {
            // 삭제가 등록보다 먼저 도착해도 행 부재 예외가 다시 열리지 않는다.
            UUID tombstoneOwner = owner == null ? UUID.randomUUID() : UUID.fromString(owner);
            store.update("INSERT INTO device_tokens(device_token,user_id,ownership_token,auth_generation,active)"
                    + " VALUES(?,?,?,?,false) ON CONFLICT DO NOTHING", token, user, tombstoneOwner, generation);
        }
        store.update("UPDATE device_tokens SET active=false,ownership_version=ownership_version+1,updated_at=now()"
                + " WHERE user_id=? AND active AND (?::text IS NULL OR device_token=?)"
                + " AND (?::text IS NULL OR ownership_token::text=?)"
                + " AND (?::bigint IS NULL OR auth_generation IS NULL OR auth_generation<=?)",
                user, token, token, owner, owner, generation, generation);
    }

    void revokeSession(UUID user, Map<String, Object> params) {
        store.lock("device-ownership");
        String hash = Json.nullableText(params, "bootstrapNonceHash");
        long epoch = Json.number(params, "sessionEpoch");
        // 이관된 구 RT 세션은 bootstrap 을 발급한 적이 없다. 폐기할 nonce 도 없으며,
        // 해당 기기 삭제는 Data 가 같은 로그아웃 트랜잭션에 넣은 별도 명령으로 전달한다.
        if (hash == null) {
            return;
        }
        store.update("INSERT INTO session_fences(bootstrap_hash,user_id,epoch,revoked) VALUES(?,?,?,true)"
                + " ON CONFLICT(bootstrap_hash) DO UPDATE SET epoch=GREATEST(session_fences.epoch,EXCLUDED.epoch),"
                + "revoked=true", hash, user, epoch);
        store.update("UPDATE device_tokens SET active=false,updated_at=now() WHERE user_id=? AND bootstrap_hash=?"
                + " AND session_epoch<=?", user, hash, epoch);
    }

    void generation(UUID user, long generation, boolean withdrawn) {
        store.lock("device-ownership");
        userFence(user);
        store.update("UPDATE user_fences SET auth_generation=GREATEST(auth_generation,?),withdrawn=withdrawn OR ?"
                + " WHERE user_id=?", generation, withdrawn, user);
        store.update("UPDATE device_tokens SET active=false WHERE user_id=?"
                + " AND (? OR auth_generation IS NULL OR auth_generation<?)", user, withdrawn, generation);
        if (withdrawn) {
            store.update("UPDATE deliveries SET status='SUPPRESSED' WHERE user_id=?"
                    + " AND status IN ('PENDING','DEFERRED')",
                    user);
            store.update("DELETE FROM projections WHERE user_id=?", user);
        }
    }

    private Map<String, Object> userFence(UUID user) {
        store.update("INSERT INTO user_fences(user_id) VALUES(?) ON CONFLICT DO NOTHING", user);
        return store.one("SELECT * FROM user_fences WHERE user_id=? FOR UPDATE", user);
    }
}
