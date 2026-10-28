package com.oneorthree.phone.quest.service;

import com.oneorthree.phone.quest.exception.QuestErrorCode;
import com.oneorthree.phone.quest.exception.QuestException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 출시 스위치 기본값(GROMO-1773, island-quests policy.md 출시 조건) — 설정이 없으면 생성과 정산이 503 이다.
 *
 * <p>스위치 판정은 receipt 선점·잠금·조회보다 앞이라 협력 객체가 없어도(null) 거절이 먼저 난다 — 그것 자체가
 * «닫힌 게이트는 아무것도 건드리지 않는다»의 검증이다. 설정 기본값은 {@code @Value} 의 {@code :false} 다.
 */
class IslandQuestGateTest {

    private final IslandQuestService closed = new IslandQuestService(null, null, null, null, null, null, null,
            null, null, null, null, null, null, null);

    @Test
    @DisplayName("스위치가 꺼져 있으면 생성은 503 QUEST_CREATION_UNAVAILABLE 이다")
    void creationIsClosedByDefault() {
        assertThatThrownBy(() -> closed.create(UUID.randomUUID(), UUID.randomUUID(), "저녁", "focus", 30,
                "18:00", "23:00", null, UUID.randomUUID()))
                .isInstanceOfSatisfying(QuestException.class, e -> {
                    assertThat(e.getErrorCode()).isEqualTo(QuestErrorCode.QUEST_CREATION_UNAVAILABLE);
                    assertThat(e.getErrorCode().getStatus().value()).isEqualTo(503);
                });
    }

    @Test
    @DisplayName("스위치가 꺼져 있으면 정산은 503 QUEST_SETTLEMENT_UNAVAILABLE 이다")
    void settlementIsClosedByDefault() {
        assertThatThrownBy(() -> closed.claim(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                UUID.randomUUID(), 1, UUID.randomUUID()))
                .isInstanceOfSatisfying(QuestException.class, e -> {
                    assertThat(e.getErrorCode()).isEqualTo(QuestErrorCode.QUEST_SETTLEMENT_UNAVAILABLE);
                    assertThat(e.getErrorCode().getStatus().value()).isEqualTo(503);
                });
    }
}
