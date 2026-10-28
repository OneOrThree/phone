package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.appearance.dto.PersonalAppearanceView;
import com.oneorthree.phone.appearance.service.AppearanceService;
import com.oneorthree.phone.user.repository.UserBlockRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MemberAppearanceQueryTest {
    private final UserQueryService callers = mock(UserQueryService.class);
    private final UserRepository users = mock(UserRepository.class);
    private final UserBlockRepository blocks = mock(UserBlockRepository.class);
    private final AppearanceService appearances = mock(AppearanceService.class);
    private final MemberAppearanceQuery query = new MemberAppearanceQuery(callers, users, blocks, appearances);
    private final UUID viewer = UUID.randomUUID();

    @Test
    void batchesVisibleUsersAndClearsBlockedOrMissingCopies() {
        UUID shown = UUID.randomUUID();
        UUID blocked = UUID.randomUUID();
        UUID missing = UUID.randomUUID();
        User row = mock(User.class);
        when(row.getId()).thenReturn(shown);
        when(row.getCatColor()).thenReturn("black");
        var look = new PersonalAppearanceView(null, null, "duck", null, null, "raft", "front", 4);
        when(blocks.findBlockedEitherIds(viewer)).thenReturn(Set.of(blocked));
        when(users.findAllByIdInAndIsDeletedFalse(List.of(shown, missing))).thenReturn(List.of(row));
        when(appearances.equippedOf(List.of(shown))).thenReturn(Map.of(shown, look));

        var result = query.find(viewer, List.of(shown, blocked, missing, shown));

        assertThat(result.members()).containsExactly(new MemberAppearanceQuery.Member(shown, "black", look));
        assertThat(result.hiddenUserIds()).containsExactly(blocked, missing);
        verify(callers).getCaller(viewer);
        verify(appearances).equippedOf(List.of(shown));
    }

    @Test
    void boundsRequestsBeforeDatabaseWork() {
        assertThatThrownBy(() -> query.find(viewer, Collections.nCopies(51, viewer)))
                .isInstanceOf(com.oneorthree.phone.appearance.exception.AppearanceException.class);
        assertThatThrownBy(() -> query.find(viewer, List.of()))
                .isInstanceOf(com.oneorthree.phone.appearance.exception.AppearanceException.class);
        verify(callers, never()).getCaller(any());
    }

    @Test
    void allBlockedSkipsAppearanceAndUserReads() {
        UUID other = UUID.randomUUID();
        when(blocks.findBlockedEitherIds(viewer)).thenReturn(Set.of(other));
        assertThat(query.find(viewer, List.of(other)).hiddenUserIds()).containsExactly(other);
        verify(users, never()).findAllByIdInAndIsDeletedFalse(any());
        verify(appearances, never()).equippedOf(any());
    }
}
