package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionKind;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 바다 판정 seam (GROMO-2274 결정 N3 → GROMO-2299) — 판정 근거는 {@code focus_session_details.kind} 하나다.
 */
class SeaSessionPredicateTest {

    private final SeaSessionPredicate predicate = new SeaSessionPredicate();

    @Test
    @DisplayName("kind 가 SEA 인 세션만 바다 세션이다")
    void onlySeaKindIsSea() {
        assertThat(predicate.isSea(FocusSessionDetail.builder().kind(FocusSessionKind.SEA).build())).isTrue();
        assertThat(predicate.isSea(FocusSessionDetail.builder().kind(FocusSessionKind.ISLAND).build())).isFalse();
    }

    @Test
    @DisplayName("kind 를 지정하지 않은 세션(이 열이 생기기 전의 행·섬 세션 빌더)은 섬 세션이다")
    void defaultKindIsIsland() {
        assertThat(predicate.isSea(FocusSessionDetail.builder().build())).isFalse();
    }
}
