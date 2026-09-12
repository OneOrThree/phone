package com.oneorthree.realtime.membership;

import com.oneorthree.realtime.common.exception.UpstreamRejectedCredentialException;
import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.membership.client.GroupClient;
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
        given(groupClient.fetchMyGroupIds(BEARER)).willReturn(GroupClient.Membership.of(Set.of(groupId)));

        assertThat(membershipService.isMember(groupId, userId, BEARER)).isTrue();
        assertThat(membershipService.isMember(groupId, userId, BEARER)).isTrue();

        verify(groupClient, times(1)).fetchMyGroupIds(BEARER);
    }

    @Test
    @DisplayName("아무 섬에도 안 속한 사람도 캐시된다 — 안 그러면 매 요청이 상류로 샌다")
    void cachesEmptyMembership() {
        given(groupClient.fetchMyGroupIds(BEARER)).willReturn(GroupClient.Membership.of(Set.of()));

        assertThat(membershipService.isMember(groupId, userId, BEARER)).isFalse();
        assertThat(membershipService.isMember(groupId, userId, BEARER)).isFalse();

        // SET 으로 저장하면 「빈 SET」이 Redis 에 존재하지 않아 키가 아예 안 생기고, 그러면 두 번 호출된다.
        verify(groupClient, times(1)).fetchMyGroupIds(BEARER);
        assertThat(redis.hasKey(RedisKeys.memberCache(userId))).isTrue();
    }

    @Test
    @DisplayName("상류가 토큰을 거절하면(401) 그대로 올린다 — 빈 집합으로 접으면 앱이 갱신할 줄 모른다")
    void unauthorizedPropagatesInsteadOfLookingLikeNonMembership() {
        given(groupClient.fetchMyGroupIds(BEARER)).willThrow(new UpstreamRejectedCredentialException());

        assertThatThrownBy(() -> membershipService.myGroupIds(userId, BEARER))
                .isInstanceOf(UpstreamRejectedCredentialException.class);

        // 「소속 없음」으로 캐시되면 갱신된 토큰조차 TTL 동안 상류에 못 닿는다.
        assertThat(redis.hasKey(RedisKeys.memberCache(userId))).isFalse();
    }

    @Test
    @DisplayName("상류가 «이 토큰»을 거절해서 나온 빈 집합은 캐시하지 않는다 — 토큰 갱신이 무의미해진다")
    void doesNotCacheRejectionDerivedEmptyMembership() {
        // 장시간 열린 STOMP 세션에서 AT 가 만료된 직후 캐시 미스가 나면 상류가 401 을 준다.
        // 그걸 캐시하면 캐시는 userId 로만 조회되므로, 유저가 즉시 토큰을 갱신해 새로 붙어도
        // 새 토큰이 상류에 닿지 못한 채 TTL 동안 «모든 방»에서 NOT_A_MEMBER 로 막힌다.
        given(groupClient.fetchMyGroupIds(BEARER)).willReturn(GroupClient.Membership.rejected());

        assertThat(membershipService.myGroupIds(userId, BEARER)).isEmpty();

        assertThat(redis.hasKey(RedisKeys.memberCache(userId))).isFalse();

        // 그래서 «갱신된 토큰»으로 온 다음 요청은 상류에 그대로 닿는다.
        String renewed = "Bearer renewed-token";
        given(groupClient.fetchMyGroupIds(renewed)).willReturn(GroupClient.Membership.of(Set.of(groupId)));
        assertThat(membershipService.isMember(groupId, userId, renewed)).isTrue();
    }

    @Test
    @DisplayName("캐시에는 «반드시» 수명이 걸려 있다 — 수명 없는 캐시는 영구 멤버십이다")
    void cachedMembershipAlwaysExpires() {
        given(groupClient.fetchMyGroupIds(BEARER)).willReturn(GroupClient.Membership.of(Set.of(groupId)));
        membershipService.myGroupIds(userId, BEARER);

        // 이 서비스는 탈퇴·강퇴를 «캐시 만료»로만 반영한다. 값과 수명을 두 명령으로 나눠 쓰면
        // 그 사이에 프로세스가 죽는 한 번의 사고로 그 유저가 영구 멤버십을 얻는다.
        Long ttl = redis.getExpire(RedisKeys.memberCache(userId));
        assertThat(ttl).isNotNull().isPositive();
    }

    @Test
    @DisplayName("여러 섬에 속해도 전부 되살아난다 — 값을 한 문자열로 접어도 잃지 않는다")
    void roundTripsMultipleGroups() {
        UUID second = UUID.randomUUID();
        given(groupClient.fetchMyGroupIds(BEARER)).willReturn(GroupClient.Membership.of(Set.of(groupId, second)));
        membershipService.myGroupIds(userId, BEARER);

        assertThat(membershipService.myGroupIds(userId, BEARER)).containsExactlyInAnyOrder(groupId, second);
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
        given(groupClient.fetchMyGroupIds(BEARER)).willReturn(GroupClient.Membership.of(Set.of(groupId)));
        membershipService.myGroupIds(userId, BEARER);

        willThrow(new UpstreamUnavailableException()).given(groupClient).fetchMyGroupIds(BEARER);

        assertThat(membershipService.isMember(groupId, userId, BEARER)).isTrue();
    }

    @Test
    @DisplayName("남의 섬은 캐시에 있어도 false 다")
    void otherIslandIsNotMine() {
        given(groupClient.fetchMyGroupIds(BEARER)).willReturn(GroupClient.Membership.of(Set.of(groupId)));

        assertThat(membershipService.isMember(UUID.randomUUID(), userId, BEARER)).isFalse();
        verify(groupClient, never()).fetchMyGroupIds("Bearer other");
    }
}
