package com.oneorthree.phone.notification.producer;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 수신자·종류·대상·원본 발생 시각으로 결정적 사건 키를 만든다. */
public final class NotificationEventKey {

    /** 접두어 — outbox 전역에서 알림 사건이 다른 사건과 섞이지 않게 한다. */
    public static final String PREFIX = "noti";

    /** 값이 없는 축의 자리표. 빈 문자열을 쓰면 구분자가 붙어 «::» 가 되어 읽기도 비교도 어려워진다. */
    static final String ABSENT = "none";

    private NotificationEventKey() {
    }

    /**
     * 결정적 키를 만든다.
     *
     * @param kind      알림 종류
     * @param userId    수신자 하나 — fan-out 은 이미 펼쳐진 뒤다
     * @param subjectId 사건 대상. 대상이 없는 kind 는 {@code null}
     * @param occurredAt 사건의 원본 발생 시각
     * @return 결정적 사건 키
     * @throws IllegalArgumentException 시간축이 있는 kind 인데 원본 시각이 없을 때 — 「없으면 지금」으로
     *     접으면 같은 원인의 재처리가 <b>다른 키</b>가 되어 멱등이 통째로 무너진다
     */
    public static String of(NotificationKind kind, UUID userId, UUID subjectId, Instant occurredAt) {
        return key(kind, userId, subjectId, axisOf(kind, userId, occurredAt).bucketOf(occurredAt));
    }

    /**
     * 중복 판정에서 <b>대조할 키 전부</b> — 첫 원소는 {@link #of} 가 만드는 «쓰기 키»다.
     *
     * <p>시간축이 고정 버킷이면 같은 사건이 버킷 경계에서 갈릴 수 있다. 그때 쓰기 키 하나만 조회하면
     * 「없다」가 나와 같은 사건이 두 번 적히고 <b>푸시가 두 번</b> 나간다. 어느 축이 얼마만큼 넓게
     * 대조하는지는 {@link NotificationSlotGranularity#lookupBucketsOf} 가 정한다 — 넓히면 반복 알림이
     * 사라지므로 축마다 명시적으로 고른 값이다.
     *
     * @param kind      알림 종류
     * @param userId    수신자 하나
     * @param subjectId 사건 대상. 대상이 없는 kind 는 {@code null}
     * @param occurredAt 사건의 <b>원본 발생 시각</b>
     * @return 대조할 키 — 첫 원소가 쓰기 키
     * @throws IllegalArgumentException {@link #of} 와 같은 조건
     */
    public static List<String> duplicateKeysOf(NotificationKind kind, UUID userId, UUID subjectId,
                                               Instant occurredAt) {
        return axisOf(kind, userId, occurredAt).lookupBucketsOf(occurredAt).stream()
                .map(bucket -> key(kind, userId, subjectId, bucket))
                .toList();
    }

    /**
     * 필수 축을 확인하고 시간축을 돌려준다.
     *
     * @param kind       알림 종류
     * @param userId     수신자
     * @param occurredAt 원본 사건 시각
     * @return 이 kind 의 시간축
     */
    private static NotificationSlotGranularity axisOf(NotificationKind kind, UUID userId, Instant occurredAt) {
        if (kind == null || userId == null) {
            throw new IllegalArgumentException("kind 와 수신자는 결정적 키의 필수 축입니다.");
        }
        NotificationSlotGranularity granularity = kind.slotGranularity();
        if (occurredAt == null) {
            throw new IllegalArgumentException(
                    kind + " 는 시간축이 " + granularity + " 이므로 원본 사건 시각이 필요합니다.");
        }
        return granularity;
    }

    /**
     * 네 축을 이어 붙인다.
     *
     * @param kind      알림 종류
     * @param userId    수신자
     * @param subjectId 사건 대상
     * @param bucket    시간축 조각
     * @return 키
     */
    private static String key(NotificationKind kind, UUID userId, UUID subjectId, String bucket) {
        return PREFIX
                + ":" + kind.name()
                + ":" + userId
                + ":" + (subjectId == null ? ABSENT : subjectId)
                + ":" + bucket;
    }
}
