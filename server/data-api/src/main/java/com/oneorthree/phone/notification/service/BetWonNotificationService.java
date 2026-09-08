package com.oneorthree.phone.notification.service;

import com.fasterxml.uuid.Generators;
import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.event.GroupBetWonEvent;
import com.oneorthree.phone.notification.repository.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.repository.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 승리 확정 푸시 {@code BET_WON} (PRD FR-43 — "목표를 채운 순간, 본인에게").
 *
 * <p><b>왜 결과 알림과 다른 취급인가.</b> 이건 <b>본인 1명</b>에게 가는 즉시 알림이라 묶음
 * (유저 × 그룹 × 슬롯)의 대상이 아니다 — 축하는 늦으면 의미가 없고, 같은 슬롯에 겹칠 상대도
 * 사실상 없다(한 사람이 같은 15분에 여러 회차를 동시에 달성하는 경우는 예외적이다). 그래서
 * 클레임 → 즉시 발송이고, 슬롯 누적을 거치는 {@link BetEventNotificationService} 와 kind 가 갈린다.
 *
 * <p>dedup 축은 같다(N41) — {@code (user, BET_WON, 회차 id)} 선점. 조기 확정은 회차당 1회지만
 * 이벤트 재발행·재시도에 대한 안전망이다.
 *
 * <p><b>조용한 시간이면 이월하지 않고 버린다</b>(N44 단서) — 07:00에 도착하는 "방금 달성했어요"는
 * 거짓말이고, 그 회차의 결과는 어차피 정산 후 {@code BET_RESULT} 가 전한다(중복 통지 방지).
 *
 * <p>회차를 <b>다시 조회하지 않는다</b> — 이벤트가 수신자·딥링크 축({@code userId}·{@code groupId}
 * ·{@code challengeId})을 이미 싣고 있다(GroupBetWonEvent javadoc).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BetWonNotificationService {

    /** 결과 모달을 열지 않는다 — 승패 표시는 그룹방까지다(IA §4.2 BET_WON = groupId + challengeId). */
    static final String PUSH_TYPE = NotificationSentLog.TYPE_BET_WON;

    private final UserQueryService userQueryService;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final PushNotificationService pushNotificationService;

    /**
     * 발송 본체 — 진입점(커밋 이후·비동기)은 {@code BetWonNotificationListener} 가 맡는다.
     *
     * <p>{@link Propagation#REQUIRES_NEW} — 무효 토큰 정리와 클레임 기록에 쓰기 트랜잭션이 필요한데
     * 이 메서드는 원 트랜잭션이 커밋을 마친 뒤에 불린다(종료 중인 트랜잭션에 합류하면 쓰기가 조용히
     * 사라진다 — ChallengeCreatedNotificationService 와 같은 이유).
     *
     * @param event 승리가 확정된 참가자. 그 사이 탈퇴한 유저면 발송하지 않는다
     * @param now   중복 발송을 막는 dedup 창의 기준 시각
     * @return 실제 발송이 성사되면 true
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean sendWonNotification(GroupBetWonEvent event, Instant now) {
        User user = userQueryService.findActive(event.userId()).orElse(null);
        if (user == null) {
            return false;
        }
        UUID rowId = Generators.timeBasedEpochRandomGenerator().generate();
        // 슬롯 메타는 발송 시각 그대로 — 묶음 대상이 아니라 조회·감사용이다.
        int claimed = notificationSentLogRepository.insertPendingClaim(rowId, user.getId(),
                NotificationSentLog.TYPE_BET_WON, event.sessionId(), event.groupId(), now, now);
        if (claimed == 0) {
            return false;   // 이미 나갔거나 다른 워커가 선점
        }
        UserNotificationSettings settings =
                userQueryService.findNotificationSettings(user.getId()).orElse(null);
        if (PushNotificationService.isQuietHours(settings, now)) {
            // 이월하지 않고 종결한다 — 지연된 축하는 의미가 없고, 결과는 BET_RESULT 가 전한다.
            notificationSentLogRepository.updateStatusByIds(
                    List.of(rowId), NotificationSendStatus.SENT, now);
            return false;
        }
        boolean soundEnabled = settings == null || settings.isSoundEnabled();
        try {
            if (pushNotificationService.sendIfAllowed(user, settings, compose(event, soundEnabled), now)) {
                notificationSentLogRepository.updateStatusByIds(
                        List.of(rowId), NotificationSendStatus.SENT, now);
                log.info("승리 확정 푸시 — userId={}, sessionId={}", user.getId(), event.sessionId());
                return true;
            }
        } catch (RuntimeException e) {
            notificationSentLogRepository.deleteByIds(List.of(rowId));
            throw e;
        }
        // 필터 스킵·발송 실패 — 선점을 반납한다(조기 확정은 재발행이 드물어 재시도 경로는 얇다).
        notificationSentLogRepository.deleteByIds(List.of(rowId));
        return false;
    }

    /** payload = groupId + challengeId(IA §4.2). link 는 싣지 않는다 — 앱이 groupId 로 합성한다. */
    PushMessage compose(GroupBetWonEvent event, boolean soundEnabled) {
        Map<String, String> data = new LinkedHashMap<>();
        data.put("type", PUSH_TYPE);
        data.put("groupId", event.groupId().toString());
        data.put("challengeId", event.challengeId().toString());
        return new PushMessage("목표 달성! 🎉", "승리가 확정됐어요 — 정산되면 적립금이 들어와요",
                null, soundEnabled, data);
    }
}
