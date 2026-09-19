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

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * {@code presence:focus:{userId}} 리스를 놓고 지운다 (GROMO-292).
 *
 * <p>이 서비스가 <b>유일한 쓰기 주인</b>이다(A19). 채팅 서버는 같은 키를 읽기 전용 ACL 로만 받는다 —
 * 읽는 쪽이 지울 수 있게 되는 순간 「집중 중엔 채팅 불가」는 채팅이 스스로 해제할 수 있는 규칙이 된다.
 *
 * <h2>값은 세션 순번이다 — 읽는 쪽은 여전히 «존재»만 본다</h2>
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
 * <p>순번 비교만으로는 <b>한 방향이 남는다</b> — 지연된 시작 콜백이 종료 «뒤에» 도착하면 그때 리스
 * 키는 비어 있어서 「더 새로운가」 비교가 무의미해지고 이미 끝난 집중의 리스가 되살아난다. 그래서
 * 종료가 {@link #CLOSED_SUFFIX} 표식을 함께 남기고, 시작은 그 표식보다 새로울 때만 쓴다.
 * 그래서 두 연산 모두 Lua 로 <b>조건부</b>다: 쓰기는 「지금 값보다 새로운 세션일 때만」, 해제는
 * 「지금 값이 나보다 새롭지 않을 때만」. 값은 {@code focus_sessions.presence_order}(DB 시퀀스)이고
 * Lua 가 {@code tonumber} 로 <b>숫자 비교</b>한다 — 문자열 비교면 자리수가 바뀌는 순간 {@code "9" > "10"} 이 된다.
 *
 * <h2>왜 세션 id(UUID v7)가 아닌가 (GROMO-1743)</h2>
 * 예전엔 UUID v7 의 문자열 사전순을 시간 순서로 썼다. 그런데 그 앞자리는 <b>id 를 만든 인스턴스의
 * 벽시계</b>라, data-api 를 여러 대로 늘리면 시계가 앞선 대가 만든 «이전» 세션 id 가 뒤처진 대가 만든
 * «다음» 세션 id 보다 커진다 — 정상적인 새 시작이 「더 오래됐다」로 걸러지거나, 늦게 온 종료가 진행 중인
 * 리스를 지운다. 공유 저장소(DB 시퀀스)가 발급한 번호는 어느 인스턴스가 INSERT 했든 같은 축이고,
 * 같은 사용자의 시작은 users 행 배타 락 아래서 INSERT 되므로 번호 순서가 곧 커밋 순서다.
 *
 * <p><b>배포 경계</b>: V77 이전에 놓인 값은 세션 id 문자열이라 {@code tonumber} 가 {@code nil} 을 준다.
 * 스크립트는 그것을 «어떤 순번보다도 오래된 값»으로 본다 — 새 시작은 덮어쓰고, 새 종료는 지운다.
 * 열린 마커는 V77 이 번호를 채웠으니(유저당 1건) 그 종료가 옛 리스를 치운다. 「유저당 열린 마커 1개」
 * 불변식 아래서 번호 있는 세션이 끝날 때 그보다 새로운 옛 세션이 열려 있을 수는 없다. 옛 jar 가 UUID 를,
 * 새 jar 가 순번을 동시에 쓰는 다중 인스턴스 롤링 배포는 다루지 않는다 — 지금 운영은 단일 컨테이너를 재생성한다.
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
     * 새 세션은 항상 더 큰 순번이라 표식보다 크므로 그 걱정은 없다.
     */
    private static final Duration CLOSED_TTL = Duration.ofMinutes(5);

    /**
     * 「지금 값이 없거나, 내가 더 새로우면 쓴다」.
     *
     * <p>{@code >=} 인 것은 같은 세션으로 다시 오는 시작(순서 역전 방어 경로에서 열린 마커의 순번을
     * 그대로 싣는 경우)이 TTL 을 갱신할 수 있어야 하기 때문이다.
     */
    private static final RedisScript<Long> SET_IF_NEWER = new DefaultRedisScript<>(
            // KEYS[1]=리스, KEYS[2]=끝난 세션 표식, KEYS[3]=탈퇴 tombstone / ARGV[1]=순번, ARGV[2]=리스 TTL(초)
            // tonumber(false|옛 UUID 값) = nil — 없거나 V77 이전 값이면 «더 오래된 것»으로 본다.
            "if redis.call('GET', KEYS[3]) ~= false then\n"
            + "  return 0\n"                                    // 탈퇴자 — 늦게 온 시작이 리스를 되살리지 않는다
            + "end\n"
            + "local order = tonumber(ARGV[1])\n"
            + "local closed = tonumber(redis.call('GET', KEYS[2]))\n"
            + "if closed ~= nil and order <= closed then\n"
            + "  return 0\n"                                    // 이미 끝난(또는 더 오래된) 세션의 지연 도착
            + "end\n"
            + "local cur = tonumber(redis.call('GET', KEYS[1]))\n"
            + "if cur == nil or order >= cur then\n"
            + "  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])\n"
            + "  return 1\n"
            + "end\n"
            + "return 0", Long.class);

    /**
     * 「리스가 <b>비어 있을 때만</b> 놓는다」 — 재구축 전용.
     *
     * <p>{@link #SET_IF_NEWER} 와 갈라 둔 이유는 <b>있는 리스를 절대 만지지 않기</b> 위해서다.
     * 재구축은 주기적으로 도는데, 매 회차가 TTL 을 지금부터 다시 13시간으로 밀면 고아 스윕이 멈춘
     * 동안 「끝난 집중이 채팅을 막는」 창이 13시간에서 25시간(12h 조회 상한 + 13h TTL)으로 늘어난다.
     * 채우기만 하면 그 창은 원래대로다.
     *
     * <p>「끝났다」 표식 검사는 그대로다 — 조회와 쓰기 사이에 끝난 세션이 되살아나면 안 된다.
     */
    private static final RedisScript<Long> SET_IF_ABSENT = new DefaultRedisScript<>(
            // KEYS[1]=리스, KEYS[2]=끝난 세션 표식, KEYS[3]=탈퇴 tombstone / ARGV[1]=순번, ARGV[2]=리스 TTL(초)
            "if redis.call('EXISTS', KEYS[1]) == 1 then\n"
            + "  return 0\n"                                   // 이미 있다 — 남의 것일 수도 있으니 손대지 않는다
            + "end\n"
            + "if redis.call('GET', KEYS[3]) ~= false then\n"
            + "  return 0\n"                                   // 탈퇴자 — 재구축도 리스를 되살리지 않는다
            + "end\n"
            + "local closed = tonumber(redis.call('GET', KEYS[2]))\n"
            + "if closed ~= nil and tonumber(ARGV[1]) <= closed then\n"
            + "  return 0\n"                                   // 조회 뒤에 끝난 세션 — 되살리지 않는다
            + "end\n"
            + "redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])\n"
            + "return 1", Long.class);

    /**
     * 「지금 값이 <b>나보다 새롭지 않을 때만</b> 지운다」 — 같거나 더 오래된 리스를 치운다.
     *
     * <p>「정확히 같을 때만」이 아닌 이유는 <b>잔존 리스를 스스로 치우기 위해서</b>다. 뽀모도로 회전은
     * 이전 마커를 닫고 새 마커를 여는데, 그 사이 Redis 쓰기가 한 번 실패하면 키에 <b>이미 닫힌</b>
     * 이전 세션 순번이 남는다. 그 마커는 종료됐으니 고아 스윕 대상도 아니라서, 엄격한 동일 비교로는
     * 새 세션을 정상 종료해도 그 키를 못 지운다 — 그 사람은 남은 TTL(최대 13시간) 내내 막힌다.
     *
     * <p>더 오래된 리스를 지우는 것이 안전한 근거는 <b>「유저당 열린 마커는 1개」</b> 불변식이다
     * ({@code FocusService#startFocusSession} 의 {@code autoCloseOpenMarkersOf}). 내 세션이 끝나는
     * 시점에 나보다 오래된 세션이 아직 열려 있을 수는 없다.
     *
     * <p>반대로 <b>나보다 새로운</b> 리스는 건드리지 않는다 — 그 사이 시작된 집중을 푸는 셈이 된다.
     */
    private static final RedisScript<Long> DELETE_IF_NOT_NEWER = new DefaultRedisScript<>(
            // KEYS[1]=리스, KEYS[2]=끝난 세션 표식, KEYS[3]=탈퇴 tombstone / ARGV[1]=순번, ARGV[2]=표식 TTL(초)
            // 탈퇴자면 표식을 새로 남기지 않는다 — tombstone 이 이미 모든 시작을 막고, 표식도 사용자 키다.
            // 표식을 «먼저» 남긴다 — 리스가 이미 다른 세션 것이어서 지우지 못하더라도, 이 세션의
            // 지연된 시작이 나중에 되살리는 건 막아야 하기 때문이다.
            "if redis.call('GET', KEYS[3]) ~= false then\n"
            + "  return redis.call('DEL', KEYS[1], KEYS[2])\n"
            + "end\n"
            + "local order = tonumber(ARGV[1])\n"
            + "local closed = tonumber(redis.call('GET', KEYS[2]))\n"
            + "if closed == nil or order > closed then\n"
            + "  redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])\n"
            + "end\n"
            + "local raw = redis.call('GET', KEYS[1])\n"
            + "if raw == false then\n"
            + "  return 0\n"
            + "end\n"
            + "local cur = tonumber(raw)\n"
            + "if cur == nil or cur <= order then\n"         // nil = V77 이전 값 — 어떤 순번보다 오래됐다
            + "  return redis.call('DEL', KEYS[1])\n"
            + "end\n"
            + "return 0", Long.class);

    /**
     * 탈퇴 tombstone 접두사 — {@code presence:withdrawn:{userId}} (GROMO-1943).
     *
     * <p>{@code presence:focus:*} 밖에 두는 이유: 그 패턴은 «이 사람 것이 남았는가»를 세는 파기 검사의
     * 대상이고, tombstone 은 파기 뒤에도 남아야 하는 «막는 표식»이다. 같은 패턴에 두면 둘이 섞인다.
     */
    private static final String WITHDRAWN_PREFIX = "presence:withdrawn:";

    /**
     * tombstone 수명 = {@link #LEASE_TTL}.
     *
     * <p>막아야 하는 쓰기는 «탈퇴 전에 시작한 집중»의 리스뿐이다 — 탈퇴 뒤에는 새 집중을 시작할 수 없고,
     * 두 쓰기 경로 모두 리스를 {@code startedAt + LEASE_TTL} 까지만 놓는다. 그러니 탈퇴 시점부터
     * {@code LEASE_TTL} 이 지나면 되살릴 수 있는 리스가 남아 있지 않다. 무기한 보존할 근거가 없다.
     */
    private static final Duration WITHDRAWN_TTL = LEASE_TTL;

    /**
     * 「tombstone 을 놓고 리스·종료 표식을 지운다」 — 한 스크립트라 사이에 끼는 쓰기가 없다.
     * 반복 실행해도 결과가 같다(SET 은 덮어쓰기, DEL 은 없으면 0).
     */
    private static final RedisScript<Long> WITHDRAW = new DefaultRedisScript<>(
            // KEYS[1]=리스, KEYS[2]=끝난 세션 표식, KEYS[3]=탈퇴 tombstone / ARGV[1]=tombstone TTL(초)
            "redis.call('SET', KEYS[3], '1', 'EX', ARGV[1])\n"
            + "return redis.call('DEL', KEYS[1], KEYS[2])", Long.class);

    private final StringRedisTemplate redis;

    /** 남은 리스 수명을 재는 시계. 벽시계를 직접 부르면 테스트가 시간에 묶인다. */
    private final Clock clock;

    @Override
    public void focusStarted(UUID userId, Long presenceOrder, Instant startedAt) {
        if (presenceOrder == null) {
            // 순번이 없으면 순서를 정할 근거도 없다. 무조건 쓰면 늦게 도착한 옛 시작이
            // 진행 중인 새 집중을 덮어써, 종료가 «자기 것»을 못 알아보고 리스가 남는다.
            log.debug("순번 없는 집중 시작 — 프레즌스 생략, userId={}", userId);
            return;
        }
        long ttlSeconds = remainingLeaseSeconds(startedAt);
        if (ttlSeconds <= 0) {
            // 이 마커는 이미 백스톱을 넘겼다. 지금 놓으면 «지금부터» 다시 살아나는 리스가 된다.
            log.debug("백스톱을 넘긴 마커 — 프레즌스 생략, userId={} presenceOrder={}", userId, presenceOrder);
            return;
        }
        afterCommit(() -> redis.execute(SET_IF_NEWER, keys(userId),
                presenceOrder.toString(), String.valueOf(ttlSeconds)), "리스 설정", userId);
    }

    @Override
    public boolean restoreLeaseIfMissing(UUID userId, Long presenceOrder, Instant startedAt) {
        if (presenceOrder == null) {
            log.debug("순번 없는 재구축 요청 — 생략, userId={}", userId);
            return true;
        }
        long ttlSeconds = remainingLeaseSeconds(startedAt);
        if (ttlSeconds <= 0) {
            log.debug("백스톱을 넘긴 마커 — 재구축 생략, userId={} presenceOrder={}", userId, presenceOrder);
            return true;
        }
        try {
            // 커밋을 기다리지 않는다 — 이미 커밋된 정본을 읽어 미러를 맞추는 작업이라 되돌려질 게 없다.
            redis.execute(SET_IF_ABSENT, keys(userId),
                    presenceOrder.toString(), String.valueOf(ttlSeconds));
            return true;
        } catch (RuntimeException e) {
            // 여기서만 false 다 — 부르는 쪽은 이걸 보고 남은 건을 이어 가지 않는다.
            log.warn("집중 프레즌스 리스 재구축 실패 — userId={}", userId, e);
            return false;
        }
    }

    /**
     * {@code startedAt + }{@link #LEASE_TTL} <b>까지</b> 남은 초.
     *
     * <p>「지금부터 13시간」이 아니라 「시작한 지 13시간」이다. 전자로 잡으면 <b>늦게 놓을수록 백스톱이
     * 뒤로 밀린다</b> — 재구축이 11시간 59분 된 집중의 리스를 그때 처음 놓으면 만료가 시작 기준
     * 25시간이 되어, 고아 스윕이 멈춘 동안 이미 끝난 집중이 하루 넘게 채팅을 막는다. 백스톱의 정의는
     * 「그 집중이 시작한 지 13시간」이다.
     *
     * <p>{@code startedAt} 이 없으면(있어선 안 되지만) 순서를 정할 근거가 없는 경우와 같이 취급해
     * 아무것도 쓰지 않는다 — 0 을 돌려준다.
     *
     * @return 남은 초. 0 이하면 <b>쓰지 않는다</b>
     */
    private long remainingLeaseSeconds(Instant startedAt) {
        if (startedAt == null) {
            return 0;
        }
        return Duration.between(clock.instant(), startedAt.plus(LEASE_TTL)).toSeconds();
    }

    @Override
    public boolean releaseLeaseNow(UUID userId, Long presenceOrder) {
        if (presenceOrder == null) {
            log.debug("순번 없는 재구축 해제 — 생략, userId={}", userId);
            return true;
        }
        try {
            // 스크립트가 0 을 돌려주는 경우(그 사이 새 집중이 리스 주인이 됨)도 «성공»이다 —
            // 남의 리스를 지우지 않는 것이 옳은 결과이고, 다시 시도할 이유가 없다.
            redis.execute(DELETE_IF_NOT_NEWER, keys(userId),
                    presenceOrder.toString(), String.valueOf(CLOSED_TTL.toSeconds()));
            return true;
        } catch (RuntimeException e) {
            // 여기서만 false 다. 부르는 쪽이 다음 회차에 다시 든다.
            log.warn("집중 프레즌스 재구축 해제 실패 — userId={}", userId, e);
            return false;
        }
    }

    @Override
    public void focusEnded(UUID userId, Long presenceOrder) {
        if (presenceOrder == null) {
            // 어느 리스를 지워야 할지 모르는 채로 지우면 그 사이 시작된 새 집중을 푸는 셈이 된다.
            // 그 경우의 백스톱은 TTL 과 orphan 스윕이다.
            log.debug("순번 없는 집중 종료 — 프레즌스 생략, userId={}", userId);
            return;
        }
        afterCommit(() -> redis.execute(DELETE_IF_NOT_NEWER, keys(userId),
                presenceOrder.toString(), String.valueOf(CLOSED_TTL.toSeconds())), "리스 해제", userId);
    }

    @Override
    public void userWithdrawn(UUID userId) {
        afterCommit(() -> redis.execute(WITHDRAW, keys(userId),
                String.valueOf(WITHDRAWN_TTL.toSeconds())), "탈퇴 파기", userId);
    }

    /** 모든 스크립트의 KEYS — 리스 · 끝난 세션 표식 · 탈퇴 tombstone 순서가 계약이다. */
    private static List<String> keys(UUID userId) {
        return List.of(key(userId), closedKey(userId), withdrawnKey(userId));
    }

    private static String key(UUID userId) {
        return KEY_PREFIX + userId;
    }

    /** 「이 세션은 끝났다」 표식 키. 읽는 쪽은 이 키를 모른다 — 리스 키와 이름이 다르다. */
    private static String closedKey(UUID userId) {
        return KEY_PREFIX + userId + CLOSED_SUFFIX;
    }

    /** 탈퇴 tombstone 키. 읽는 쪽(채팅)은 모른다 — 리스가 없으면 «집중 중 아님»으로 본다. */
    private static String withdrawnKey(UUID userId) {
        return WITHDRAWN_PREFIX + userId;
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
