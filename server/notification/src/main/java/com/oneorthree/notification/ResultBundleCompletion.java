package com.oneorthree.notification;

import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Data가 봉인한 기대 사건이 모두 내구 수신된 뒤에만 결과 묶음을 발송한다. */
@Component
class ResultBundleCompletion {

    private final Store store;

    ResultBundleCompletion(Store store) {
        this.store = store;
    }

    void accept(Envelope event) {
        UUID group = Json.uuid(event.params(), "groupId");
        Timestamp slot = Timestamp.from(Instant.parse(Json.text(event.params(), "slotAt")));
        Object raw = event.params().get("eventIds");
        if (!(raw instanceof List<?> list) || list.isEmpty()
                || list.stream().anyMatch(item -> !(item instanceof String value) || value.isBlank())) {
            throw new NotificationFailure(422, "INVALID_RESULT_BUNDLE_MEMBERS");
        }
        List<String> members = list.stream().map(Object::toString).distinct().sorted().toList();
        store.lock("device-ownership");
        Map<String, Object> previous = store.one("SELECT event_ids::text FROM result_bundle_manifests"
                + " WHERE user_id=? AND group_id=? AND slot_at=?", event.userId(), group, slot);
        if (previous != null && !members.equals(readMembers(previous.get("event_ids")))) {
            throw new NotificationFailure(409, "RESULT_BUNDLE_MANIFEST_CONFLICT");
        }
        store.update("INSERT INTO result_bundle_manifests(user_id,group_id,slot_at,event_ids) VALUES(?,?,?,?::jsonb)"
                + " ON CONFLICT DO NOTHING", event.userId(), group, slot, Json.write(members));
    }

    boolean complete(Map<String, Object> first, List<Map<String, Object>> axis) {
        Map<String, Object> manifest = store.one("SELECT event_ids::text FROM result_bundle_manifests"
                + " WHERE user_id=? AND group_id=? AND slot_at=?", first.get("user_id"),
                first.get("group_id"), first.get("slot_at"));
        if (manifest == null) {
            return false;
        }
        Set<String> arrived = new LinkedHashSet<>();
        axis.forEach(row -> arrived.add(row.get("event_id").toString()));
        Set<String> expected = new LinkedHashSet<>(readMembers(manifest.get("event_ids")));
        // 집합 확대도 계약 위반이다. 나중 사건을 별도 푸시로 흘려보내지 않는다.
        return arrived.equals(expected);
    }

    private static List<String> readMembers(Object json) {
        Object parsed = Json.map("{\"members\":" + json + "}").get("members");
        return ((List<?>) parsed).stream().map(Object::toString).distinct().sorted().toList();
    }
}
