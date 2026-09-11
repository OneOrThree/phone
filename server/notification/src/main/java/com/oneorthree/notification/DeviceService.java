package com.oneorthree.notification;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
class DeviceService {

    private static final Logger LOG = LoggerFactory.getLogger(DeviceService.class);

    /**
     * 소유권 값의 <b>정규</b> 표기(8-4-4-4-12). {@code UUID.fromString} 을 그대로 쓰면 안 된다 —
     * 그 파서는 {@code "1-1-1-1-1"} 같은 축약형도 받아 들여 «정규 표기로 다시 쓰면 다른 문자열»이
     * 되는 값을 통과시킨다. 소유권은 앱이 보관했다가 그대로 되싣는 CAS 값이라, 같은 소유권이
     * 표기에 따라 둘로 갈리면 CAS 비교(문자열 대조)가 조용히 어긋난다.
     */
    private static final Pattern CANONICAL_UUID = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

    private final Store store;
    private final boolean generationRequired;
    private final boolean legacyRegistrationAllowed;

    /**
     * 롤아웃 축은 <b>둘이고 서로 독립</b>이다 — 하나로 묶으면 구 앱 호환이 세대 게이트에 끌려다닌다.
     *
     * <ul>
     *   <li>{@code generation-required}: <b>AT 축</b>. {@code gen} claim 이 없는 AT 를 언제부터 거절하는가.
     *       구 AT 가 모두 만료된 뒤 켠다.</li>
     *   <li>{@code legacy-device-registration}: <b>앱 축</b>. 소유권·세션 자격을 싣지 않는 구 앱의 등록을
     *       계속 받아 줄 것인가. 구 앱 사용자가 충분히 빠진 뒤 끈다(단계 ③ = 둘 다 전환).</li>
     * </ul>
     *
     * <p>둘을 한 조건으로 묶으면 「AT 에 gen 이 있다 = 앱이 소유권 프로토콜을 지원한다」가 되는데,
     * <b>그 둘은 다른 축이다</b>: 구 앱도 새 {@code AuthService} 가 발급한 {@code gen} 을 그대로 싣고
     * 다닌다(토큰은 서버가 만들고, 본문은 앱이 만든다).
     */
    DeviceService(Store store, @Value("${notification.generation-required:false}") boolean generationRequired,
            @Value("${notification.legacy-device-registration:true}") boolean legacyRegistrationAllowed) {
        this.store = store;
        this.generationRequired = generationRequired;
        this.legacyRegistrationAllowed = legacyRegistrationAllowed;
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
        requireCanonicalOwnership(Json.nullableText(body, "ownershipToken"));
        return store.command("device-register:" + user, key, intent(body),
                () -> registerLocked(user, body, false), false, () -> registerLocked(user, body, true));
    }

    /**
     * 앱이 실어 보낸 소유권 값의 형식 검사 — <b>동기 경로에서만</b> 쓴다.
     *
     * <p>소유권은 우리가 {@code UUID.randomUUID()} 로 발급해 돌려준 값이고 열도 {@code uuid} 다.
     * 정규 표기가 아닌 값은 어느 행에도 맞지 않으므로 이 요청은 «CAS 가 깨진 요청»이지
     * «소유권 없는 요청»이 아니다 — 그래서 값을 버려 {@code null}(= CAS 검사 없음)로 접지 않고
     * 여기서 거절한다. 접으면 방금 재등록된 기기까지 지우는 넓은 삭제가 된다(A22 ㊚).
     *
     * <p>이 검사가 <b>내구 기록보다 앞</b>이라는 것이 핵심이다. Business 가 Data outbox 에 먼저
     * 적고(㊲) relay 가 그 봉투를 여기로 보내므로, 형식이 깨진 값이 봉투에 실리면 그 유저의
     * 순서 축이 통째로 막힌다(A18 고갈 처리 없음).
     */
    private static void requireCanonicalOwnership(String ownership) {
        if (ownership != null && !CANONICAL_UUID.matcher(ownership).matches()) {
            throw new NotificationFailure(400, "INVALID_ownershipToken");
        }
    }

    /**
     * 멱등 비교 기준. {@code authGeneration} 은 남긴다 — 세대가 오른 등록은 「같은 의도」가 아니라
     * 이미 폐기된 등록이고, 그 재생은 죽은 기기 행에 성공을 돌려주게 된다.
     */
    private Map<String, Object> intent(Map<String, Object> body) {
        Map<String, Object> intent = new LinkedHashMap<>(body);
        intent.remove("sessionEpoch");
        // 세대 «없음»과 «0» 은 멱등 비교에서만 같게 본다. 첫 시도가 구 AT(gen 없음)로 나가고 응답만
        // 유실된 뒤, 만료된 AT 를 갱신한 재시도는 승격된 AT 의 gen=0 을 싣고 같은 키로 온다 — 그 둘을
        // 다르게 보면 같은 의도의 첫 재시도가 영구 IDEMPOTENCY_KEY_CONFLICT 다.
        //
        // 인증·fence 입력은 그대로 둔다(아래 registerLocked 는 body 를 본다). 거기서 null 을 0 으로
        // 채우면 로그아웃 전에 발급된 AT 가 「세대 0 을 가진 요청」이 되어 tombstone 을 우회한다(㊍).
        // 높은 세대는 여전히 다른 의도다 — 1 과 0 은 섞이지 않는다.
        if (intent.get("authGeneration") == null) {
            intent.put("authGeneration", 0L);
        }
        return intent;
    }

    private Map<String, Object> registerLocked(UUID user, Map<String, Object> body, boolean replay) {
        store.lock("device-ownership");
        Map<String, Object> fence = userFence(user);
        Long generation = Json.nullableNumber(body, "authGeneration");
        if (Boolean.TRUE.equals(fence.get("withdrawn")) || (generationRequired && generation == null)
                || staleGeneration(generation, fence)) {
            throw new NotificationFailure(409, "STALE_AUTH_GENERATION");
        }
        String token = Json.text(body, "deviceToken");
        String bootstrap = Json.nullableText(body, "deviceBootstrap");
        String hash = bootstrap == null ? null : Json.digest(bootstrap);
        Long epoch = Json.nullableNumber(body, "sessionEpoch");
        String ownership = Json.nullableText(body, "ownershipToken");
        // 구 앱 세션 축. 자격을 저장하지 않는 앱이라 1회용 자격 대신 «서명된 sid» 로 세션을 건다 —
        // Business 가 Data 에 그 sid 의 활성을 동기 확인한 뒤에만 실어 보낸다(A22 ㋤ 구 앱 경로).
        UUID legacySession = Json.nullableText(body, "legacySessionId") == null ? null
                : Json.uuid(body, "legacySessionId");
        Map<String, Object> previous = store.one("SELECT * FROM device_tokens WHERE device_token=? FOR UPDATE", token);
        Map<String, Object> knownOwner = ownership == null ? null
                : store.one("SELECT * FROM device_tokens WHERE ownership_token::text=? FOR UPDATE", ownership);
        // CAS 재등록에서 자격이 생략되어도 기존 세션 연결을 버리지 않는다 — 구 앱 세션 축도 같다.
        if (hash == null && knownOwner != null && user.equals(knownOwner.get("user_id"))) {
            hash = (String) knownOwner.get("bootstrap_hash");
            epoch = knownOwner.get("session_epoch") == null ? null
                    : ((Number) knownOwner.get("session_epoch")).longValue();
            if (legacySession == null) {
                legacySession = (UUID) knownOwner.get("legacy_session_id");
            }
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
        Map<String, Object> legacyFence = null;
        List<Map<String, Object>> legacyLinked = List.of();
        boolean legacyLinkedActive = false;
        if (hash == null && legacySession != null) {
            if (epoch == null) {
                throw new NotificationFailure(400, "SESSION_EPOCH_REQUIRED");
            }
            legacyFence = store.one("SELECT * FROM legacy_session_fences WHERE session_id=? FOR UPDATE",
                    legacySession);
            if (legacyFence != null && (!user.equals(legacyFence.get("user_id"))
                    || Boolean.TRUE.equals(legacyFence.get("revoked"))
                    || epoch < ((Number) legacyFence.get("epoch")).longValue())) {
                throw new NotificationFailure(409, "SESSION_REVOKED");
            }
            // 구 앱엔 ownership 이 없다. 「이 세션의 기기」를 찾는 유일한 길이 sid 링크다.
            legacyLinked = store.rows("SELECT device_token,device_key FROM device_tokens"
                    + " WHERE user_id=? AND legacy_session_id=? AND active FOR UPDATE",
                    user, legacySession);
            legacyLinkedActive = !legacyLinked.isEmpty();
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
        // 구 앱 세션 창. 판정 기준은 «AT 에 gen 이 실렸는가»가 아니라 «요청이 무엇을 근거로 오는가»다.
        // 구 앱도 새 AuthService 가 발급한 AT 를 쓰므로 gen=0 을 싣고 오지만, 로그인·refresh 응답의
        // deviceBootstrap 은 저장하지 않고 여전히 {deviceToken} 만 보낸다. gen 유무를 프로토콜 지원
        // 판정에 쓰면 그 앱의 신규 등록과 FCM 토큰 회전이 전부 거절된다.
        //
        // 대신 서명된 sid 가 근거다. 처음 쓰는 세션만 자격 없는 구 행을 가져오거나 되살릴 수 있고
        // (새 로그인 = 새 sid), 이미 쓴 세션은 «자기 활성 행»이 남아 있을 때만 같은 기기의 토큰 회전을
        // 이어 간다 — 삭제 tombstone 뒤에 새 토큰으로 부활하는 길을 닫는다.
        boolean legacyFirstUse = legacyFence == null || !Boolean.TRUE.equals(legacyFence.get("used"));
        boolean legacySessionWindow = legacyRegistrationAllowed && hash == null && legacySession != null
                && ownership == null
                && (legacyFirstUse ? legacyTakeover(previous)
                        : legacyLinkedActive && legacyRotation(previous, user, legacySession));
        // sid 도 없는 구 AT(이 배포 전 발급분)만 남는 제한된 창. AT 최대 수명으로 노출이 한정된다.
        boolean legacyWindow = legacyRegistrationAllowed && ownership == null && hash == null
                && legacySession == null && legacyRow(previous, user);
        if (!cas && !freshBootstrap && !legacySessionWindow && !legacyWindow) {
            throw new NotificationFailure(409, "DEVICE_OWNERSHIP_CONFLICT");
        }
        if (hash != null) {
            store.update("INSERT INTO session_fences(bootstrap_hash,user_id,epoch,used) VALUES(?,?,?,true)"
                    + " ON CONFLICT(bootstrap_hash) DO UPDATE SET epoch=GREATEST(session_fences.epoch,EXCLUDED.epoch),"
                    + "used=true", hash, user, epoch);
        }
        if (hash == null && legacySession != null) {
            store.update("INSERT INTO legacy_session_fences(session_id,user_id,epoch,used) VALUES(?,?,?,true)"
                    + " ON CONFLICT(session_id) DO UPDATE SET"
                    + " epoch=GREATEST(legacy_session_fences.epoch,EXCLUDED.epoch),used=true",
                    legacySession, user, epoch);
            // 같은 세션의 토큰 회전 — 구 앱엔 ownership 이 없으므로 sid 링크로 옛 행을 접는다.
            // 접지 않으면 한 로그인이 활성 기기 행을 여러 개 남기고, 그만큼 중복 푸시가 된다.
            store.update("UPDATE device_tokens SET active=false,ownership_version=ownership_version+1,"
                    + "updated_at=now() WHERE user_id=? AND legacy_session_id=? AND active AND device_token<>?",
                    user, legacySession, token);
        }
        UUID next = UUID.randomUUID();
        UUID deviceKey = deviceIdentity(user, previous, cas ? knownOwner : null, legacySessionWindow ? legacyLinked
                : List.of());
        if (cas && !token.equals(knownOwner.get("device_token"))) {
            // FCM 토큰 회전도 기존 소유권을 확인한 뒤 교체한다.
            store.update("UPDATE device_tokens SET active=false WHERE ownership_token=?",
                    knownOwner.get("ownership_token"));
        }
        // transport_invalid 는 여기서 반드시 내린다 — 새 토큰(또는 다시 올라온 같은 토큰)은 «아직
        // 거절당한 적 없는» 전송 자격이다. 남겨 두면 등록은 성공했는데 발송 대상에서는 빠진다.
        store.update("INSERT INTO device_tokens(device_token,user_id,ownership_token,device_key,auth_generation,"
                + "bootstrap_hash,session_epoch,legacy_session_id) VALUES(?,?,?,?,?,?,?,?)"
                + " ON CONFLICT(device_token) DO UPDATE SET "
                + "user_id=EXCLUDED.user_id,ownership_token=EXCLUDED.ownership_token,"
                + "device_key=EXCLUDED.device_key,"
                + "ownership_version=device_tokens.ownership_version+1,auth_generation=EXCLUDED.auth_generation,"
                + "bootstrap_hash=EXCLUDED.bootstrap_hash,session_epoch=EXCLUDED.session_epoch,"
                + "legacy_session_id=EXCLUDED.legacy_session_id,active=true,transport_invalid=false,imported_by=NULL,"
                + "updated_at=now()",
                token, user, next, deviceKey, generation, hash, epoch, legacySession);
        return Map.of("ownershipToken", next.toString());
    }

    /**
     * 이 등록이 가리키는 <b>기기 신원</b>. 소유권({@code ownership_token})은 매 등록마다 회전해야
     * 낡은 CAS·낡은 삭제를 걸러 낼 수 있지만(A22 ㊚), 「이 알림이 이 기기에 이미 갔는가」는 그
     * 회전과 <b>다른 축</b>이다. 두 축을 한 값으로 쓰면 부분 전송 실패의 재시도 사이에 앱을 재시작한
     * 기기가 미전송으로 되돌아가 같은 알림을 두 번 받는다.
     *
     * <p>이어받는 자리는 <b>승인된 같은 기기</b>뿐이다 — 같은 계정의 같은 FCM 토큰 행(재등록),
     * CAS 로 확인된 소유권의 토큰 회전, 그리고 sid 로 확인된 구 앱 세션의 토큰 회전. 계정이 바뀌는
     * 이관은 이어받지 않는다: 남의 전송 이력을 물려받으면 새 주인이 못 받은 알림이 받은 것이 된다.
     */
    private UUID deviceIdentity(UUID user, Map<String, Object> previous, Map<String, Object> owner,
            List<Map<String, Object>> legacyLinked) {
        if (previous != null && user.equals(previous.get("user_id"))) {
            return (UUID) previous.get("device_key");
        }
        if (owner != null) {
            return (UUID) owner.get("device_key");
        }
        // 구 앱 세션의 회전. 등록마다 «자기 세션의 다른 활성 행»을 접으므로 링크는 한 행이다 —
        // 여러 행이 보이면 어느 것이 이 기기인지 알 수 없으니 이어받지 않는다.
        if (legacyLinked.size() == 1) {
            return (UUID) legacyLinked.get(0).get("device_key");
        }
        return UUID.randomUUID();
    }

    @Transactional
    public Map<String, Object> delete(UUID user, String token, String owner, Long generation,
            String key) {
        // 멱등 원장에 담기 «전»이다. 담은 뒤에 거절하면 깨진 값이 request_hash 로 굳어, 같은 키로
        // 다시 오는 «고친» 재시도가 IDEMPOTENCY_KEY_CONFLICT 로 영구히 막힌다.
        requireCanonicalOwnership(owner);
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("deviceToken", token);
        request.put("ownershipToken", owner);
        request.put("authGeneration", generation);
        return store.command("device-delete:" + user, key, request, () -> {
            deleteLocked(user, token, owner, generation);
            return Map.of("applied", true);
        });
    }

    /**
     * 삭제의 실제 반영. <b>이미 내구화된 봉투</b>도 여기로 들어온다({@code InboundService} 의
     * {@code notification.deviceToken.deleted}) — 그래서 동기 경로와 달리 형식이 깨진 소유권을
     * <b>거절하지 않는다</b>.
     *
     * <p>세 갈래 중 하나를 골라야 한다.
     * <ul>
     *   <li><b>예외</b>: relay 는 고갈 처리가 없어(A18) 그 행을 최대 백오프로 영원히 재시도하고,
     *       순서 축별로 가장 낮은 미전달 하나만 후보가 되므로 <b>그 유저의 뒤 이벤트가 전부 막힌다</b>.
     *       세션 폐기·탈퇴 tombstone 까지 같이 막히니 가장 나쁘다.</li>
     *   <li><b>{@code null} 로 접기</b>: 소유권 검사가 사라져 그 사이 재등록된 <b>지금 기기</b>까지
     *       지운다. 낡은 삭제를 거르라고 둔 CAS 를 낡은 삭제가 우회하는 꼴이다(㊚).</li>
     *   <li><b>아무 행에도 맞지 않는 소유권으로 소비</b>(여기): 뜻 그대로다. 깨진 CAS 는 어떤 행과도
     *       일치하지 않으므로 <b>아무것도 바꾸지 않고</b> 봉투만 소비한다. tombstone 도 남기지
     *       않는다 — 소유권이 맞지 않는 삭제는 그 토큰을 죽일 자격이 없다.</li>
     * </ul>
     */
    void deleteLocked(UUID user, String token, String owner, Long generation) {
        if (owner != null && !CANONICAL_UUID.matcher(owner).matches()) {
            LOG.warn("기기 토큰 삭제 — 소유권 값의 형식이 깨졌다. 어느 행에도 맞지 않으므로 아무것도 지우지 않고"
                    + " 소비한다. userId={}", user);
            return;
        }
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

    /**
     * 세션 폐기 — <b>두 축을 모두</b> 끊는다. 자격 축은 nonce 해시로, 구 앱 축은 sid 로 잇는다.
     * 이벤트에는 둘 다 실려 오므로(Data {@code appendSessionRevoked}) Data 계약을 바꿀 일이 없다.
     *
     * <p>구 앱 축이 없던 동안에는 nonce 가 없는 세션의 폐기가 <b>아무 기기도 끊지 못했다</b> — 그 앱의
     * 등록 행은 어느 세션에도 묶여 있지 않았고, 개별 로그아웃은 유저 세대를 올리지 않기 때문이다(㊼).
     */
    void revokeSession(UUID user, Map<String, Object> params) {
        store.lock("device-ownership");
        String hash = Json.nullableText(params, "bootstrapNonceHash");
        long epoch = Json.number(params, "sessionEpoch");
        if (hash != null) {
            store.update("INSERT INTO session_fences(bootstrap_hash,user_id,epoch,revoked) VALUES(?,?,?,true)"
                    + " ON CONFLICT(bootstrap_hash) DO UPDATE SET epoch=GREATEST(session_fences.epoch,"
                    + "EXCLUDED.epoch),revoked=true", hash, user, epoch);
            store.update("UPDATE device_tokens SET active=false,updated_at=now() WHERE user_id=? AND bootstrap_hash=?"
                    + " AND session_epoch<=?", user, hash, epoch);
        }
        if (Json.nullableText(params, "sessionId") == null) {
            return;
        }
        // 구 앱 축. tombstone 을 남겨야 폐기 뒤 도착한 지연 등록이 「처음 쓰는 세션」 행세를 못 한다.
        UUID session = Json.uuid(params, "sessionId");
        store.update("INSERT INTO legacy_session_fences(session_id,user_id,epoch,revoked) VALUES(?,?,?,true)"
                + " ON CONFLICT(session_id) DO UPDATE SET epoch=GREATEST(legacy_session_fences.epoch,"
                + "EXCLUDED.epoch),revoked=true", session, user, epoch);
        store.update("UPDATE device_tokens SET active=false,updated_at=now() WHERE user_id=?"
                + " AND legacy_session_id=? AND session_epoch<=?", user, session, epoch);
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
            store.update("DELETE FROM settings WHERE user_id=?", user);
        }
    }

    /**
     * 유저 축 tombstone 대조. {@code gen} 을 실은 요청은 값으로 정렬하고, <b>싣지 못한</b> 요청은
     * 「세대가 한 번도 오르지 않은 유저」에게만 통한다 — 정렬할 수 없는 요청을 세대가 오른 유저에게
     * 허용하면 폐기된 로그인의 지연 등록이 tombstone 을 넘어간다.
     *
     * <p>이 판정이 창 계산이 아니라 <b>맨 앞</b>에 있는 이유: 재생(replay)은 창 계산에 닿기 전에
     * 저장된 응답으로 빠져나간다. 창 쪽에만 두면 세대가 오른 뒤 온 gen 없는 재시도가 이미 죽은 기기
     * 행에 대해 옛 성공 응답을 받는다.
     */
    private boolean staleGeneration(Long generation, Map<String, Object> fence) {
        long current = ((Number) fence.get("auth_generation")).longValue();
        return generation == null ? current > 0 : generation < current;
    }

    /**
     * <b>처음 쓰는</b> 구 앱 세션이 손댈 수 있는 행. 행이 없거나(최초 등록 · 토큰 회전), 자격에 묶이지
     * 않은 구 행이면 된다 — 비활성 행의 부활과 다른 계정으로의 이전도 여기에 들어간다. 근거는 이
     * 기기에서 <b>지금 살아 있는 로그인</b>이고(Data 가 동기 확인했다), 새 로그인은 새 sid 를 받으므로
     * 「한 번 쓴 세션」과 구분된다.
     *
     * <p>{@code bootstrap_hash} 가 있는 현대 행은 제외다 — 자격 없는 요청이 소유권 · CAS 를 우회하는
     * 자리가 되어선 안 된다.
     */
    private boolean legacyTakeover(Map<String, Object> previous) {
        return previous == null || previous.get("bootstrap_hash") == null;
    }

    /**
     * <b>이미 쓴</b> 구 앱 세션이 이어 갈 수 있는 것은 같은 기기의 토큰 회전뿐이다. 새 토큰(행 부재)은
     * 호출부에서 «그 세션의 활성 행이 남아 있을 때»만 허용하고, 기존 행은 자기 세션의 활성 행이어야
     * 한다.
     *
     * <p>이 좁힘이 닫는 구멍: 로그아웃·삭제로 그 세션의 기기가 전부 비활성이 된 뒤 같은 sid 로 오는
     * 등록. 허용하면 삭제가 새 FCM 토큰 하나로 되돌아간다. 복구는 <b>새 로그인의 새 sid</b> 로만 한다.
     */
    private boolean legacyRotation(Map<String, Object> previous, UUID user, UUID legacySession) {
        return previous == null
                || (previous.get("bootstrap_hash") == null && user.equals(previous.get("user_id"))
                        && Boolean.TRUE.equals(previous.get("active"))
                        && legacySession.equals(previous.get("legacy_session_id")));
    }

    /**
     * sid 도 실리지 않은 구 AT 의 제한된 창에서, 이 등록이 <b>남의 것을 가져가지 않는가</b>. 행이 없는
     * 경우(최초 등록 · FCM 토큰 회전)와, 이미 자기 것이면서 세션에 묶이지 않은 활성 행의 재등록만
     * 허용한다(구 앱은 실행할 때마다 같은 토큰을 다시 올린다).
     *
     * <p>제외하는 것이 보장이다: <b>비활성 행</b>은 로그아웃 · 탈퇴 · 삭제가 남긴 tombstone 이라 구 앱
     * 모양 요청으로 되살릴 수 없고, <b>bootstrap_hash 가 있는 행</b>은 현대 앱이 세션 축에 묶어 둔
     * 등록이라 자격 없는 요청이 소유권 · CAS 를 우회하지 못한다. 남의 유저 행도 물론 제외다.
     */
    private boolean legacyRow(Map<String, Object> previous, UUID user) {
        return previous == null
                || (user.equals(previous.get("user_id")) && Boolean.TRUE.equals(previous.get("active"))
                        && previous.get("bootstrap_hash") == null && previous.get("legacy_session_id") == null);
    }

    private Map<String, Object> userFence(UUID user) {
        // 세 호출부 모두 device-ownership 다음이며, 실제 행보다 앞에서 설정과 상태를 직렬화한다.
        store.lock("user-state:" + user);
        store.update("INSERT INTO user_fences(user_id) VALUES(?) ON CONFLICT DO NOTHING", user);
        return store.one("SELECT * FROM user_fences WHERE user_id=? FOR UPDATE", user);
    }
}
