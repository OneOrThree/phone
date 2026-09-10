package com.oneorthree.chat.message.service;

import com.oneorthree.chat.membership.MembershipService;
import com.oneorthree.chat.message.exception.ChatErrorCode;
import com.oneorthree.chat.message.exception.ChatException;
import com.oneorthree.chat.presence.FocusPresenceReader;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 채팅의 두 규칙이 실제로 서 있는지, 그리고 <b>어떤 순서로</b> 서 있는지.
 *
 * <p>순서까지 테스트로 못 박는 이유: 순서가 뒤집혀도 «거절된다»는 결과는 같아서, 순서만 어긋난
 * 회귀는 일반적인 단언으로는 잡히지 않는다. 그런데 순서가 뒤집히면 집중 중인 유저의 매 요청이
 * 상류로 나가게 된다 — 조용한 성능 회귀다.
 */
@ExtendWith(MockitoExtension.class)
class ChatAccessGuardTest {

    private static final String BEARER = "Bearer test-token";

    @Mock
    private FocusPresenceReader focusPresenceReader;

    @Mock
    private MembershipService membershipService;

    @InjectMocks
    private ChatAccessGuard accessGuard;

    private UUID userId;
    private UUID groupId;

    @BeforeEach
    void setUp() {
        userId = UUID.randomUUID();
        groupId = UUID.randomUUID();
    }

    @Test
    @DisplayName("같은 섬의 멤버이고 집중 중이 아니면 통과한다")
    void allowsMemberWhoIsNotFocusing() {
        given(focusPresenceReader.isFocusing(userId)).willReturn(false);
        given(membershipService.isMember(groupId, userId, BEARER)).willReturn(true);

        assertThatCode(() -> accessGuard.requireCanChat(groupId, userId, BEARER)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("남의 섬이면 NOT_A_MEMBER — 없는 섬도 같은 코드로 합쳐진다(존재 여부가 새지 않게)")
    void rejectsNonMember() {
        given(focusPresenceReader.isFocusing(userId)).willReturn(false);
        given(membershipService.isMember(groupId, userId, BEARER)).willReturn(false);

        assertThatThrownBy(() -> accessGuard.requireCanChat(groupId, userId, BEARER))
                .isInstanceOf(ChatException.class)
                .extracting(e -> ((ChatException) e).getErrorCode())
                .isEqualTo(ChatErrorCode.NOT_A_MEMBER);
    }

    @Test
    @DisplayName("집중 중이면 FOCUS_IN_PROGRESS — 권한(403)이 아니라 상태 충돌(409)이다")
    void rejectsWhileFocusing() {
        given(focusPresenceReader.isFocusing(userId)).willReturn(true);

        assertThatThrownBy(() -> accessGuard.requireCanChat(groupId, userId, BEARER))
                .isInstanceOf(ChatException.class)
                .extracting(e -> ((ChatException) e).getErrorCode())
                .isEqualTo(ChatErrorCode.FOCUS_IN_PROGRESS);

        assertThat(ChatErrorCode.FOCUS_IN_PROGRESS.getStatus().value()).isEqualTo(409);
    }

    @Test
    @DisplayName("집중 중이면 멤버십을 «묻지도 않는다» — 싼 검사를 먼저 둔 이유가 이것이다")
    void doesNotAskUpstreamWhileFocusing() {
        given(focusPresenceReader.isFocusing(userId)).willReturn(true);

        assertThatThrownBy(() -> accessGuard.requireCanChat(groupId, userId, BEARER))
                .isInstanceOf(ChatException.class);

        verifyNoInteractions(membershipService);
    }

    @Test
    @DisplayName("섬을 특정하지 않는 입구는 집중만 본다 — 방 목록 조회가 상류를 두드리지 않는다")
    void focusOnlyGateSkipsMembership() {
        given(focusPresenceReader.isFocusing(userId)).willReturn(false);

        accessGuard.requireNotFocusing(userId);

        verify(membershipService, never()).isMember(any(), any(), any());
    }
}
