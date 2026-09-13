package com.oneorthree.phone.notification.producer;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 결정적 사건 키를 만드는 <b>유일한 자리</b> — producer 와 이관 export 가 같은 코드를 쓴다.
 *
 * <h2>왜 함수로 떼어 놓는가</h2>
 * 컷오버에서 구 {@code notification_sent_logs} 의 미발송 행을 알림 서버로 옮길 때, 그 행이 받을
 * 키는 <b>지금 producer 가 만드는 키와 한 글자도 다르면 안 된다</b>. 다르면 같은 사건이 두 개의
 * 키로 존재하고, 이관분과 신규분이 서로를 중복으로 보지 못해 <b>사용자에게 두 번</b> 간다.
 *
 * <p>두 곳이 각자 문자열을 조립하면 그 «한 글자»가 언제든 갈라진다 — 구분자 하나, 대소문자 하나,
 * {@code none} 이라는 단어 하나. 그래서 조립을 여기 하나로 묶고 양쪽이 부른다.
 *
 * <h2>키의 축 넷</h2>
 * {@code noti:<KIND>:<userId>:<subjectId|none>:<시간축|none>} — 넷 중 하나라도 빠지면 조용히 접힌다:
 * kind 가 없으면 같은 회차의 결과와 환불이 한 건이 되고, userId 가 없으면 fan-out 이 한 명으로 줄고,
 * subjectId 가 없으면 서로 다른 회차가 뭉치고, 시간축이 없으면 매일 반복되는 알림이 첫날 이후 멈춘다.
 */
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
     * @param occurredAt 사건의 <b>원본 발생 시각</b>. 시간축이 {@link NotificationSlotGranularity#NONE}
     *                  이면 무시되므로 {@code null} 이어도 된다
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
        if (granularity != NotificationSlotGranularity.NONE && occurredAt == null) {
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
