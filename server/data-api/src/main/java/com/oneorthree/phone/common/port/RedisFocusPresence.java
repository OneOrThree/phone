package com.oneorthree.phone.common.port;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Duration;
import java.util.UUID;

/**
 * {@code presence:focus:{userId}} 리스를 놓고 지운다 (GROMO-292).
 *
 * <p>이 서비스가 <b>유일한 쓰기 주인</b>이다(A19). 채팅 서버는 같은 키를 읽기 전용 ACL 로만 받는다 —
 * 읽는 쪽이 지울 수 있게 되는 순간 「집중 중엔 채팅 불가」는 채팅이 스스로 해제할 수 있는 규칙이 된다.
 *
 * <h2>값이 아니라 «존재»가 신호다</h2>
 * 값으로 {@code "1"} 을 넣지만 읽는 쪽은 그 값을 보지 않기로 약속했다. 값을 해석하기 시작하면 이 파일의
 * 포맷이 곧 채팅과의 계약이 되어, 여기를 바꾸는 순간 저쪽이 조용히 오판한다.
 *
 * <h2>커밋 이후에만 반영한다</h2>
 * 트랜잭션 안에서 리스를 놓으면 롤백됐을 때 <b>세션은 없는데 리스만 남는다</b> — 그 사람은 TTL 이
 * 끝날 때까지 채팅에 못 들어간다. 그래서 트랜잭션이 열려 있으면 {@code AFTER_COMMIT} 으로 미룬다.
 * 트랜잭션 밖에서 불리면(테스트 등) 즉시 실행한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "focus.presence.enabled", havingValue = "true")
public class RedisFocusPresence implements FocusPresencePort {

    /**
     * 리스 수명 = orphan 자동 종료 임계값(12h) + 스윕 주기 여유(1h).
     *
     * <p>이 정렬이 계약이다. 진행 중 마커는 아무리 길어도 13시간이면 서버가 닫으므로, 리스가 그보다
     * 오래 살면 <b>이미 끝난 집중 때문에 채팅이 막히는</b> 상태가 된다. 반대로 이보다 짧게 잡으면
     * 진짜 집중 중인데 리스가 먼저 사라져 규칙이 조용히 풀린다.
     *
     * <p>TTL 은 «백스톱»이지 «메커니즘»이 아니다 — 정상 경로에서는 종료가 리스를 지운다.
     */
    private static final Duration LEASE_TTL = Duration.ofHours(13);

    private static final String KEY_PREFIX = "presence:focus:";

    private final StringRedisTemplate redis;

    @Override
    public void focusStarted(UUID userId) {
        afterCommit(() -> redis.opsForValue().set(key(userId), "1", LEASE_TTL), "리스 설정", userId);
    }

    @Override
    public void focusEnded(UUID userId) {
        afterCommit(() -> redis.delete(key(userId)), "리스 해제", userId);
    }

    private static String key(UUID userId) {
        return KEY_PREFIX + userId;
    }

    /**
     * 커밋 뒤에 실행하고, 실패는 삼킨다.
     *
     * <p>{@code AFTER_COMMIT} 콜백에서 던진 예외는 이미 커밋된 트랜잭션을 되돌리지 못하고 호출부로
     * 올라가 <b>성공한 요청을 실패로 보이게</b> 한다. 그래서 여기서 잡는다 — 이 포트의 실패는
     * 집중을 막지 않는다는 계약({@link FocusPresencePort})이 이 catch 하나에 걸려 있다.
     */
    private void afterCommit(Runnable action, String what, UUID userId) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            run(action, what, userId);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                run(action, what, userId);
            }
        });
    }

    private void run(Runnable action, String what, UUID userId) {
        try {
            action.run();
        } catch (RuntimeException e) {
            log.warn("집중 프레즌스 {} 실패 — userId={}", what, userId, e);
        }
    }
}
