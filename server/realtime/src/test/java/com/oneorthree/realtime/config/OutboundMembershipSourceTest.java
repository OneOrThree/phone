package com.oneorthree.realtime.config;

import com.oneorthree.realtime.common.redis.Sourced;
import com.oneorthree.realtime.membership.CurrentMembershipVerifier;
import com.oneorthree.realtime.membership.MembershipService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class OutboundMembershipSourceTest {

    private final MembershipService membership = mock(MembershipService.class);
    @SuppressWarnings("unchecked")
    private final ObjectProvider<CurrentMembershipVerifier> verifier = mock(ObjectProvider.class);
    private final OutboundMembershipSource source = new OutboundMembershipSource(membership, verifier);
    private final UUID island = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();

    @Test
    @DisplayName("원본 값이 여전히 멤버라고 말하면 그 값의 만료, 비멤버·없음·실패면 EXPIRED(담지 않음)")
    void boundIsTheExpiryOfAValueThatStillSaysMember() {
        when(membership.cachedGroupIdsSourced(user)).thenReturn(new Sourced<>(Set.of(island), 42L));
        assertThat(source.notAfter(island, user)).isEqualTo(42L);

        // 판정 뒤 다른 요청이 원본을 비멤버 새 값(새 TTL)으로 갈았다 — 새 수명을 옛 판정에 주지 않는다.
        when(membership.cachedGroupIdsSourced(user)).thenReturn(new Sourced<>(Set.of(), 999L));
        assertThat(source.notAfter(island, user)).isEqualTo(Sourced.EXPIRED);

        when(membership.cachedGroupIdsSourced(user)).thenReturn(new Sourced<>(null, Sourced.EXPIRED));
        assertThat(source.notAfter(island, user)).isEqualTo(Sourced.EXPIRED);

        when(membership.cachedGroupIdsSourced(user)).thenThrow(new IllegalStateException("redis"));
        assertThat(source.notAfter(island, user)).isEqualTo(Sourced.EXPIRED);
    }

    @Test
    @DisplayName("현재 인가 ON(verifier)은 원본 캐시가 없다 — 제한 없음, Redis 를 읽지 않는다")
    void onModeHasNoSourceCache() {
        when(verifier.getIfAvailable()).thenReturn(mock(CurrentMembershipVerifier.class));
        assertThat(source.notAfter(island, user)).isEqualTo(Sourced.UNBOUNDED);
        verifyNoInteractions(membership);
    }
}
