package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.group.event.GroupChallengeCreatedEvent;
import com.oneorthree.phone.config.NotificationAsyncConfig;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.service.ChallengeCreatedNotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Instant;

/**
 * 새 챌린지 등록 알림(GROMO-1089)의 <b>진입점</b> — 발송 로직은
 * {@link ChallengeCreatedNotificationService} 가 갖는다.
 *
 * <p>크론 진입점을 {@code scheduler/NotificationScheduler} 로 분리해 둔 것과 같은 구조다.
 * 여기서 하는 일은 셋뿐이다: <b>언제</b> 도느냐(커밋 이후), <b>어느 스레드</b>에서 도느냐(전용 풀),
 * 그리고 실패를 어디서 삼키느냐.
 *
 * <p><b>진입점을 굳이 분리하는 이유.</b> {@code @Async} 와 {@code @Transactional} 을 한 메서드에
 * 겹쳐 걸면 "비동기 디스패치가 먼저, 그 다음 트랜잭션 시작" 이라는 순서가 스프링 내부 규칙
 * ({@code AsyncAnnotationBeanPostProcessor} 가 {@code setBeforeExistingAdvisors(true)} 로 비동기
 * 어드바이저를 기존 어드바이저 앞에 끼운다) 에 의존하게 된다. 실제로 그렇게 돌긴 하지만 코드만
 * 봐서는 확인할 수 없다 — 순서가 뒤집히면 커밋 스레드에서 트랜잭션이 열렸다가 본문 실행 전에
 * 커밋돼 버리고, 정작 발송은 트랜잭션 없는 워커 스레드에서 돌아 무효 토큰 정리와 발송 로그
 * 저장이 조용히 사라진다(@claude 리뷰 지적). 빈을 갈라 두면 비동기 경계를 넘은 뒤에야 트랜잭션이
 * 시작된다는 것이 <b>호출 구조로</b> 드러난다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ChallengeCreatedNotificationListener {

    private final NotificationDispatcher notificationDispatcher;
    private final ChallengeCreatedNotificationService challengeCreatedNotificationService;

    /**
     * 챌린지 생성 커밋 이후 발송을 시작한다.
     *
     * <p>{@link TransactionPhase#AFTER_COMMIT} — 생성이 롤백되면 리스너까지 오지 않는다.
     * {@code @Async} — FCM 은 유저 1명당 blocking 호출이고 타임아웃 설정도 없어서, 요청 스레드에
     * 그대로 얹으면 이미 커밋된 챌린지 생성이 클라이언트에는 지연·실패로 보인다.
     *
     * <p>예외를 밖으로 흘리지 않는다. 여기서 터져도 챌린지 생성은 이미 성사된 사실이고, 별도
     * 스레드라 호출측에 전달할 곳도 없다(전달되면 {@code AsyncUncaughtExceptionHandler} 기본
     * 동작으로 스택만 찍힌다). 어느 챌린지에서 났는지 남기는 편이 추적에 낫다.
     *
     * @param event 개설된 챌린지. 생성이 롤백되면 이 리스너까지 오지 않는다
     */
    @Async(NotificationAsyncConfig.PUSH_EXECUTOR)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onChallengeCreated(GroupChallengeCreatedEvent event) {
        if (notificationDispatcher.isOutboxMode()) {
            // 신 경로에서는 BEFORE_COMMIT 리스너가 이미 사건을 적었다. 여기서 또 처리하면 같은
            // 알림이 FCM 으로도 가고 Kafka 로도 간다 — 챌린지 개설 알림이 두 번 도착한다.
            return;
        }
        try {
            challengeCreatedNotificationService.sendCreatedNotifications(event, Instant.now());
        } catch (RuntimeException e) {
            log.warn("챌린지 개설 푸시 처리 실패 — challengeId={}, groupId={}",
                    event.challengeId(), event.groupId(), e);
        }
    }
}
