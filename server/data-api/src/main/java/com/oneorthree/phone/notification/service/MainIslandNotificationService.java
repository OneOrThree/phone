package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.group.event.MainIslandTransferredEvent;
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

/** 메인 섬 자동 이전 사실을 같은 트랜잭션의 알림 요청으로 조립한다. */
@Service
@RequiredArgsConstructor
public class MainIslandNotificationService {
    private final UserQueryService userQueryService;

    /** 연속 이전은 서로 다른 사실이다. 현재 섬으로 다시 거르지 않고 수신자 활성만 확인한다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<NotificationRequest> transferredRequest(MainIslandTransferredEvent event) {
        User recipient = userQueryService.findActive(event.userId()).orElse(null);
        if (recipient == null) {
            return Optional.empty();
        }
        return Optional.of(new NotificationRequest(
                NotificationKind.MAIN_ISLAND_TRANSFERRED, event.userId(), event.islandId(),
                event.occurredAt(), recipient.getLanguage(),
                Map.of("islandId", event.islandId().toString(), "islandName", event.islandName())));
    }
}
