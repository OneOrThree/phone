package com.oneorthree.realtime.message.service;

import com.oneorthree.realtime.membership.MembershipService;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import com.oneorthree.realtime.presence.FocusPresenceReader;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * 채팅의 두 규칙을 판정하는 <b>유일한</b> 관문.
 *
 * <p>관문이 하나여야 하는 이유는 입구가 넷이기 때문이다 — STOMP SUBSCRIBE · SEND · 아웃바운드,
 * 그리고 REST 히스토리·읽음. 규칙을 각 입구에 흩어 쓰면 나중에 입구를 하나 더 낼 때 검사를 빠뜨리게
 * 되고, 빠뜨린 입구는 «되긴 되는데 규칙만 안 걸리는» 상태라 테스트로도 잘 안 잡힌다.
 *
 * <h2>검사 순서가 계약이다</h2>
 * <b>집중을 먼저 보고, 그다음 멤버십을 본다.</b> 순서를 뒤집으면 남의 섬 id 를 찔러 본 사람이
 * {@code NOT_A_MEMBER} 대신 {@code FOCUS_IN_PROGRESS} 를 받게 되고... 그건 사실 문제가 아니다.
 * 진짜 이유는 반대다 — <b>집중 검사는 Redis 조회 1회, 멤버십 검사는 캐시 미스 시 서버 간 HTTP 왕복</b>
 * 이라, 싼 검사를 먼저 둬야 집중 중인 유저가 상류를 두드리지 않는다.
 *
 * <p>대신 그 순서에는 대가가 있다: 집중 중인 사람은 자기가 «그 방의 멤버가 아니라는» 사실을
 * 집중이 끝나기 전에는 알 수 없다. 채팅에서 그 정도 지연은 무해하다고 보고 수용한다.
 */
@Component
@RequiredArgsConstructor
public class ChatAccessGuard {

    private final FocusPresenceReader focusPresenceReader;
    private final MembershipService membershipService;

    /**
     * 「지금 이 사람이 이 섬의 채팅에 들어올 수 있는가」.
     *
     * <p>불린을 돌려주지 않고 예외를 던지는 이유는 <b>거절 사유가 둘이고 앱이 그 둘을 다르게 그려야
     * 하기 때문</b>이다. 불린으로 접으면 호출부가 사유를 다시 만들어 내야 하고, 그러다 보면 입구마다
     * 다른 코드가 나가게 된다.
     *
     * @param groupId 들어가려는 섬
     * @param userId 요청자
     * @param bearerToken 요청자의 {@code Authorization} 헤더 통째로(멤버십 캐시 미스 시 상류 조회에 쓰인다)
     * @throws ChatException {@code FOCUS_IN_PROGRESS} — 집중 세션이 진행 중이다;
     *                       {@code NOT_A_MEMBER} — 그 섬의 활성 멤버가 아니다(없는 섬도 여기로 합쳐진다)
     * @throws com.oneorthree.realtime.common.exception.UpstreamUnavailableException
     *         멤버십 판정을 내릴 수 없을 때 — 통과시키지 않는다
     */
    public void requireCanChat(UUID groupId, UUID userId, String bearerToken) {
        requireNotFocusing(userId);
        if (!membershipService.isMember(groupId, userId, bearerToken)) {
            throw new ChatException(ChatErrorCode.NOT_A_MEMBER);
        }
    }

    /**
     * 섬을 특정하지 않는 입구(방 목록 조회, 중복 응답 전달)용 — 집중 여부만 본다.
     *
     * <p>실시간 CONNECT는 인증만 수행한다. 이 검사는 채팅을 소비하는 경계에만 적용한다.
     */
    public void requireNotFocusing(UUID userId) {
        if (focusPresenceReader.isFocusing(userId)) {
            throw new ChatException(ChatErrorCode.FOCUS_IN_PROGRESS);
        }
    }
}
