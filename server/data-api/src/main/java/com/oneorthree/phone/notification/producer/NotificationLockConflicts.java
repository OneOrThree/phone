package com.oneorthree.phone.notification.producer;

import java.sql.SQLException;
import java.util.Set;

/**
 * PostgreSQL 이 트랜잭션 «전체»를 되돌린 뒤 올리는 잠금 충돌 — 같은 입력으로 새 트랜잭션에서 다시 돌 수 있는 실패다
 * (GROMO-893).
 *
 * <p>{@code 40001}(직렬화 실패)과 {@code 40P01}(교착 희생자) 둘이다. 조각 쓰기와 배치 재시도가 같은 판정을 써야 한다 —
 * 한쪽만 교착을 모르면 조각이 소진된 뒤 배치가 엉뚱하게 다시 판정하거나, 반대로 멀쩡히 다시 쓸 수 있는 조각을 포기한다.
 */
public final class NotificationLockConflicts {

    private static final Set<String> SQL_STATES = Set.of("40001", "40P01");

    private NotificationLockConflicts() {
    }

    /**
     * @param failure 실패
     * @return 원인 사슬에서 찾은 {@code 40001}·{@code 40P01}. 잠금 충돌이 아니면 {@code null}
     */
    public static String sqlStateOf(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql && SQL_STATES.contains(sql.getSQLState())) {
                return sql.getSQLState();
            }
        }
        return null;
    }
}
