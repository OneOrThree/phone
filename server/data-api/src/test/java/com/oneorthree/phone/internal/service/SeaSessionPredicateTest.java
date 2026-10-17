package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 바다 판정 seam 의 운영 기본값 (GROMO-2274, 결정 N3) — 서버에 바다 집중 세션이 없는 동안 모든 세션은 섬 세션이다.
 * 이 단언이 깨지면(= E1-1 이 판정을 채우면) 그 변경이 의도한 것인지 이 테스트가 먼저 묻는다.
 */
class SeaSessionPredicateTest {

    @Test
    @DisplayName("운영 판정은 어떤 세션이든 false 다 — 바다 세션은 아직 존재하지 않는다")
    void everySessionIsAnIslandSessionForNow() {
        assertThat(new SeaSessionPredicate().isSea(mock(FocusSessionDetail.class))).isFalse();
    }
}
