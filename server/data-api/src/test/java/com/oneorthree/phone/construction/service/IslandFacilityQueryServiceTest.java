package com.oneorthree.phone.construction.service;

import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 시설 게이트 롤아웃 가드 ({@code construction.facility-gates.enforce}) 검증.
 *
 * <p>자금 적립 경로({@code IslandWalletService.contribute} 호출부)가 배포되기 전에는
 * 어느 섬도 시설을 지을 수 없으므로, 기본값 OFF 는 종전 stub 과 같이 전부 통과시켜
 * 기존 우체통·편지·섬 이동 기능을 깨지 않는다. ON 은 COMPLETED 시설만 연다.
 */
class IslandFacilityQueryServiceTest {

    private static final UUID ISLAND = UUID.randomUUID();

    private final IslandFacilityRepository facilities = mock(IslandFacilityRepository.class);

    @Test
    @DisplayName("enforce=OFF(기본) — 종전 stub 판정 그대로: 시설 없어도 통과, 섬 없는 편지 호출만 잠긴다")
    void offPreservesTheOldStubVerdicts() {
        IslandFacilityQueryService gates = new IslandFacilityQueryService(facilities, false);

        // 전망대·우체통 게이트는 종전 stub 과 같이 무조건 통과 — 기존 이동·편지방 기능 보존.
        assertThat(gates.hasObservatory(ISLAND)).isTrue();
        assertThat(gates.hasMailbox(ISLAND)).isTrue();
        assertThat(gates.hasBoard(ISLAND)).isTrue();
        // 편지 게이트는 종전 「살아 있는 소속 섬」판정 — 소속 섬이 있으면 시설 없이도 연다.
        assertThat(gates.hasMailboxOnAnyOf(List.of(ISLAND))).isTrue();
        // 섬이 하나도 없는 호출자는 적립 연동 전부터 잠겨 있었다 — 그 거절은 보존한다.
        assertThat(gates.hasMailboxOnAnyOf(List.of())).isFalse();
        verifyNoInteractions(facilities);
    }

    @Test
    @DisplayName("enforce=ON — COMPLETED 가 아닌 시설은 네 게이트가 전부 닫힌다")
    void onRejectsUncompleted() {
        IslandFacilityQueryService gates = new IslandFacilityQueryService(facilities, true);

        assertThat(gates.hasObservatory(ISLAND)).isFalse();
        assertThat(gates.hasMailbox(ISLAND)).isFalse();
        assertThat(gates.hasBoard(ISLAND)).isFalse();
        assertThat(gates.hasMailboxOnAnyOf(List.of(ISLAND))).isFalse();
    }

    @Test
    @DisplayName("enforce=ON — COMPLETED 시설은 네 게이트가 전부 열린다")
    void onAllowsCompleted() {
        when(facilities.existsCompleted(ISLAND, "tower")).thenReturn(true);
        when(facilities.existsCompleted(ISLAND, "mail")).thenReturn(true);
        when(facilities.existsCompleted(ISLAND, "board")).thenReturn(true);
        when(facilities.existsCompletedInAny(eq("mail"), anyList())).thenReturn(true);
        IslandFacilityQueryService gates = new IslandFacilityQueryService(facilities, true);

        assertThat(gates.hasObservatory(ISLAND)).isTrue();
        assertThat(gates.hasMailbox(ISLAND)).isTrue();
        assertThat(gates.hasBoard(ISLAND)).isTrue();
        assertThat(gates.hasMailboxOnAnyOf(List.of(ISLAND))).isTrue();
    }
}
