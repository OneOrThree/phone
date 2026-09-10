package com.oneorthree.phone.common.port;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

/**
 * {@code presence:focus:{userId}} 리스를 놓고 지운다 (GROMO-292).
 *
 * <p>이 서비스가 <b>유일한 쓰기 주인</b>이다(A19). 채팅 서버는 같은 키를 읽기 전용 ACL 로만 받는다 —
 * 읽는 쪽이 지울 수 있게 되는 순간 「집중 중엔 채팅 불가」는 채팅이 스스로 해제할 수 있는 규칙이 된다.
 *
 * <h2>값은 세션 id 다 — 읽는 쪽은 여전히 «존재»만 본다</h2>
 * 값을 싣는 이유는 읽는 쪽에 정보를 주려는 게 아니라 <b>쓰기끼리의 순서를 정하기 위해서</b>다.
 * 채팅은 존재 여부만 보기로 약속했고 그 약속은 그대로다 — 값의 의미는 이 클래스만 안다.
 *
 * <h2>왜 조건부 연산인가 (단순 SET/DEL 이면 13시간 차단이 난다)</h2>
 * 커밋 이후 콜백은 트랜잭션마다 다른 스레드에서 돌아서, 서로 다른 요청의 Redis 연산이 DB 커밋 순서와
 * <b>어긋난 순서로 도착</b>할 수 있다(뽀모도로 회전처럼 종료와 시작이 겹치는 순간). 값 없는 SET/DEL 이면:
 * <ul>
 *   <li>시작의 {@code SET} 이 종료의 {@code DEL} <b>뒤에</b> 도착 → 이미 끝난 집중의 리스가 되살아나
 *       <b>최대 13시간 채팅이 막힌다</b></li>
 *   <li>종료의 {@code DEL} 이 새 시작의 {@code SET} 뒤에 도착 → 진행 중인 집중의 리스가 사라진다
 *       (수용하는 방향이지만 역시 틀린 상태다)</li>
 * </ul>
 *
 * <p>세션 id 비교만으로는 <b>한 방향이 남는다</b> — 지연된 시작 콜백이 종료 «뒤에» 도착하면 그때 리스
 * 키는 비어 있어서 「더 새로운가」 비교가 무의미해지고 이미 끝난 집중의 리스가 되살아난다. 그래서
 * 종료가 {@link #CLOSED_SUFFIX} 표식을 함께 남기고, 시작은 그 표식보다 새로울 때만 쓴다.
 * 그래서 두 연산 모두 Lua 로 <b>조건부</b>다: 쓰기는 「지금 값보다 새로운 세션일 때만」, 해제는
 * 「지금 값이 바로 그 세션일 때만」. 세션 id 가 UUID v7 이라 <b>문자열 사전순 비교 = 시간 순서</b>이고
 * (앞자리가 epoch 밀리초의 상위 비트), 그래서 「더 새로움」을 Redis 안에서 판정할 수 있다.
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
     * <p>TTL 은 «백스톱»이지 «메커니즘»이 아니다 — 정상 경로에서는 종료가 리스를 지운다. 유저가
     * 끝내지 않은 세션(앱 강제종료)은 orphan 스윕이 마감하면서 함께 지운다
     * ({@code FocusService#sweepOrphanSessions}). 그 배선이 빠지면 TTL 이 «백스톱»이 아니라 «유일한
     * 해제 수단»이 되어, 이미 끝난 집중 때문에 하루 가까이 채팅이 막히는 상태가 실제로 생긴다.
     */
    private static final Duration LEASE_TTL = Duration.ofHours(13);

    private static final String KEY_PREFIX = "presence:focus:";

    /**
     * 「이 세션은 이미 끝났다」 표식. <b>리스와 다른 키</b>라 읽는 쪽({@code presence:focus:{userId}} 만
     * 본다)에는 보이지 않는다.
     *
     * <p>이게 없으면 마지막 한 방향이 남는다 — <b>지연된 시작 콜백이 종료 뒤에 도착</b>하는 경우.
     * 그때 리스 키는 비어 있으므로({@code cur == false}) 「더 새로운가」 비교가 무의미해지고, 이미
     * 끝난 집중의 리스가 되살아나 <b>TTL 13시간 내내 채팅이 막힌다</b>. 표식이 있으면 그 시작은
     * 「이미 끝난(또는 더 오래된) 세션」으로 걸러진다.
     */
    private static final String CLOSED_SUFFIX = ":closed";

    /**
     * 표식 수명. 막아야 하는 창은 「커밋 이후 콜백이 다음 종료보다 늦게 도착하는」 정도라 초 단위지만,
     * 넉넉히 잡아도 비용이 키 하나뿐이다. 반대로 너무 길게 잡으면 정상적인 재시작이 막힐 수 있는데,
     * 새 세션은 항상 더 «새로운» id 라 표식보다 크므로 그 걱정은 없다.
     */
    private static final Duration CLOSED_TTL = Duration.ofMinutes(5);

    /**
     * 「지금 값이 없거나, 내가 더 새로우면 쓴다」.
     *
     * <p>{@code >=} 인 것은 같은 세션으로 다시 오는 시작(순서 역전 방어 경로에서 열린 마커의 id 를
     * 그대로 싣는 경우)이 TTL 을 갱신할 수 있어야 하기 때문이다.
     */
    private static final RedisScript<Long> SET_IF_NEWER = new DefaultRedisScript<>(
            // KEYS[1]=리스, KEYS[2]=끝난 세션 표식 / ARGV[1]=sessionId, ARGV[2]=리스 TTL(초)
            "local closed = redis.call('GET', KEYS[2])\n"
            + "if closed ~= false and ARGV[1] <= closed then\n"
            + "  return 0\n"                                    // 이미 끝난(또는 더 오래된) 세션의 지연 도착
            + "end\n"
            + "local cur = redis.call('GET', KEYS[1])\n"
            + "if cur == false or ARGV[1] >= cur then\n"
            + "  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])\n"
            + "  return 1\n"
            + "end\n"
            + "return 0", Long.class);

    /**
     * 「지금 값이 <b>나보다 새롭지 않을 때만</b> 지운다」 — 같거나 더 오래된 리스를 치운다.
     *
     * <p>「정확히 같을 때만」이 아닌 이유는 <b>잔존 리스를 스스로 치우기 위해서</b>다. 뽀모도로 회전은
     * 이전 마커를 닫고 새 마커를 여는데, 그 사이 Redis 쓰기가 한 번 실패하면 키에 <b>이미 닫힌</b>
     * 이전 세션 id 가 남는다. 그 마커는 종료됐으니 고아 스윕 대상도 아니라서, 엄격한 동일 비교로는
     * 새 세션을 정상 종료해도 그 키를 못 지운다 — 그 사람은 남은 TTL(최대 13시간) 내내 막힌다.
     *
     * <p>더 오래된 리스를 지우는 것이 안전한 근거는 <b>「유저당 열린 마커는 1개」</b> 불변식이다
     * ({@code FocusService#startFocusSession} 의 {@code autoCloseOpenMarkersOf}). 내 세션이 끝나는
     * 시점에 나보다 오래된 세션이 아직 열려 있을 수는 없다.
     *
     * <p>반대로 <b>나보다 새로운</b> 리스는 건드리지 않는다 — 그 사이 시작된 집중을 푸는 셈이 된다.
     */
    private static final RedisScript<Long> DELETE_IF_NOT_NEWER = new DefaultRedisScript<>(
            // KEYS[1]=리스, KEYS[2]=끝난 세션 표식 / ARGV[1]=sessionId, ARGV[2]=표식 TTL(초)
            // 표식을 «먼저» 남긴다 — 리스가 이미 다른 세션 것이어서 지우지 못하더라도, 이 세션의
            // 지연된 시작이 나중에 되살리는 건 막아야 하기 때문이다.
            "local closed = redis.call('GET', KEYS[2])\n"
            + "if closed == false or ARGV[1] > closed then\n"
            + "  redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])\n"
            + "end\n"
            + "local cur = redis.call('GET', KEYS[1])\n"
            + "if cur ~= false and cur <= ARGV[1] then\n"
            + "  return redis.call('DEL', KEYS[1])\n"
            + "end\n"
            + "return 0", Long.class);

    private final StringRedisTemplate redis;

    @Override
    public void focusStarted(UUID userId, UUID sessionId) {
        if (sessionId == null) {
            // 가리킬 세션이 없으면 순서를 정할 근거도 없다. 무조건 쓰면 늦게 도착한 옛 시작이
            // 진행 중인 새 집중을 덮어써, 종료가 «자기 것»을 못 알아보고 리스가 남는다.
            log.debug("세션 id 없는 집중 시작 — 프레즌스 생략, userId={}", userId);
            return;
        }
        afterCommit(() -> redis.execute(SET_IF_NEWER, List.of(key(userId), closedKey(userId)),
                sessionId.toString(), String.valueOf(LEASE_TTL.toSeconds())), "리스 설정", userId);
    }

    @Override
    public void focusEnded(UUID userId, UUID sessionId) {
        if (sessionId == null) {
            // 어느 리스를 지워야 할지 모르는 채로 지우면 그 사이 시작된 새 집중을 푸는 셈이 된다.
            // 그 경우의 백스톱은 TTL 과 orphan 스윕이다.
            log.debug("세션 id 없는 집중 종료 — 프레즌스 생략, userId={}", userId);
            return;
        }
        afterCommit(() -> redis.execute(DELETE_IF_NOT_NEWER, List.of(key(userId), closedKey(userId)),
                sessionId.toString(), String.valueOf(CLOSED_TTL.toSeconds())), "리스 해제", userId);
    }

    private static String key(UUID userId) {
        return KEY_PREFIX + userId;
    }

    /** 「이 세션은 끝났다」 표식 키. 읽는 쪽은 이 키를 모른다 — 리스 키와 이름이 다르다. */
    private static String closedKey(UUID userId) {
        return KEY_PREFIX + userId + CLOSED_SUFFIX;
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
