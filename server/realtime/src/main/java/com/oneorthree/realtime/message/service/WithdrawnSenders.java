package com.oneorthree.realtime.message.service;

import com.oneorthree.realtime.message.repository.domain.ChatMessage;
import com.oneorthree.realtime.tombstone.UserTombstoneRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 보존 메시지 목록의 발신자 중 탈퇴자를 한 번에 가린다 (GROMO-1946 · 계정 LLD §4 「보존 메시지의 공개 발신자 식별자」).
 *
 * <p>히스토리·방 목록 최신 메시지·재전송 응답이 모두 {@code ChatMessageResponse.from(m, among(...))} 를 탄다.
 * tombstone 은 {@code user.withdrawn} 소비자가 커밋한 뒤에만 생기므로 그 전의 비동기 지연 동안은 실제
 * 발신자가 그대로 보인다(LLD 가 수용한 지연).
 */
@Component
@RequiredArgsConstructor
public class WithdrawnSenders {

    private final UserTombstoneRepository tombstones;

    /**
     * @param messages 응답으로 나갈 메시지들
     * @return 그 발신자 중 탈퇴한 사용자. 메시지가 없으면 조회하지 않는다
     */
    public Set<UUID> among(Collection<ChatMessage> messages) {
        Set<UUID> senders = messages.stream().map(ChatMessage::getSenderId).collect(Collectors.toSet());
        return senders.isEmpty() ? Set.of() : tombstones.findWithdrawnAmong(senders);
    }
}
