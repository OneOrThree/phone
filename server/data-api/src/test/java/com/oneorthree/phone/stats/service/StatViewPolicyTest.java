package com.oneorthree.phone.stats.service;

import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.friend.exception.FriendException;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.user.repository.domain.StatVisibility;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

@ExtendWith(MockitoExtension.class)
class StatViewPolicyTest {

    @InjectMocks
    private StatViewPolicy statViewPolicy;

    @Mock
    private UserQueryService userQueryService;
    @Mock
    private FriendshipRepository friendshipRepository;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID FRIEND_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @Test
    @DisplayName("friends null → 호출자 self 반환, 친구/유저 조회 없음")
    void selfWhenFriendsNull() {
        UUID target = statViewPolicy.resolveTargetUserId(USER_ID, null);

        assertThat(target).isEqualTo(USER_ID);
        verifyNoInteractions(friendshipRepository);
        verifyNoInteractions(userQueryService);
    }

    @Test
    @DisplayName("friends 가 호출자 자신 id → 친구 검증 없이 self 반환 (NOT_FRIEND 404 오인 방지)")
    void selfWhenFriendsIsCaller() {
        UUID target = statViewPolicy.resolveTargetUserId(USER_ID, USER_ID);

        assertThat(target).isEqualTo(USER_ID);
        verifyNoInteractions(friendshipRepository);
        verifyNoInteractions(userQueryService);
    }

    @Test
    @DisplayName("friends 지정 + ACCEPTED 친구관계 → 대상 friends 반환")
    void acceptedFriend() {
        User caller = User.builder().id(USER_ID).build();
        User friend = User.builder().id(FRIEND_ID).build();
        given(userQueryService.getCaller(USER_ID)).willReturn(caller);
        given(userQueryService.getTarget(FRIEND_ID)).willReturn(friend);
        given(friendshipRepository.findAcceptedBetween(caller, friend))
                .willReturn(Optional.of(mock(Friendship.class)));

        UUID target = statViewPolicy.resolveTargetUserId(USER_ID, FRIEND_ID);

        assertThat(target).isEqualTo(FRIEND_ID);
    }

    @Test
    @DisplayName("친구 + 대상 statVisibility=FRIENDS → 허용(친구관계 우선)")
    void acceptedFriendWithFriendsVisibility() {
        User caller = User.builder().id(USER_ID).build();
        User friend = User.builder().id(FRIEND_ID).statVisibility(StatVisibility.FRIENDS).build();
        given(userQueryService.getCaller(USER_ID)).willReturn(caller);
        given(userQueryService.getTarget(FRIEND_ID)).willReturn(friend);
        given(friendshipRepository.findAcceptedBetween(caller, friend))
                .willReturn(Optional.of(mock(Friendship.class)));

        UUID target = statViewPolicy.resolveTargetUserId(USER_ID, FRIEND_ID);

        assertThat(target).isEqualTo(FRIEND_ID);
    }

    @Test
    @DisplayName("비친구 + 대상 statVisibility=PUBLIC → 친구 아니어도 허용(대상 friends 반환) (GROMO-623)")
    void nonFriendPublicAllowed() {
        User caller = User.builder().id(USER_ID).build();
        User friend = User.builder().id(FRIEND_ID).statVisibility(StatVisibility.PUBLIC).build();
        given(userQueryService.getCaller(USER_ID)).willReturn(caller);
        given(userQueryService.getTarget(FRIEND_ID)).willReturn(friend);
        // 친구관계 없음 → PUBLIC 이라 열람 허용
        given(friendshipRepository.findAcceptedBetween(caller, friend)).willReturn(Optional.empty());

        UUID target = statViewPolicy.resolveTargetUserId(USER_ID, FRIEND_ID);

        assertThat(target).isEqualTo(FRIEND_ID);
    }

    @Test
    @DisplayName("비친구 + 대상 statVisibility=FRIENDS(기본값) → FriendException(NOT_FRIEND)")
    void nonFriendPrivateThrows() {
        User caller = User.builder().id(USER_ID).build();
        // User.builder() 의 @Builder.Default 로 statVisibility=FRIENDS
        User friend = User.builder().id(FRIEND_ID).build();
        given(userQueryService.getCaller(USER_ID)).willReturn(caller);
        given(userQueryService.getTarget(FRIEND_ID)).willReturn(friend);
        given(friendshipRepository.findAcceptedBetween(caller, friend)).willReturn(Optional.empty());

        assertThatThrownBy(() -> statViewPolicy.resolveTargetUserId(USER_ID, FRIEND_ID))
                .isInstanceOf(FriendException.class);
    }

    @Test
    @DisplayName("friends 지정 + 대상 유저 미존재 → UserException(NOT_FOUND)")
    void targetNotFound() {
        User caller = User.builder().id(USER_ID).build();
        given(userQueryService.getCaller(USER_ID)).willReturn(caller);
        given(userQueryService.getTarget(FRIEND_ID))
                .willThrow(new UserException(UserErrorCode.NOT_FOUND));

        assertThatThrownBy(() -> statViewPolicy.resolveTargetUserId(USER_ID, FRIEND_ID))
                .isInstanceOf(UserException.class);
    }

    @Test
    @DisplayName("friends 지정 + 호출자 미존재·탈퇴 → UserException(USER_NOT_FOUND)")
    void callerNotFound() {
        given(userQueryService.getCaller(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> statViewPolicy.resolveTargetUserId(USER_ID, FRIEND_ID))
                .isInstanceOf(UserException.class);
    }
}
