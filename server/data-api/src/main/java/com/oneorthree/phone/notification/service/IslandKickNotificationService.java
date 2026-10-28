package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.group.event.IslandKickedEvent;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.NotificationRequest;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.Optional;

/** 섬 강퇴 사실을 알리는 요청을 만든다. 리스너가 도메인 트랜잭션 안에서 outbox에 기록한다. */
@Service
@RequiredArgsConstructor
public class IslandKickNotificationService {
    private final UserQueryService userQueryService;

    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<NotificationRequest> kickedRequest(IslandKickedEvent event) {
        User recipient = userQueryService.findActive(event.userId()).orElse(null);
        if (recipient == null) {
            return Optional.empty();
        }
        return Optional.of(new NotificationRequest(NotificationKind.ISLAND_KICKED,
                event.userId(), event.islandId(), event.occurredAt(), recipient.getLanguage(),
                Map.of("islandId", event.islandId().toString(), "islandName", event.islandName())));
    }
}
