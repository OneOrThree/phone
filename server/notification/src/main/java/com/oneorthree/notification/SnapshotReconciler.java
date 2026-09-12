package com.oneorthree.notification;

import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 전 유저 리컨실은 Data 조회 3종 중 snapshot 만 쓴다. 설정·토큰 정본을 다시 복사하지 않는다. */
@Service
class SnapshotReconciler {
    private final Store store;
    private final DataClient data;
    private final DeviceService devices;
    private final TransactionTemplate transaction;

    SnapshotReconciler(Store store, DataClient data, DeviceService devices, PlatformTransactionManager manager) {
        this.store = store;
        this.data = data;
        this.devices = devices;
        transaction = new TransactionTemplate(manager);
        transaction.setTimeout(10);
    }

    void reconcile() {
        String cursor = null;
        do {
            Map<String, Object> page = data.snapshot(cursor, 500);
            if (page == null || !(page.get("items") instanceof List<?> items)) {
                throw new NotificationFailure(502, "INVALID_SNAPSHOT_PAGE");
            }
            String next = nextCursor(page, items, cursor);
            for (Object item : items) {
                Map<String, Object> row = Json.map(item);
                transaction.executeWithoutResult(status -> apply(row));
            }
            cursor = next;
        } while (cursor != null);
    }

    /** 페이지 적용 전에 다음 조회가 현재 페이지의 마지막 사용자부터 이어지는지 검증한다. */
    private static String nextCursor(Map<String, Object> page, List<?> items, String previous) {
        if (!page.containsKey("nextCursor")) {
            throw new NotificationFailure(502, "INVALID_SNAPSHOT_CURSOR");
        }
        if (page.get("nextCursor") == null) {
            return null;
        }
        String next = canonicalUuid(page.get("nextCursor"));
        if (items.isEmpty() || (previous != null && next.compareTo(previous) <= 0)) {
            throw new NotificationFailure(502, "SNAPSHOT_CURSOR_DID_NOT_ADVANCE");
        }
        if (!(items.get(items.size() - 1) instanceof Map<?, ?> last)
                || !next.equals(canonicalUuid(last.get("userId")))) {
            throw new NotificationFailure(502, "INVALID_SNAPSHOT_CURSOR");
        }
        return next;
    }

    private static String canonicalUuid(Object value) {
        if (value instanceof String text) {
            try {
                String canonical = UUID.fromString(text).toString();
                if (canonical.equalsIgnoreCase(text)) {
                    return canonical;
                }
            } catch (IllegalArgumentException invalid) {
                throw new NotificationFailure(502, "INVALID_SNAPSHOT_CURSOR");
            }
        }
        throw new NotificationFailure(502, "INVALID_SNAPSHOT_CURSOR");
    }

    private void apply(Map<String, Object> row) {
        UUID user = Json.uuid(row, "userId");
        long generation = Json.number(row, "authGeneration");
        boolean withdrawn = Json.bool(row, "withdrawn");
        store.lock("device-ownership");
        if (withdrawn || generation > 0) {
            devices.generation(user, generation, withdrawn);
        }
        Map<String, Object> fence = store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", user);
        if (fence != null && Boolean.TRUE.equals(fence.get("withdrawn"))) {
            return;
        }
        store.update("INSERT INTO projections(projection_type,user_id,version,payload)"
                + " VALUES('user.snapshot',?,?,?::jsonb) ON CONFLICT(projection_type,user_id,subject_id)"
                + " DO UPDATE SET version=EXCLUDED.version,payload=EXCLUDED.payload"
                + " WHERE projections.version<EXCLUDED.version", user, Json.number(row, "version"), Json.write(row));
    }
}
