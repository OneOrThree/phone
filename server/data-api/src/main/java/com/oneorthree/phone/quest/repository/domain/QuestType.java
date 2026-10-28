package com.oneorthree.phone.quest.repository.domain;

import java.util.Arrays;
import java.util.Optional;

/**
 * 섬 퀘스트 종류 (정책 Q01) — {@code focus} 는 시간대 집중 목표, {@code screen} 은 하루 사용 상한.
 * 공개 계약의 소문자 값은 {@link #wire()} 다.
 */
public enum QuestType {
    FOCUS("focus"),
    SCREEN("screen");

    private final String wire;

    QuestType(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static Optional<QuestType> fromWire(String value) {
        return Arrays.stream(values()).filter(t -> t.wire.equals(value)).findFirst();
    }
}
