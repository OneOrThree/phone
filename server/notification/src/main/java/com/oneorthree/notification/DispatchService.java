package com.oneorthree.notification;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * 외부 발송은 이 클래스 한 곳만 호출한다.
 *
 * <p><b>외부 호출은 트랜잭션 «밖»에서 돈다.</b> 판정(게이트 · 소유권 · ack · 적격성)은 짧은 트랜잭션
 * 하나로 끝내고, FCM 호출은 그것이 커밋된 뒤에 한다. 한 사용자의 활성 기기 수만큼 순차로 도는 외부
 * 호출을 트랜잭션 안에 두면 두 가지가 같이 무너진다:
 *
 * <ul>
 *   <li>토큰 하나에 최대 6초({@code FcmTransport} 의 연결 2초 + 읽기 4초)라, FCM 이 느릴 때 활성 기기
 *       열 대면 트랜잭션 상한을 넘긴다. 그 순간 <b>외부 발송은 이미 나갔는데</b>
 *       {@code delivery_devices} 와 {@code SENT} 만 되감겨, 다음 틱이 <b>같은 푸시를 다시 보낸다</b>.</li>
 *   <li>전역 {@code device-ownership} 잠금을 쥔 채 기다리므로 그동안 <b>다른 사용자의</b> 기기
 *       등록·삭제까지 통째로 멈춘다.</li>
 * </ul>
 *
 * <p>대신 <b>펜싱</b>으로 잡는다: 판정 트랜잭션이 커밋되기 전에 보낼 행을 {@link #SEND_LEASE_SECONDS}
 * 만큼 뒤로 물려 발송이 도는 동안 후보로 다시 서지 않게 하고, 기기 한 대의 결과는 그 기기의 호출이
 * 끝나는 즉시 <b>자기 트랜잭션</b>으로 내구화한다. 그래서 도중에 무엇이 터져도 «이미 받은 기기»는 받은
 * 기기로 남고, 재시도는 못 받은 기기에만 간다.
 *
 * <p>판정 잠금을 발송까지 끌고 가지 않아도 ack 계약은 그대로다. 보류(ack prepare)와 발송의 <b>판정</b>은
 * 여전히 같은 사건 잠금 아래에서 직렬화되고, 그 판정이 「보낸다」로 끝난 뒤에 도착한 보류는 예전에도
 * — 잠금이 풀릴 때까지 기다렸다가 — 이미 나간 발송을 되돌리지 못했다. 달라지는 것은 그 보류가
 * 발송이 끝나기를 기다리지 않는다는 것뿐이다.
 *
 * <h2>소유권 펜스</h2>
 * 전역 잠금을 놓는 대신 <b>기기별 펜스</b>를 둔다. 판정 때 기기마다 소유권 세대
 * ({@code user_id · device_key · ownership_version})를 함께 캡처하고, ① 그 기기로 보내기 <b>직전</b>과
 * ② 결과를 적을 때 그 세대가 그대로인지 {@code device_tokens} 행을 <b>잠그고</b> 대조한다. 펜스는 새
 * 잠금이 아니라 등록·삭제·폐기가 이미 잡는 <b>그 행 잠금</b>이라, 전역 잠금 없이도 소유권 변경과
 * 직렬화된다.
 *
 * <p>없으면 이런 일이 난다: 판정이 A 의 토큰을 캡처한 뒤 발송이 도는 사이에 B 가 같은
 * {@code device_token} 을 새 bootstrap 으로 가져가면(계정 이전), <b>새 주인에게 A 의 알림 본문이
 * 전송되고</b> 그 성공이 옛 {@code device_key} 의 이력으로까지 적힌다 — 유출이면서 동시에, 원래
 * 수신자는 「이미 갔다」로 접혀 영영 못 받는다.
 *
 * <p>①이 막는 것은 「소유권이 바뀐 뒤에 캡처된 발송을 실행하는 것」이다. 남는 창은 ①의 커밋과
 * 외부 호출 사이(밀리초)뿐이고, 그 창에 걸린 발송은 ②가 <b>성공으로 적지 않고</b> 재시도로 돌려
 * 원래 수신자의 현재 기기로 다시 보낸다.
 *
 * <h2>왜 이 창을 0 으로 만들지 않는가</h2>
 * 0 으로 만들려면 외부 호출 <b>내내</b> 그 기기의 행 잠금을 쥐어야 한다. 그러면 두 가지가 함께
 * 되돌아온다.
 *
 * <ul>
 *   <li>외부 호출이 다시 트랜잭션 «안»으로 들어간다 — 애초의 P1 이고,
 *       {@code DeviceTransportContinuityTest#theExternalSendRunsWithNoTransactionOpen} 이 그것을
 *       못 하도록 못 박고 있다.</li>
 *   <li>{@code DeviceService#registerLocked} 는 <b>전역 {@code device-ownership} 잠금을 먼저 잡고
 *       그다음 행을 잠근다.</b> 그래서 이 행을 기다리는 등록 하나가 전역 잠금을 쥔 채 서고,
 *       <b>다른 사용자의 등록까지 통째로</b> 그 6초를 기다린다 —
 *       {@code #anotherUsersRegistrationDoesNotWaitForAPushInFlight} 가 막는 바로 그 회귀다.</li>
 * </ul>
 *
 * <p>즉 이 창은 <b>줄일 수는 있어도(prepare→send 수 초 → precheck→send 밀리초) 없앨 수는 없다.</b>
 * 없애는 유일한 방법이 더 큰 두 문제를 되살린다. 그래서 대신 <b>보이게</b> 만든다 — 창에 걸린
 * 발송은 {@code OWNERSHIP_CHANGED} 로 행에 남고 경고 로그를 남긴다. 전송 실패와 같은
 * {@code FCM_RETRY} 로 접으면 그 사실이 재시도 통계에 섞여 사라진다.
 */
@Slf4j
@Service
class DispatchService {

    /** 풀릴 시각을 알 수 없는 보류의 재확인 주기 — 상한을 점거하지 않을 만큼만 미룬다. */
    private static final int HOLD_SECONDS = 30;

    /**
     * 발송 중 펜싱의 길이 — 판정과 상태 맺기 사이에 이 행을 «후보 밖»에 둔다.
     *
     * <p>기기 수 × 토큰당 상한(6초)을 넉넉히 덮어야 한다. 짧으면 아직 외부 호출이 도는 행이 다음 틱의
     * 후보로 다시 서서 같은 푸시가 두 번 나가고, 길면 프로세스가 죽었을 때 회수가 그만큼 늦어진다.
     */
    private static final int SEND_LEASE_SECONDS = 120;

    /** 판정 트랜잭션의 상한 — 외부 호출이 빠졌으므로 DB 작업만 담는다. */
    private static final int PREPARE_TIMEOUT_SECONDS = 30;

    /** 결과를 적는 트랜잭션의 상한 — UPDATE·INSERT 몇 건뿐이다. */
    private static final int RECORD_TIMEOUT_SECONDS = 15;

    /**
     * 「묶음이 다 오기를 기다리는 중」 표식.
     *
     * <p>{@link #retry} 도 행을 {@code PENDING} 인 채로 미래 시각에 세워 둔다(전송 실패·기기 없음).
     * 표식 없이 «미래 시각인 PENDING» 을 전부 되돌리면 그 재시도 backoff 까지 취소해, 실패한 행을
     * 매 tick 다시 때린다. 그래서 이 대기만 표식으로 갈라내고, 되돌릴 때 표식을 지운다.
     */
    private static final String INCOMPLETE = "BUNDLE_INCOMPLETE";

    private final Store store;
    private final SettingsService settings;
    private final DataClient data;
    private final Renderer renderer;
    private final PushTransport transport;
    private final ResultBundleCompletion resultBundles;
    private final Clock clock;
    private final TransactionTemplate preparation;
    private final TransactionTemplate recording;

    DispatchService(Store store, SettingsService settings, DataClient data, Renderer renderer,
            PushTransport transport, Clock clock, PlatformTransactionManager manager,
            ResultBundleCompletion resultBundles) {
        this.store = store;
        this.settings = settings;
        this.data = data;
        this.renderer = renderer;
        this.transport = transport;
        this.resultBundles = resultBundles;
        this.clock = clock;
        // REQUIRES_NEW 로 못 박는다 — 나중에 누가 이 메서드를 트랜잭션 안에서 부르더라도 판정이
        // 그 트랜잭션에 합류해 외부 호출을 다시 감싸는 일이 없도록.
        this.preparation = new TransactionTemplate(manager);
        this.preparation.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.preparation.setTimeout(PREPARE_TIMEOUT_SECONDS);
        this.recording = new TransactionTemplate(manager);
        this.recording.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.recording.setTimeout(RECORD_TIMEOUT_SECONDS);
    }

    List<UUID> candidates() {
        return store.rows("SELECT id FROM deliveries WHERE status IN ('PENDING','DEFERRED')"
                + " AND next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT 25", Timestamp.from(clock.instant()))
                .stream().map(row -> (UUID) row.get("id")).toList();
    }

    /**
     * 후보 한 건(과 같은 묶음에 선 형제들)을 발송한다 — 세 걸음이다.
     *
     * <p>① 판정 트랜잭션에서 보낼 것을 정하고 펜싱까지 걸어 커밋한다. ② 트랜잭션 밖에서 기기마다
     * 외부 호출을 돈다. ③ 기기 하나의 결과는 그 자리에서 자기 트랜잭션에 적고, 마지막에 행 상태를 맺는다.
     *
     * @param id 발송 후보의 delivery id
     */
    public void dispatch(UUID id) {
        Plan plan = preparation.execute(status -> prepare(id));
        if (plan == null) {
            return;
        }
        boolean failed = false;
        boolean fenced = false;
        for (Attempt attempt : plan.attempts()) {
            if (!Boolean.TRUE.equals(recording.execute(status -> renewLease(plan)))) {
                return;
            }
            if (!Boolean.TRUE.equals(recording.execute(status -> stillOurs(attempt)))) {
                // 같은 사용자 기기의 정상 토큰 회전이면 새 토큰에 다시 보내야 한다.
                // 다른 계정으로 이전되거나 삭제된 기기는 더 이상 이 사용자의 수신 대상이 아니다.
                boolean rotated = store.one("SELECT 1 FROM device_tokens WHERE device_key=? AND user_id=?"
                        + " AND active AND NOT transport_invalid", attempt.device(), attempt.user()) != null;
                failed |= rotated;
                fenced |= rotated;
                continue;
            }
            // 여기가 트랜잭션 밖이다 — 몇 초가 걸려도 쥐고 있는 잠금이 없다.
            PushTransport.Result result = transport.send(attempt.token(), attempt.push(), plan.sound(),
                    plan.eventId());
            Outcome outcome = recording.execute(status -> recordAttempt(plan, attempt, result));
            if (outcome == Outcome.LEASE_LOST) {
                return;
            }
            failed |= outcome != Outcome.DONE;
            fenced |= outcome == Outcome.OWNERSHIP_CHANGED;
        }
        boolean retried = failed;
        // 남은 창(대조 커밋 ~ 외부 호출)에 걸린 발송은 FCM 실패와 «원인이 다르다». 같은 FCM_RETRY 로
        // 적으면 그 사실이 재시도 통계에 섞여 사라지고, 사고 조사에서 「남의 기기로 나간 발송이
        // 있었는가」를 물을 방법이 없다. 이유를 갈라 행에 남긴다.
        String reason = fenced ? "OWNERSHIP_CHANGED" : "FCM_RETRY";
        recording.executeWithoutResult(status -> settle(plan, retried, reason));
    }

    /**
     * 판정 — 게이트·소유권·ack·적격성을 한 트랜잭션에서 보고 «보낼 계획»만 들고 나온다.
     *
     * <p>판정의 부수 효과(억제·이월·기다림 표식)는 이 트랜잭션과 함께 커밋된다. 잠금은 커밋과 동시에
     * 풀리므로 외부 호출은 아무 잠금도 쥐지 않은 채 돈다.
     *
     * @param id 발송 후보의 delivery id
     * @return 보낼 계획. 보낼 것이 없으면 {@code null}
     */
    private Plan prepare(UUID id) {
        Map<String, Object> gate = store.one("SELECT enabled FROM dispatch_control WHERE id=1 FOR SHARE");
        if (gate == null || !Boolean.TRUE.equals(gate.get("enabled"))) {
            return null;
        }
        store.lock("device-ownership");
        Map<String, Object> candidate = store.one("SELECT * FROM deliveries WHERE id=?", id);
        if (candidate == null) {
            return null;
        }
        List<Map<String, Object>> rows = bundleCandidates(candidate);
        // 고정 순서: gate → device → ack → delivery. prepare와 flush가 같은 사건 잠금을 쓴다.
        for (Map<String, Object> row : rows) {
            if ("BET_RESULT".equals(row.get("kind")) && row.get("subject_id") != null) {
                store.lock("ack:" + row.get("user_id") + ":" + row.get("subject_id"));
            }
        }
        List<Map<String, Object>> ready = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> delivery = store.one("SELECT * FROM deliveries WHERE id=?"
                    + " AND status IN ('PENDING','DEFERRED') AND next_attempt_at<=? FOR UPDATE SKIP LOCKED",
                    row.get("id"), Timestamp.from(clock.instant()));
            if (delivery != null && eligible(delivery)) {
                ready.add(delivery);
            }
        }
        if (ready.isEmpty()) {
            return null;
        }
        return plan(ready);
    }

    private List<Map<String, Object>> bundleCandidates(Map<String, Object> first) {
        Bundles.Family family = Bundles.of(first.get("kind"));
        if (family == null || first.get("admin_actor") != null || first.get("slot_at") == null
                || first.get("group_id") == null) {
            return List.of(first);
        }
        // 결과 슬롯은 15분 버킷이 닫힌 뒤에만 flush. 모집·종료의 slot은 원래 예정 발송 시각이다.
        if (family.waitsForSlotClose()) {
            Instant closesAt = ((Timestamp) first.get("slot_at")).toInstant()
                    .plusSeconds(Bundles.RESULT_SLOT_SECONDS);
            if (closesAt.isAfter(clock.instant())) {
                holdUntil((UUID) first.get("id"), closesAt);
                return List.of();
            }
        }
        // 상태를 가리지 않고 «축 전체»를 읽는다 — 이미 나간 형제까지 세어야 배치가 다 왔는지 알 수 있다.
        // 실제로 보낼 행은 아래 FOR UPDATE 가 상태·시각으로 다시 고른다.
        List<Map<String, Object>> axis = store.rows("SELECT * FROM deliveries"
                + " WHERE user_id=? AND group_id=? AND slot_at=? AND admin_actor IS NULL AND " + family.predicate()
                + " ORDER BY " + family.order(),
                first.get("user_id"), first.get("group_id"), first.get("slot_at"));
        if (family.waitsForSlotClose()) {
            if (!resultBundles.complete(first, axis)) {
                parkForBatch((UUID) first.get("id"));
                return List.of();
            }
            releaseParked(first, family);
        }
        Set<String> declared = declaredMembers(axis);
        if (!declared.isEmpty()) {
            if (!arrived(axis).containsAll(declared)) {
                // 아직 다 오지 않았다 — «보내지 않고» 뒤로 물린다. 뒤에 선 다른 후보는 그동안 흐른다.
                parkForBatch((UUID) first.get("id"));
                return List.of();
            }
            releaseParked(first, family);
        }
        return axis;
    }

    /**
     * 이 묶음 축에 «어떤 사건들이 올 것»이라고 발송부가 적어 보냈는지 — 기대 대상 id 의 합집합.
     *
     * <p>구 경로의 보장은 「한 배치당 (유저 × 그룹) 한 건」이었다. 신 경로는 그 한 건을 사건 N 개로
     * 쪼개 보내므로, <b>첫 사건만 도착한 사이에 flush 가 끼면 같은 배치가 두 번 나간다</b> — 수신
     * 순서나 relay 의 전달 원자성에 기댈 수 없는 지점이다.
     *
     * <p>개수가 아니라 <b>id 집합</b>으로 판정한다. (유저 × 그룹 × 그날) 축에는 하루 동안 여러 배치가
     * 겹쳐 들어오므로 「몇 건 왔나」는 완전성의 증거가 되지 못한다. 합집합을 쓰는 것은 뒤 배치가
     * 대상을 더할 수 있기 때문이고, 앞 배치가 선언한 대상은 그대로 남아야 하기 때문이다.
     *
     * @param axis 묶음 축의 모든 행(상태 무관)
     * @return 기대 대상 id — 아무도 선언하지 않았으면 빈 집합(기다리지 않는다)
     */
    private static Set<String> declaredMembers(List<Map<String, Object>> axis) {
        Set<String> declared = new LinkedHashSet<>();
        for (Map<String, Object> row : axis) {
            if (Json.map(row.get("payload").toString()).get("bundleMembers") instanceof List<?> members) {
                members.stream().filter(Objects::nonNull).map(Object::toString).forEach(declared::add);
            }
        }
        return declared;
    }

    /**
     * @param axis 묶음 축의 모든 행
     * @return 실제로 도착한 대상 id — 이미 나갔거나({@code SENT}) 걸러진({@code SUPPRESSED}) 형제도
     *     «수신은 됐다». 상태로 거르면 같은 배치가 영원히 미달로 남는다
     */
    private static Set<String> arrived(List<Map<String, Object>> axis) {
        Set<String> received = new LinkedHashSet<>();
        for (Map<String, Object> row : axis) {
            if (row.get("subject_id") != null) {
                received.add(row.get("subject_id").toString());
            }
        }
        return received;
    }

    /**
     * 배치를 기다리느라 «세워 둔» 형제를 다시 세운다 — {@link #INCOMPLETE} 표식이 붙은 행만.
     *
     * <p>기다림은 후보 상한을 비우려고 {@code next_attempt_at} 을 미뤄 둔 것이다. 배치가 다 온 순간
     * 그 시각을 되돌리지 않으면 마지막에 도착한 사건만 발송 대상이 되어, 정작 <b>대표가 빠진 채</b>
     * 한 건이 나간다 — 유실분이 DLT 로 되돌아온 복구 경로가 정확히 그 모양이다.
     *
     * <p>표식이 없는 미래 시각은 되돌리지 않는다: 조용한 시간 이월({@code DEFERRED})은 정책이고,
     * 전송 실패·기기 없음의 재시도 backoff 는 <b>아직 기다려야 할 시간</b>이다.
     */
    private void releaseParked(Map<String, Object> first, Bundles.Family family) {
        store.update("UPDATE deliveries SET next_attempt_at=?,last_error=NULL"
                + " WHERE user_id=? AND group_id=? AND slot_at=? AND admin_actor IS NULL AND " + family.predicate()
                + " AND status='PENDING' AND last_error=?",
                Timestamp.from(clock.instant()), first.get("user_id"), first.get("group_id"),
                first.get("slot_at"), INCOMPLETE);
    }

    /**
     * 묶음이 다 오기를 기다리며 이 행을 뒤로 물린다 — 표식을 남겨 재시도 backoff 와 갈라 둔다.
     *
     * <p>{@code next_attempt_at<=now} 인 행, 즉 «지금 후보로 선 행»만 물린다. 이미 미래에 세워진 행은
     * 재시도 backoff 중이므로 건드리지 않는다 — 그래야 되돌릴 때도 그 backoff 를 깨지 않는다.
     * 시도 횟수는 올리지 않는다. 기다림은 실패가 아니다.
     */
    private void parkForBatch(UUID id) {
        Timestamp now = Timestamp.from(clock.instant());
        store.update("UPDATE deliveries SET next_attempt_at=?,last_error=? WHERE id=?"
                + " AND status='PENDING' AND next_attempt_at<=?",
                Timestamp.from(clock.instant().plusSeconds(HOLD_SECONDS)), INCOMPLETE, id, now);
    }

    private boolean eligible(Map<String, Object> delivery) {
        UUID id = (UUID) delivery.get("id");
        UUID user = (UUID) delivery.get("user_id");
        String kind = delivery.get("kind").toString();
        String subject = (String) delivery.get("subject_id");
        Map<String, Object> catalog = store.one("SELECT * FROM kinds WHERE id=?", kind);
        Map<String, Object> fence = store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", user);
        if (catalog == null || !Boolean.TRUE.equals(catalog.get("enabled"))
                || (fence != null && Boolean.TRUE.equals(fence.get("withdrawn")))) {
            suppress(id);
            return false;
        }
        if ("BET_RESULT".equals(kind) && subject != null) {
            Map<String, Object> ack = store.one("SELECT state,held_until FROM result_ack"
                    + " WHERE user_id=? AND session_id=?", user, UUID.fromString(subject));
            if (ack != null && !"RELEASED".equals(ack.get("state"))) {
                if ("CONFIRMED".equals(ack.get("state"))) {
                    suppress(id);
                    return false;
                }
                // 보류는 «아직 못 보낸다»이지 실패가 아니다. 그대로 두면 이 행이 후보 상한을 계속 점거해
                // 뒤에 선 다른 사용자의 알림과 BET_SILENT_FLUSH 까지 보류가 풀릴 때까지 굶는다.
                // HELD 는 만료 시각까지, 판정 대기(NEEDS_CONFIRM)는 리컨실 주기만큼 이월한다.
                Timestamp until = (Timestamp) ack.get("held_until");
                holdUntil(id, until == null ? clock.instant().plusSeconds(HOLD_SECONDS) : until.toInstant());
                return false;
            }
        }
        Map<String, Object> preferences = settings.read(user);
        Map<String, Object> params = Json.map(delivery.get("payload").toString());
        boolean silent = Boolean.TRUE.equals(catalog.get("silent"));
        if (!silent && !Boolean.TRUE.equals(preferences.get("notificationEnabled"))) {
            suppress(id);
            return false;
        }
        if (!silent && !"BYPASS".equals(catalog.get("quiet_policy"))) {
            Instant quietEnd = QuietHours.endIfQuiet(preferences, clock.instant());
            if (quietEnd != null) {
                deferOrSuppress(id, catalog, params, quietEnd);
                return false;
            }
        }
        // 종류별 대상 상태 판정이 없어도 수신자의 현재 활성 상태는 Data에서 재확인한다.
        // 탈퇴·세대 투영은 지연될 수 있으므로 로컬 fence만으로 발송을 허용할 수 없다.
        // admin_actor는 콘솔 인증 경로만 쓰는 정본 컬럼이다. payload의 adminTest/adminActor는 믿지 않는다.
        // 재전송은 replay_of가 있어 원사건 만료를 계속 따른다.
        boolean adminTest = delivery.get("admin_actor") != null && delivery.get("replay_of") == null;
        boolean allowed = adminTest
                ? data.eligibleTest(user, kind, subject, params, ((Timestamp) delivery.get("created_at")).toInstant())
                : data.eligible(user, kind, subject, params);
        if (!allowed) {
            suppress(id);
            return false;
        }
        int cooldown = ((Number) catalog.get("cooldown_seconds")).intValue();
        if (cooldown > 0 && store.one("SELECT id FROM deliveries WHERE user_id=? AND kind=? AND status='SENT'"
                + " AND sent_at>? LIMIT 1", user, kind,
                Timestamp.from(clock.instant().minusSeconds(cooldown))) != null) {
            suppress(id);
            return false;
        }
        return true;
    }

    /**
     * 보낼 기기와 문구를 확정하고 «발송 중» 펜싱을 건다 — 판정 트랜잭션의 마지막 걸음이다.
     *
     * @param ready 보낼 자격이 확인된 행들
     * @return 트랜잭션 밖으로 들고 나갈 계획. 보낼 기기가 없으면 {@code null}
     */
    private Plan plan(List<Map<String, Object>> ready) {
        UUID user = (UUID) ready.get(0).get("user_id");
        boolean sound = Boolean.TRUE.equals(settings.read(user).get("soundEnabled"));
        // 두 축을 모두 본다: active 는 «소유권이 살아 있는가»(로그아웃·삭제·탈퇴·세션 폐기),
        // transport_invalid 는 «FCM 이 이 토큰을 아직 받는가». 전자만 보면 UNREGISTERED 토큰에
        // 계속 때리고, 후자를 active 에 적으면 정상 세션의 토큰 교체가 막힌다.
        List<Map<String, Object>> tokens = store.rows("SELECT device_token,device_key,ownership_version"
                + " FROM device_tokens WHERE user_id=? AND active AND NOT transport_invalid"
                + " ORDER BY device_token", user);
        List<UUID> deliveries = ready.stream().map(row -> (UUID) row.get("id")).toList();
        if (tokens.isEmpty()) {
            deliveries.forEach(delivery -> retry(delivery, "NO_ACTIVE_DEVICE"));
            return null;
        }
        List<Attempt> attempts = new ArrayList<>();
        for (Map<String, Object> token : tokens) {
            // 중복 방지의 키는 «기기»다. 소유권은 등록마다 회전하므로(A22 ㊚) 그것으로 세면 재시도
            // 사이에 앱을 재시작한 기기가 미전송으로 되돌아가 같은 알림을 두 번 받는다.
            UUID device = (UUID) token.get("device_key");
            List<Map<String, Object>> unsent = ready.stream().filter(row -> store.one(
                    "SELECT 1 FROM delivery_devices WHERE delivery_id=? AND device_key=?",
                    row.get("id"), device) == null).toList();
            if (unsent.isEmpty()) {
                continue;
            }
            // 렌더도 여기서 끝낸다 — 템플릿 조회가 DB 를 타므로 트랜잭션 밖으로 미룰 이유가 없고,
            // 템플릿 부재(TEMPLATE_UNAVAILABLE)는 «보내기 전»에 드러나야 한다.
            RenderedPush push = renderer.renderBundle(unsent);
            try {
                FcmPayload.requireFits(push, sound, collapseEventId(ready));
            } catch (NotificationFailure invalid) {
                if (!"FCM_PAYLOAD_TOO_LARGE".equals(invalid.getMessage())) {
                    throw invalid;
                }
                // 영구 문구 오류는 기기 폐기나 무한 재시도가 아니다. 아직 외부 발송은 시작하지 않았다.
                deliveries.forEach(delivery -> store.update("UPDATE deliveries SET status='FAILED',last_error=?,"
                        + "lease_token=NULL,lease_expires_at=NULL WHERE id=?", invalid.getMessage(), delivery));
                return null;
            }
            attempts.add(new Attempt(user, device, token.get("device_token").toString(),
                    ((Number) token.get("ownership_version")).longValue(), push,
                    unsent.stream().map(row -> (UUID) row.get("id")).toList()));
        }
        // 펜싱. 외부 호출이 도는 동안 이 행들을 후보 밖에 둔다 — 상태를 맺는 것은 settle 이고,
        // 그 전에 프로세스가 죽어도 임대가 끝나기 전에는 다시 집히지 않는다.
        //
        // lease_token·lease_expires_at 을 «함께» 적는 이유는 두 가지다.
        // ① next_attempt_at 만으로는 「발송 중」과 「재시도 backoff」가 구분되지 않는다. 둘 다 미래
        //    시각인 PENDING 이라 밖에서 보면 같은 모양이다.
        // ② 그 구분이 없으면 게이트 닫기(MigrationService.close)가 «진행 중인 발송»을 기다릴 수
        //    없다. 판정 트랜잭션은 이미 커밋됐으므로 게이트 행 잠금은 그 워커를 붙잡지 못한다.
        // retireDelivery 가 「손대지 않은 행」의 정의에 lease_token 을 넣어 둔 것도 같은 뜻이다 —
        // 발송 중인 행은 라이브가 주인이므로 이관이 접으면 안 된다.
        Timestamp lease = Timestamp.from(clock.instant().plusSeconds(SEND_LEASE_SECONDS));
        UUID leaseToken = UUID.randomUUID();
        for (UUID delivery : deliveries) {
            store.update("UPDATE deliveries SET next_attempt_at=GREATEST(next_attempt_at,?),"
                    + "lease_token=?,lease_expires_at=? WHERE id=?", lease, leaseToken, lease, delivery);
        }
        return new Plan(deliveries, sound, collapseEventId(ready), attempts, leaseToken);
    }

    /**
     * 기기 한 대의 결과를 «그 자리에서» 내구화한다 — 이 트랜잭션이 그 발송의 유일한 증거다.
     *
     * <p>묶음 전체를 한 트랜잭션으로 맺으면, 뒤쪽 기기에서 터진 실패가 <b>앞서 성공한 기기의 이력까지</b>
     * 되감는다. 그러면 외부 발송은 이미 나갔는데 못 받은 기기로 되돌아가 재시도가 같은 푸시를 또 보낸다.
     *
     * @param attempt 그 기기로 나간 호출
     * @param result  전송 결과
     * @return 이 호출을 어떻게 맺었는가
     */
    private Outcome recordAttempt(Plan plan, Attempt attempt, PushTransport.Result result) {
        if (!stillOurs(attempt)) {
            // 호출이 도는 사이에 소유권이 바뀌었다. 이미 나간 푸시는 되돌릴 수 없지만, 그 기기의
            // «성공 이력»으로 적으면 원래 수신자는 「이미 갔다」로 접혀 영영 못 받는다. 전송 자격
            // (transport_invalid)도 건드리지 않는다 — 이제 남의 행이다. 재시도로 돌려 지금 활성인
            // 기기로 다시 보낸다.
            //
            // 이 자리가 남은 창의 «유일한 증인»이다. 조용히 재시도로 접으면 운영자는 이런 일이
            // 있었다는 것조차 알 수 없다.
            log.warn("발송 직후 소유권이 바뀐 기기 — 새 주인에게 도달했을 수 있다."
                    + " deviceKey={} user={} 세대={} deliveries={}",
                    attempt.device(), attempt.user(), attempt.ownership(), attempt.deliveries());
            return Outcome.OWNERSHIP_CHANGED;
        }
        if (!holdsLease(plan)) {
            return Outcome.LEASE_LOST;
        }
        if (result == PushTransport.Result.SENT) {
            for (UUID delivery : attempt.deliveries()) {
                store.update("INSERT INTO delivery_devices(delivery_id,device_key) VALUES(?,?)"
                        + " ON CONFLICT DO NOTHING", delivery, attempt.device());
            }
            return Outcome.DONE;
        }
        if (result == PushTransport.Result.UNREGISTERED) {
            // 전송 자격만 내린다. 소유권(active)까지 끄면 앱의 onTokenRefresh 가 그 소유권으로
            // 가져오는 새 토큰이 CAS 에 걸리고(활성 행만 본다) 1회용 자격도 이미 소비되어,
            // 정상 로그인 세션인데도 재로그인 전까지 푸시가 복구되지 않는다.
            store.update("UPDATE device_tokens SET transport_invalid=true,updated_at=now()"
                    + " WHERE device_token=? AND device_key=?", attempt.token(), attempt.device());
            return Outcome.DONE;
        }
        return Outcome.RETRY;
    }

    /** 기기 한 대로 나간 호출의 끝. 재시도 여부뿐 아니라 «왜»까지 가른다. */
    private enum Outcome {
        /** 맺었다 — 성공했거나(SENT) 이 토큰을 더 쓰지 않기로 했다(UNREGISTERED). */
        DONE,
        /** 전송이 실패했다. 같은 기기로 다시 시도한다. */
        RETRY,
        /** 발송 직후 소유권이 바뀌었다. 성공으로 적지 않고 «지금» 주인의 기기로 다시 보낸다. */
        OWNERSHIP_CHANGED,
        /** 임대가 만료되거나 다른 실행자가 재선점했다. */
        LEASE_LOST
    }

    /**
     * 발송이 끝난 행의 상태를 맺는다.
     *
     * @param plan   이번 발송의 계획
     * @param failed 기기 하나라도 재시도가 필요했는가
     * @param reason 재시도로 남길 이유 — 소유권 변경과 전송 실패를 가른다
     */
    private void settle(Plan plan, boolean failed, String reason) {
        if (!holdsLease(plan)) {
            return;
        }
        for (UUID delivery : plan.deliveries()) {
            if (failed) {
                retry(delivery, reason);
            } else if (store.one("SELECT 1 FROM delivery_devices WHERE delivery_id=? LIMIT 1", delivery) == null) {
                // UNREGISTERED는 성공이 아니다. 이 알림의 성공 이력이 전혀 없으면 정상 토큰을
                // 기다린다. 다른 기기에 이미 성공한 알림은 무효 토큰 때문에 다시 보내지 않는다.
                retry(delivery, "NO_ACTIVE_DEVICE");
            } else {
                // 판정 잠금은 이미 풀렸다 — 상태를 다시 걸어, 그사이 탈퇴가 억제한 행을 되살리지 않는다.
                store.update("UPDATE deliveries SET status='SENT',sent_at=?,attempts=attempts+1,"
                        + "last_error=NULL WHERE id=? AND status IN ('PENDING','DEFERRED')",
                        Timestamp.from(clock.instant()), delivery);
            }
            releaseLease(delivery, plan.leaseToken());
        }
    }

    /**
     * 발송 임대를 놓는다 — 이 행으로 도는 외부 호출이 <b>끝났다</b>는 뜻이다.
     *
     * <p>상태를 맺는 것과 같은 트랜잭션이라야 한다. 따로 놓으면 그 사이에 게이트 닫기가 「드레인
     * 완료」로 보고 컷오버가 이어진다. {@link #dispatch(UUID)} 가 예외로 끝나 여기 못 오는 경우는
     * 임대 만료({@link #SEND_LEASE_SECONDS})가 회수한다 — 그때까지는 실제로 결과를 모르는 상태가
     * 맞으므로 드레인도 기다리는 것이 옳다.
     */
    private void releaseLease(UUID id, UUID leaseToken) {
        store.update("UPDATE deliveries SET lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=?",
                id, leaseToken);
    }

    /** 매 기기 호출 전에 갱신한다. 전체 기기 수와 무관하게 진행 중인 발송을 드레인이 추적한다. */
    private boolean renewLease(Plan plan) {
        if (!holdsLease(plan)) {
            return false;
        }
        Timestamp until = Timestamp.from(clock.instant().plusSeconds(SEND_LEASE_SECONDS));
        for (UUID id : plan.deliveries()) {
            store.update("UPDATE deliveries SET lease_expires_at=?,next_attempt_at=GREATEST(next_attempt_at,?)"
                    + " WHERE id=? AND lease_token=?", until, until, id, plan.leaseToken());
        }
        return true;
    }

    /** 행을 잠근 채 현재 임대만 결과 기록·갱신·완료를 할 수 있게 한다. */
    private boolean holdsLease(Plan plan) {
        for (UUID id : plan.deliveries().stream().sorted().toList()) {
            if (store.one("SELECT 1 FROM deliveries WHERE id=? AND lease_token=?"
                    + " AND lease_expires_at>? FOR UPDATE", id, plan.leaseToken(),
                    Timestamp.from(clock.instant())) == null) {
                return false;
            }
        }
        return true;
    }

    /**
     * 캡처한 소유권 세대가 아직 유효한가 — 기기별 펜스.
     *
     * <p>{@code FOR UPDATE} 로 그 행을 잠그고 본다. 등록({@code registerLocked})·삭제·폐기·세대 상향이
     * 모두 같은 행을 잠그므로, 새 잠금을 만들지 않고도 소유권 변경과 <b>직렬화</b>된다. 전역
     * {@code device-ownership} 잠금은 쥐지 않으므로 다른 기기·다른 사용자는 그대로 흐른다.
     *
     * <p>세 축을 모두 본다: {@code user_id}(계정 이전) · {@code device_key}(신원 교체) ·
     * {@code ownership_version}(등록마다 오르는 세대). 로그아웃·삭제·폐기·탈퇴는 {@code active} 가 잡고,
     * 그사이 무효 판정을 받은 토큰은 {@code transport_invalid} 가 잡는다.
     *
     * @param attempt 판정 때 캡처한 호출
     * @return 그 기기가 아직 이 사용자의 같은 세대인가
     */
    private boolean stillOurs(Attempt attempt) {
        return store.one("SELECT 1 FROM device_tokens WHERE device_token=? AND device_key=? AND user_id=?"
                + " AND ownership_version=? AND active AND NOT transport_invalid FOR UPDATE",
                attempt.token(), attempt.device(), attempt.user(), attempt.ownership()) != null;
    }

    /** 기기 한 대로 나갈 외부 호출 하나 — 펜싱의 최소 단위다. 소유권 세대를 함께 들고 다닌다. */
    private record Attempt(UUID user, UUID device, String token, long ownership, RenderedPush push,
            List<UUID> deliveries) {
        Attempt {
            deliveries = List.copyOf(deliveries);
        }
    }

    /** 판정이 끝난 한 번의 발송 — 트랜잭션 밖으로 들고 나갈 값만 담는다. */
    private record Plan(List<UUID> deliveries, boolean sound, String eventId, List<Attempt> attempts,
            UUID leaseToken) {
        Plan {
            deliveries = List.copyOf(deliveries);
            attempts = List.copyOf(attempts);
        }
    }

    private String collapseEventId(List<Map<String, Object>> rows) {
        Map<String, Object> first = rows.get(0);
        Bundles.Family family = Bundles.of(first.get("kind"));
        // 묶음 축과 같은 조건이라야 한다 — 여기만 넓으면 묶이지도 않은 서로 다른 알림이 같은 collapse
        // 키로 나가 트레이에서 서로를 덮는다.
        if (family == null || first.get("slot_at") == null || first.get("admin_actor") != null
                || first.get("group_id") == null) {
            return first.get("event_id").toString();
        }
        return "bundle:" + first.get("user_id") + ":" + first.get("group_id") + ":" + family.id()
                + ":" + ((Timestamp) first.get("slot_at")).toInstant();
    }

    private void deferOrSuppress(UUID id, Map<String, Object> catalog, Map<String, Object> params, Instant quietEnd) {
        String deadline = Json.nullableText(params, "deferExpiresAt");
        if (!"DEFER".equals(catalog.get("quiet_policy"))
                || (deadline != null && !quietEnd.isBefore(Instant.parse(deadline)))) {
            suppress(id);
            return;
        }
        // slot_at은 원래 묶음 사건 축이다. 이월할 때 새로운 슬롯으로 덮지 않는다.
        store.update("UPDATE deliveries SET status='DEFERRED',next_attempt_at=? WHERE id=?",
                Timestamp.from(quietEnd), id);
    }

    /**
     * 후보 한 건의 실패를 «별도 트랜잭션»으로 내구화한다.
     *
     * <p>{@link #dispatch(UUID)} 가 예외로 끝나면 그 트랜잭션은 통째로 되감겨 {@code next_attempt_at}
     * 도 {@code attempts} 도 그대로다. 그 행은 다음 tick 에서도 같은 정렬로 후보 맨 앞에 다시 서고,
     * 그래서 한 종류의 템플릿 비활성화·렌더 입력 누락 하나가 «다른 종류·다른 사용자»의 정상 알림까지
     * 무기한 막는다. 재시도 시각을 밀어 두면 큐가 계속 흐른다.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 30)
    public void backOff(UUID id, String reason) {
        store.update("UPDATE deliveries SET attempts=attempts+1,last_error=?,next_attempt_at=? WHERE id=?"
                + " AND (lease_expires_at IS NULL OR lease_expires_at<=?)", reason,
                Timestamp.from(clock.instant().plusSeconds(60)), id, Timestamp.from(clock.instant()));
    }

    /**
     * 아직 «보낼 수 없을 뿐»인 행을 실제 발송 가능 시각으로 이월한다.
     *
     * <p>{@link #retry}와 달리 {@code attempts}·{@code last_error}를 건드리지 않는다 — 실패가 아니라
     * 기다림이다. 이월하지 않으면 그 행이 후보 정렬(next_attempt_at,id)의 앞자리를 계속 차지해,
     * 상한 25건이 그런 행으로 채워지는 순간 <b>뒤에 선 모든 사용자</b>의 발송이 멈춘다.
     */
    private void holdUntil(UUID id, Instant until) {
        Instant target = until.isAfter(clock.instant()) ? until : clock.instant().plusSeconds(HOLD_SECONDS);
        store.update("UPDATE deliveries SET next_attempt_at=GREATEST(next_attempt_at,?) WHERE id=?"
                + " AND status IN ('PENDING','DEFERRED')", Timestamp.from(target), id);
    }

    private void suppress(UUID id) {
        store.update("UPDATE deliveries SET status='SUPPRESSED' WHERE id=?", id);
    }

    private void retry(UUID id, String reason) {
        store.update("UPDATE deliveries SET attempts=attempts+1,last_error=?,next_attempt_at=? WHERE id=?",
                reason, Timestamp.from(clock.instant().plusSeconds(60)), id);
    }
}
