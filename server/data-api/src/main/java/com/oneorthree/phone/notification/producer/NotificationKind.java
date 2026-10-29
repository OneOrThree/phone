package com.oneorthree.phone.notification.producer;

import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/** 현재 제품이 발행하는 알림 종류. 렌더와 발송은 알림 서버가 담당한다. */
public enum NotificationKind {
    FRIEND_REQUEST(SubjectKind.COUNTERPART_USER),
    FRIEND_ACCEPTED(SubjectKind.COUNTERPART_USER),
    MAIN_ISLAND_TRANSFERRED(SubjectKind.ISLAND),
    ISLAND_KICKED(SubjectKind.ISLAND),
    MAGAZINE_PUBLISHED(SubjectKind.MAGAZINE_ISSUE),
    ADMIN_ANNOUNCEMENT(SubjectKind.PUBLICATION);

    /** 결정적 사건 키의 대상 축. */
    public enum SubjectKind {
        COUNTERPART_USER,
        ISLAND,
        MAGAZINE_ISSUE,
        PUBLICATION
    }

    private static final Map<String, NotificationKind> BY_NAME = Arrays.stream(values())
            .collect(Collectors.toUnmodifiableMap(Enum::name, Function.identity()));

    private final SubjectKind subjectKind;

    NotificationKind(SubjectKind subjectKind) {
        this.subjectKind = subjectKind;
    }

    public NotificationSlotGranularity slotGranularity() {
        return switch (this) {
            case ISLAND_KICKED -> NotificationSlotGranularity.INSTANT;
            case MAGAZINE_PUBLISHED -> NotificationSlotGranularity.DAY;
            default -> NotificationSlotGranularity.MINUTE;
        };
    }

    public NotificationQuietPolicy quietPolicy() {
        return this == ADMIN_ANNOUNCEMENT ? NotificationQuietPolicy.DEFER : NotificationQuietPolicy.DROP;
    }

    public SubjectKind subjectKind() {
        return subjectKind;
    }

    /** 모르는 종류와 폐기된 종류는 null로 돌려 발송 직전 적격성 검사에서 거절한다. */
    public static NotificationKind find(String name) {
        if (name == null || name.isBlank()) {
            return null;
        }
        return BY_NAME.get(name.trim().toUpperCase(Locale.ROOT));
    }
}
