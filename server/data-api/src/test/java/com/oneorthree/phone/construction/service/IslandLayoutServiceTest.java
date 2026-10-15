package com.oneorthree.phone.construction.service;

import com.oneorthree.phone.construction.repository.IslandLayoutRepository;
import com.oneorthree.phone.construction.repository.domain.IslandLayout;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 지연 생성 fast path (GROMO-2232) — 행이 있으면 INSERT 를 타지 않는다. */
class IslandLayoutServiceTest {

    private final IslandLayoutRepository layouts = mock(IslandLayoutRepository.class);
    private final IslandLayoutService service = new IslandLayoutService(layouts, Clock.systemUTC());
    private final UUID islandId = UUID.randomUUID();

    @Test
    @DisplayName("행이 이미 있으면 insertIfAbsent 를 호출하지 않는다")
    void existingRowSkipsInsert() {
        IslandLayout row = mock(IslandLayout.class);
        when(row.getLayoutRevision()).thenReturn(3L);
        when(row.getLayout()).thenReturn(Map.of("schemaVersion", 1));
        when(layouts.findById(islandId)).thenReturn(Optional.of(row));

        assertThat(service.current(islandId).layoutRevision()).isEqualTo(3L);

        verify(layouts, never()).insertIfAbsent(any(), anyString());
    }

    @Test
    @DisplayName("행이 없으면 insertIfAbsent 후 다시 읽는다")
    void missingRowInsertsThenRereads() {
        IslandLayout row = mock(IslandLayout.class);
        when(row.getLayoutRevision()).thenReturn(1L);
        when(layouts.findById(islandId)).thenReturn(Optional.empty(), Optional.of(row));

        assertThat(service.current(islandId).layoutRevision()).isEqualTo(1L);

        verify(layouts).insertIfAbsent(any(), anyString());
    }
}
