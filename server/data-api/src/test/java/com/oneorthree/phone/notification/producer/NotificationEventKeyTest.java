package com.oneorthree.phone.notification.producer;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 결정적 사건 키 — <b>dedup 의 유일한 근거</b>라 축 하나가 어긋나면 알림이 사라지거나 두 번 간다.
 *
 * <p>여기서 지키는 성질은 셋이다: 같은 입력은 같은 키, 다른 사건은 다른 키, 그리고 시간축이 있는
 * 종류에 원본 시각이 없으면 <b>조용히 「지금」으로 접히지 않고 죽는다</b>.
 */
class NotificationEventKeyTest {

    private static final UUID USER = UUID.fromString("00000000-0000-0000-0000-0000000000aa");
    private static final UUID SUBJECT = UUID.fromString("00000000-0000-0000-0000-0000000000bb");

    @Test
    @DisplayName("MINUTE 축은 분 단위로 접힌다 — 구 「최근 1분」 dedup 창을 그대로 옮긴 폭")
    void minuteAxisFoldsWithinMinute() {
        Instant at = Instant.parse("2026-09-11T10:20:00Z");
        assertThat(NotificationEventKey.of(NotificationKind.FRIEND_REQUEST, USER, SUBJECT,
                at.plusSeconds(59)))
                .isEqualTo(NotificationEventKey.of(NotificationKind.FRIEND_REQUEST, USER, SUBJECT, at));
        assertThat(NotificationEventKey.of(NotificationKind.FRIEND_REQUEST, USER, SUBJECT,
                at.plusSeconds(60)))
                .isNotEqualTo(NotificationEventKey.of(NotificationKind.FRIEND_REQUEST, USER, SUBJECT, at));
    }

    /**
     * 분 축은 <b>고정 버킷</b>이라 같은 사건이 경계에서 갈린다 — 버전 필드가 없는 친구 요청의 재개·수락은
     * 동시에 처리된 둘이 각자 자기 {@code updatedAt} 을 쓰기 때문이다. 쓰기 키는 결정적이어야 하니 그대로
     * 두고, 중복 <b>판정</b>이 인접 버킷까지 대조해 「최근 1분」 계약을 실제 1분 구간으로 만든다.
     */
    @Test
    @DisplayName("분 축은 인접 버킷까지 대조한다 — 12:00:59 와 12:01:01 이 두 건이 되면 푸시가 두 번 나간다")
    void minuteAxisComparesAgainstAdjacentBuckets() {
        Instant justBefore = Instant.parse("2026-09-11T12:00:59Z");
        Instant justAfter = Instant.parse("2026-09-11T12:01:01Z");
        String beforeKey = NotificationEventKey.of(NotificationKind.FRIEND_REQUEST, USER, SUBJECT, justBefore);
        String afterKey = NotificationEventKey.of(NotificationKind.FRIEND_REQUEST, USER, SUBJECT, justAfter);

        // 쓰기 키 자체는 그대로 갈린다 — 결정적이어야 하므로 넓히지 않는다.
        assertThat(beforeKey).isNotEqualTo(afterKey);
        // 대조 목록은 «쓰기 키가 먼저»고, 서로를 덮는다.
        assertThat(NotificationEventKey.duplicateKeysOf(NotificationKind.FRIEND_REQUEST, USER, SUBJECT, justAfter))
                .first().isEqualTo(afterKey);
        assertThat(NotificationEventKey.duplicateKeysOf(NotificationKind.FRIEND_REQUEST, USER, SUBJECT, justAfter))
                .contains(beforeKey);
        assertThat(NotificationEventKey.duplicateKeysOf(NotificationKind.FRIEND_REQUEST, USER, SUBJECT, justBefore))
                .contains(afterKey);
        // 3분 뒤는 별개다 — 폭이 넓어지면 거절 뒤 다시 보낸 요청의 통보가 사라진다.
        assertThat(NotificationEventKey.duplicateKeysOf(NotificationKind.FRIEND_REQUEST, USER, SUBJECT, justBefore))
                .doesNotContain(NotificationEventKey.of(NotificationKind.FRIEND_REQUEST, USER, SUBJECT,
                        justBefore.plusSeconds(180)));
    }

    @Test
    @DisplayName("시간축이 있는데 원본 시각이 없으면 죽는다 — 「없으면 지금」으로 접히면 멱등이 무너진다")
    void missingEventTimeFailsLoudly() {
        assertThatThrownBy(() ->
                NotificationEventKey.of(NotificationKind.FRIEND_REQUEST, USER, SUBJECT, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("원본 사건 시각");
    }

    @Test
    @DisplayName("같은 섬에서 연속 강퇴돼도 사건 시각이 다르면 각각 알린다")
    void islandKickKeepsDistinctEventsWithinTheSameMinute() {
        Instant first = Instant.parse("2026-10-20T10:20:00Z");
        String firstKey = NotificationEventKey.of(NotificationKind.ISLAND_KICKED, USER, SUBJECT, first);
        assertThat(NotificationEventKey.duplicateKeysOf(NotificationKind.ISLAND_KICKED, USER, SUBJECT, first))
                .containsExactly(firstKey);
        assertThat(NotificationEventKey.duplicateKeysOf(NotificationKind.ISLAND_KICKED, USER, SUBJECT,
                first.plusMillis(1))).doesNotContain(firstKey);
    }

    @Test
    @DisplayName("잡지 알림의 시간 축은 KST 날짜이며 인접 날짜의 키를 대조하지 않는다")
    void magazineUsesOnlyItsKstDay() {
        Instant at = Instant.parse("2026-10-20T22:00:00Z");
        String key = NotificationEventKey.of(NotificationKind.MAGAZINE_PUBLISHED, USER, SUBJECT, at);
        assertThat(key).endsWith(":20261021");
        assertThat(NotificationEventKey.duplicateKeysOf(NotificationKind.MAGAZINE_PUBLISHED, USER, SUBJECT, at))
                .containsExactly(key);
        assertThat(NotificationEventKey.of(NotificationKind.MAGAZINE_PUBLISHED, USER, SUBJECT, at.plusSeconds(3600)))
                .isEqualTo(key);
    }

    @Test
    @DisplayName("폐기된 알림 종류는 재전송되더라도 발송 대상으로 해석하지 않는다")
    void retiredKindsAreUnknown() {
        assertThat(NotificationKind.find("BET_RESULT")).isNull();
        assertThat(NotificationKind.find("LEAGUE_WEEKLY_RESULT")).isNull();
        assertThat(NotificationKind.find("INACTIVE_RETURN")).isNull();
        assertThat(NotificationKind.find("friend_request")).isEqualTo(NotificationKind.FRIEND_REQUEST);
    }
}
