package com.oneorthree.chat.membership;

import com.oneorthree.chat.TestcontainersConfiguration;
import com.oneorthree.chat.common.exception.UpstreamUnavailableException;
import com.oneorthree.chat.common.redis.RedisKeys;
import com.oneorthree.chat.membership.client.GroupClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * 멤버십 캐시 — <b>실제 Redis</b> 위에서 본다.
 *
 * <p>목 Redis 로는 이 클래스의 핵심(「빈 SET 은 존재하지 않는다」는 Redis 의 성질과, 그걸 우회하는
 * 표식)이 통째로 검증되지 않는다. 상류만 목으로 세운다.
 */
@SpringBootTest
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class MembershipServiceTest {

    private static final String BEARER = "Bearer test-token";

    @Autowired
    private MembershipService membershipService;

    @Autowired
    private StringRedisTemplate redis;

    @MockitoBean
    private GroupClient groupClient;

    private UUID userId;
    private UUID groupId;

    @BeforeEach
    void setUp() {
        userId = UUID.randomUUID();
        groupId = UUID.randomUUID();
        redis.delete(RedisKeys.memberCache(userId));
    }

    @Test
    @DisplayName("캐시 미스면 상류를 부르고, 두 번째부터는 부르지 않는다")
    void cachesAfterFirstLookup() {
        given(groupClient.fetchMyGroupIds(BEARER)).willReturn(Set.of(groupId));

        assertThat(membershipService.isMember(groupId, userId, BEARER)).isTrue();
        assertThat(membershipService.isMember(groupId, userId, BEARER)).isTrue();

        verify(groupClient, times(1)).fetchMyGroupIds(BEARER);
    }

    @Test
    @DisplayName("아무 섬에도 안 속한 사람도 캐시된다 — 표식이 없으면 매 요청이 상류로 샌다")
    void cachesEmptyMembership() {
        given(groupClient.fetchMyGroupIds(BEARER)).willReturn(Set.of());

        assertThat(membershipService.isMember(groupId, userId, BEARER)).isFalse();
        assertThat(membershipService.isMember(groupId, userId, BEARER)).isFalse();

        // 이 단언이 이 클래스에서 가장 중요하다. 표식을 빼면 키가 아예 안 생겨 두 번 호출된다.
        verify(groupClient, times(1)).fetchMyGroupIds(BEARER);
        assertThat(redis.hasKey(RedisKeys.memberCache(userId))).isTrue();
    }

    @Test
    @DisplayName("표식은 그룹 id 로 새어 나오지 않는다")
    void sentinelIsNotExposed() {
        given(groupClient.fetchMyGroupIds(BEARER)).willReturn(Set.of(groupId));
        membershipService.myGroupIds(userId, BEARER);

        assertThat(membershipService.myGroupIds(userId, BEARER)).containsExactly(groupId);
    }

    @Test
    @DisplayName("상류가 죽으면 «비멤버»가 아니라 예외다 — 장애를 조용한 전면 차단으로 바꾸지 않는다")
    void upstreamFailureIsNotSilentDenial() {
        willThrow(new UpstreamUnavailableException()).given(groupClient).fetchMyGroupIds(BEARER);

        assertThatThrownBy(() -> membershipService.isMember(groupId, userId, BEARER))
                .isInstanceOf(UpstreamUnavailableException.class);
    }

    @Test
    @DisplayName("캐시가 살아 있으면 상류가 죽어도 판정이 계속된다")
    void servesFromCacheWhileUpstreamIsDown() {
        given(groupClient.fetchMyGroupIds(BEARER)).willReturn(Set.of(groupId));
        membershipService.myGroupIds(userId, BEARER);

        willThrow(new UpstreamUnavailableException()).given(groupClient).fetchMyGroupIds(BEARER);

        assertThat(membershipService.isMember(groupId, userId, BEARER)).isTrue();
    }

    @Test
    @DisplayName("남의 섬은 캐시에 있어도 false 다")
    void otherIslandIsNotMine() {
        given(groupClient.fetchMyGroupIds(BEARER)).willReturn(Set.of(groupId));

        assertThat(membershipService.isMember(UUID.randomUUID(), userId, BEARER)).isFalse();
        verify(groupClient, never()).fetchMyGroupIds("Bearer other");
    }
}
