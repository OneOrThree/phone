package com.oneorthree.phone.common.port;

import com.fasterxml.uuid.Generators;
import com.fasterxml.uuid.UUIDClock;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.Duration;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * 프레즌스 리스 — <b>실제 Redis</b> 위에서 본다.
 *
 * <p>이 클래스의 핵심은 Lua 두 줄의 조건이고, 그건 목으로는 <b>한 글자도 검증되지 않는다</b>.
 * 특히 「커밋 이후 콜백이 어긋난 순서로 도착하는」 경우가 그렇다 — 값 비교·표식이 실제로 그 순서를
 * 바로잡는지는 Redis 가 스크립트를 돌려 봐야 안다.
 *
 * <p>세 규율을 본다: <b>커밋 이후에만</b>, <b>실패를 삼킨다</b>, <b>순서가 어긋나도 상태가 맞다</b>.
 * 셋 다 «없어도 정상으로 보이는» 성질이라 여기서 못 박는다.
 */
class RedisFocusPresenceTest {

    @SuppressWarnings("resource")
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379);

    /** 리스 수명 기준 시각. 고정 시계라 「시작한 지 13시간」 계산이 벽시계에 묶이지 않는다. */
    private static final Instant NOW = Instant.parse("2026-09-11T00:00:00Z");

    /** 대부분의 테스트는 «방금 시작한» 집중이다 — 남은 수명이 곧 LEASE_TTL 전체다. */
    private static final Instant STARTED_AT = NOW;

    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);

    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redis;

    private UUID userId;
    private String key;

    @BeforeAll
    static void startRedis() {
        REDIS.start();
        connectionFactory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getFirstMappedPort());
        connectionFactory.afterPropertiesSet();
        redis = new StringRedisTemplate(connectionFactory);
        redis.afterPropertiesSet();
    }

    @AfterAll
    static void stopRedis() {
        connectionFactory.destroy();
        REDIS.stop();
    }

    @BeforeEach
    void setUp() {
        userId = UUID.randomUUID();
        key = "presence:focus:" + userId;
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Nested
    @DisplayName("정상 경로")
    class HappyPath {

        @Test
        @DisplayName("시작하면 리스가 생기고, 그 세션이 끝나면 사라진다")
        void setAndClear() {
            Long session = sessionId();

            presence().focusStarted(userId, session, STARTED_AT);
            assertThat(redis.hasKey(key)).isTrue();

            presence().focusEnded(userId, session);
            assertThat(redis.hasKey(key)).isFalse();
        }

        @Test
        @DisplayName("리스에는 «반드시» 수명이 있다 — 종료가 유실돼도 스스로 풀려야 한다")
        void leaseAlwaysExpires() {
            presence().focusStarted(userId, sessionId(), STARTED_AT);

            assertThat(redis.getExpire(key)).isNotNull().isPositive();
        }

        @Test
        @DisplayName("순번이 없으면 아무것도 하지 않는다 — 어느 리스인지 모르는 채로 건드리지 않는다")
        void nullSessionIsNoop() {
            presence().focusStarted(userId, sessionId(), STARTED_AT);

            presence().focusEnded(userId, null);

            assertThat(redis.hasKey(key)).isTrue();
        }
    }

    @Nested
    @DisplayName("재구축 — 채우기만 하고 만지지 않는다")
    class Reconciliation {

        @Test
        @DisplayName("리스가 없으면 채운다 — 이게 「Redis 가 비었을 때」의 복구 경로다")
        void fillsWhenMissing() {
            Long session = sessionId();

            presence().restoreLeaseIfMissing(userId, session, STARTED_AT);

            assertThat(redis.opsForValue().get(key)).isEqualTo(String.valueOf(session));
            assertThat(redis.getExpire(key)).isNotNull().isPositive();
        }

        @Test
        @DisplayName("이미 있는 리스는 «값도 수명도» 건드리지 않는다 — 주기 실행이 TTL 을 밀면 차단 창이 두 배가 된다")
        void neverTouchesAnExistingLease() {
            Long live = sessionId();
            presence().focusStarted(userId, live, STARTED_AT);
            // 남은 수명을 눈에 띄게 줄여 둔다 — 「밀지 않았다」를 관측하려면 기준선이 달라야 한다.
            redis.expire(key, Duration.ofMinutes(30));
            Long before = redis.getExpire(key);

            presence().restoreLeaseIfMissing(userId, sessionId(), STARTED_AT);

            assertThat(redis.opsForValue().get(key)).isEqualTo(String.valueOf(live));
            assertThat(redis.getExpire(key)).isNotNull().isLessThanOrEqualTo(before);
        }

        @Test
        @DisplayName("조회와 쓰기 사이에 끝난 세션은 되살리지 않는다 — 「끝났다」 표식이 막는다")
        void doesNotResurrectASessionThatEndedMeanwhile() {
            Long session = sessionId();
            presence().focusStarted(userId, session, STARTED_AT);
            presence().focusEnded(userId, session);

            // 정본을 읽은 시점엔 진행 중이었으나 그 사이 끝난 경우다.
            presence().restoreLeaseIfMissing(userId, session, STARTED_AT);

            assertThat(redis.hasKey(key)).isFalse();
        }

        @Test
        @DisplayName("그 뒤 시작된 «더 새로운» 집중은 정상적으로 재구축된다 — 표식이 영구 차단이 되면 안 된다")
        void restoresANewerSessionAfterAnEnd() {
            Long ended = sessionId();
            presence().focusStarted(userId, ended, STARTED_AT);
            presence().focusEnded(userId, ended);

            Long newer = sessionId();
            presence().restoreLeaseIfMissing(userId, newer, STARTED_AT);

            assertThat(redis.opsForValue().get(key)).isEqualTo(String.valueOf(newer));
        }

        @Test
        @DisplayName("순번이 없으면 아무것도 하지 않는다")
        void nullSessionIsNoop() {
            presence().restoreLeaseIfMissing(userId, null, STARTED_AT);

            assertThat(redis.hasKey(key)).isFalse();
        }

        @Test
        @DisplayName("Redis 가 닿지 않으면 false 다 — 부르는 쪽이 남은 건을 이어 가지 않게")
        void reportsFailureWhenRedisIsDown() {
            LettuceConnectionFactory dead = new LettuceConnectionFactory("127.0.0.1", 1);
            dead.afterPropertiesSet();
            StringRedisTemplate deadTemplate = new StringRedisTemplate(dead);
            deadTemplate.afterPropertiesSet();

            assertThat(new RedisFocusPresence(deadTemplate, CLOCK)
                    .restoreLeaseIfMissing(userId, sessionId(), STARTED_AT)).isFalse();

            dead.destroy();
        }

        @Test
        @DisplayName("쓸 것이 없어도 true 다 — 이미 있거나 백스톱을 넘긴 경우는 «실패»가 아니다")
        void nothingToWriteIsStillSuccess() {
            presence().focusStarted(userId, sessionId(), STARTED_AT);
            assertThat(presence().restoreLeaseIfMissing(userId, sessionId(), STARTED_AT)).isTrue();

            assertThat(presence().restoreLeaseIfMissing(userId, sessionId(),
                    NOW.minus(Duration.ofHours(14)))).isTrue();
        }
    }

    @Nested
    @DisplayName("재구축용 해제 — «지웠는가»를 돌려준다")
    class ReleaseForReconciliation {

        @Test
        @DisplayName("지우고 true 를 돌려준다")
        void deletesAndReportsSuccess() {
            Long session = sessionId();
            presence().focusStarted(userId, session, STARTED_AT);

            assertThat(presence().releaseLeaseNow(userId, session)).isTrue();
            assertThat(redis.hasKey(key)).isFalse();
        }

        @Test
        @DisplayName("지울 것이 없어도 true 다 — 그 사이 새 집중이 주인이 됐으면 «안 지우는 것»이 옳다")
        void nothingToDeleteIsStillSuccess() {
            // 순번이라 «먼저 뽑힌 것이 더 오래된» 세션이다.
            Long olderSession = sessionId();
            Long newerSession = sessionId();
            // 그 사이 새 집중이 시작해 리스 주인이 «더 새로운» 세션으로 바뀐 상황.
            presence().focusStarted(userId, newerSession, STARTED_AT);

            // 옛 세션의 해제는 그 리스를 건드리면 안 된다 — 그래도 재시도할 이유가 없으므로 성공이다.
            assertThat(presence().releaseLeaseNow(userId, olderSession)).isTrue();
            assertThat(redis.opsForValue().get(key)).isEqualTo(String.valueOf(newerSession));
        }

        @Test
        @DisplayName("Redis 가 닿지 않으면 false 다 — 부르는 쪽이 다음 회차에 다시 든다")
        void reportsFailureWhenRedisIsDown() {
            LettuceConnectionFactory dead = new LettuceConnectionFactory("127.0.0.1", 1);
            dead.afterPropertiesSet();
            StringRedisTemplate deadTemplate = new StringRedisTemplate(dead);
            deadTemplate.afterPropertiesSet();

            assertThat(new RedisFocusPresence(deadTemplate, CLOCK).releaseLeaseNow(userId, sessionId()))
                    .isFalse();

            dead.destroy();
        }

        @Test
        @DisplayName("순번이 없으면 true 다 — 다시 시도해도 지울 대상을 알 수 없다")
        void unknownSessionIsNotRetried() {
            assertThat(presence().releaseLeaseNow(userId, null)).isTrue();
        }
    }

    @Nested
    @DisplayName("리스는 «시작한 지» 13시간에 만료한다 — 놓은 지가 아니라")
    class LeaseExpiresFromStart {

        @Test
        @DisplayName("오래된 마커를 재구축하면 «남은 수명»만 준다 — 전체를 주면 백스톱이 25시간이 된다")
        void restoreGivesOnlyTheRemainingLife() {
            // 12시간 전에 시작한 집중. 고아 판정(12h) 직전이라 재구축 모수에는 들어온다.
            presence().restoreLeaseIfMissing(userId, sessionId(), NOW.minus(Duration.ofHours(12)));

            Long ttl = redis.getExpire(key);
            // 13h - 12h = 1h. 「지금부터 13시간」이었다면 46800 초가 나온다.
            assertThat(ttl).isNotNull().isBetween(Duration.ofMinutes(55).toSeconds(),
                    Duration.ofHours(1).toSeconds());
        }

        @Test
        @DisplayName("시작 경로도 같다 — 이미 열려 있던 «오래된» 마커에 전체 수명을 다시 주지 않는다")
        void startAlsoGivesOnlyTheRemainingLife() {
            // 순서 역전 방어 경로는 새 마커를 만들지 않고 «열려 있던» 마커의 순번을 싣는다.
            presence().focusStarted(userId, sessionId(), NOW.minus(Duration.ofHours(10)));

            assertThat(redis.getExpire(key)).isNotNull().isBetween(Duration.ofMinutes(175).toSeconds(),
                    Duration.ofHours(3).toSeconds());
        }

        @Test
        @DisplayName("백스톱을 이미 넘긴 마커는 «아예 놓지 않는다» — 놓으면 그 순간부터 되살아난다")
        void aMarkerPastItsBackstopIsNotWrittenAtAll() {
            presence().restoreLeaseIfMissing(userId, sessionId(), NOW.minus(Duration.ofHours(14)));
            assertThat(redis.hasKey(key)).isFalse();

            presence().focusStarted(userId, sessionId(), NOW.minus(Duration.ofHours(14)));
            assertThat(redis.hasKey(key)).isFalse();
        }

        @Test
        @DisplayName("시작 시각을 모르면 아무것도 쓰지 않는다 — 만료를 정할 근거가 없다")
        void unknownStartWritesNothing() {
            presence().restoreLeaseIfMissing(userId, sessionId(), null);
            presence().focusStarted(userId, sessionId(), null);

            assertThat(redis.hasKey(key)).isFalse();
        }
    }

    @Nested
    @DisplayName("커밋 경계")
    class CommitBoundary {

        @Test
        @DisplayName("트랜잭션 안에서는 «아직» 쓰지 않는다 — 롤백되면 세션 없이 리스만 남는다")
        void defersUntilCommit() {
            TransactionSynchronizationManager.initSynchronization();

            presence().focusStarted(userId, sessionId(), STARTED_AT);

            assertThat(redis.hasKey(key)).isFalse();
            assertThat(TransactionSynchronizationManager.getSynchronizations()).hasSize(1);
        }

        @Test
        @DisplayName("커밋 콜백이 돌면 그때 쓴다")
        void writesOnCommit() {
            TransactionSynchronizationManager.initSynchronization();
            presence().focusStarted(userId, sessionId(), STARTED_AT);

            TransactionSynchronizationManager.getSynchronizations().forEach(s -> s.afterCommit());

            assertThat(redis.hasKey(key)).isTrue();
        }

        @Test
        @DisplayName("롤백되면(콜백 미실행) 아무것도 쓰지 않는다")
        void writesNothingOnRollback() {
            TransactionSynchronizationManager.initSynchronization();

            presence().focusStarted(userId, sessionId(), STARTED_AT);
            // afterCommit 을 부르지 않는다 = 롤백된 상황.

            assertThat(redis.hasKey(key)).isFalse();
        }
    }

    @Nested
    @DisplayName("순서가 어긋나 도착해도 상태가 맞다")
    class OutOfOrder {

        @Test
        @DisplayName("«이미 끝난 세션»의 지연된 시작은 리스를 되살리지 못한다 — 되살면 13시간 차단이다")
        void lateStartCannotResurrect() {
            Long session = sessionId();
            presence().focusStarted(userId, session, STARTED_AT);
            presence().focusEnded(userId, session);

            // 그 세션의 시작 콜백이 «종료 뒤에» 뒤늦게 도착한 상황.
            presence().focusStarted(userId, session, STARTED_AT);

            assertThat(redis.hasKey(key)).isFalse();
        }

        @Test
        @DisplayName("옛 세션의 지연된 종료는 «새 집중»의 리스를 지우지 못한다")
        void lateEndCannotClearNewerLease() {
            Long older = sessionId();
            Long newer = sessionId();
            presence().focusStarted(userId, older, STARTED_AT);
            presence().focusStarted(userId, newer, STARTED_AT);

            presence().focusEnded(userId, older);

            assertThat(redis.hasKey(key)).isTrue();
            assertThat(redis.opsForValue().get(key)).isEqualTo(String.valueOf(newer));
        }

        @Test
        @DisplayName("옛 세션의 지연된 시작은 «새 집중»의 리스를 덮어쓰지 못한다")
        void lateStartCannotOverwriteNewerLease() {
            Long older = sessionId();
            Long newer = sessionId();
            presence().focusStarted(userId, newer, STARTED_AT);

            presence().focusStarted(userId, older, STARTED_AT);

            assertThat(redis.opsForValue().get(key)).isEqualTo(String.valueOf(newer));
        }

        @Test
        @DisplayName("회전 중 쓰기가 실패해 남은 «이미 닫힌» 옛 리스를, 새 세션의 종료가 치운다")
        void newerEndClearsStaleOlderLease() {
            // 뽀모도로 회전: 이전 마커를 닫고 새 마커를 여는데, 그 사이 새 세션의 SET 이 실패해
            // 키에 «이미 닫힌» 이전 세션 순번이 남은 상황을 만든다. 그 마커는 종료됐으니 고아 스윕
            // 대상도 아니라, 엄격한 동일 비교로는 아무도 이 키를 못 지운다 — 최대 13시간 차단이다.
            Long stale = sessionId();
            presence().focusStarted(userId, stale, STARTED_AT);

            Long current = sessionId();
            // (current 의 SET 이 실패했다고 가정 — 일부러 부르지 않는다)
            presence().focusEnded(userId, current);

            assertThat(redis.hasKey(key)).isFalse();
        }

        @Test
        @DisplayName("종료 → 새 시작 순서는 정상적으로 새 리스를 놓는다 — 표식이 정상 재시작을 막으면 안 된다")
        void restartAfterEndStillWorks() {
            Long first = sessionId();
            presence().focusStarted(userId, first, STARTED_AT);
            presence().focusEnded(userId, first);

            Long second = sessionId();
            presence().focusStarted(userId, second, STARTED_AT);

            assertThat(redis.opsForValue().get(key)).isEqualTo(String.valueOf(second));
        }

        @Test
        @DisplayName("같은 세션의 재시작은 TTL 을 갱신한다 — 순서 역전 방어 경로가 그렇게 부른다")
        void sameSessionRefreshesLease() {
            Long session = sessionId();
            presence().focusStarted(userId, session, STARTED_AT);

            assertThatCode(() -> presence().focusStarted(userId, session, STARTED_AT)).doesNotThrowAnyException();

            assertThat(redis.opsForValue().get(key)).isEqualTo(String.valueOf(session));
            assertThat(redis.getExpire(key)).isNotNull().isPositive();
        }
    }

    @Nested
    @DisplayName("순서의 근거는 DB 순번이다 — 인스턴스 시계가 아니다 (GROMO-1743)")
    class DbOrderNotInstanceClock {

        @Test
        @DisplayName("시계가 어긋난 두 인스턴스가 쓴 시작·종료도 «DB 순번이 더 큰 쪽»이 이긴다")
        void newerDbOrderWinsDespiteSkewedClocks() {
            // 인스턴스 A 의 시계는 1분 앞서고 B 는 정확하다. A 가 «먼저» 세션을 만들고(DB 순번 작음),
            // B 가 «나중에» 만든다(DB 순번 큼). 세션 id(UUID v7)로 비교했다면 A 의 옛 세션이 더 새로워 보인다.
            UUID olderIdFromFastClock = uuidV7At(NOW.plus(Duration.ofMinutes(1)));
            UUID newerIdFromTrueClock = uuidV7At(NOW);
            assertThat(olderIdFromFastClock.toString()).isGreaterThan(newerIdFromTrueClock.toString());
            Long olderOrder = sessionId();
            Long newerOrder = sessionId();

            // B 의 새 시작 → A 의 옛 시작이 늦게 도착 → A 의 옛 종료가 늦게 도착.
            presence().focusStarted(userId, newerOrder, STARTED_AT);
            presence().focusStarted(userId, olderOrder, STARTED_AT);
            presence().focusEnded(userId, olderOrder);

            assertThat(redis.opsForValue().get(key)).isEqualTo(String.valueOf(newerOrder));

            presence().focusEnded(userId, newerOrder);
            assertThat(redis.hasKey(key)).isFalse();
        }

        @Test
        @DisplayName("순번은 «숫자»로 비교한다 — 문자열이면 9 가 10 보다 커 보인다")
        void comparesNumericallyAcrossDigitBoundary() {
            presence().focusStarted(userId, 10L, STARTED_AT);

            presence().focusStarted(userId, 9L, STARTED_AT);
            presence().focusEnded(userId, 9L);

            assertThat(redis.opsForValue().get(key)).isEqualTo("10");
        }

        @Test
        @DisplayName("배포 전 값(세션 id 문자열)은 어떤 순번보다 오래된 값이다 — 새 시작은 덮고 새 종료는 지운다")
        void legacyUuidValueIsOlderThanAnyOrder() {
            String legacy = uuidV7At(NOW).toString();
            redis.opsForValue().set(key, legacy, Duration.ofHours(1));
            redis.opsForValue().set(key + ":closed", legacy, Duration.ofMinutes(5));

            Long order = sessionId();
            presence().focusStarted(userId, order, STARTED_AT);
            assertThat(redis.opsForValue().get(key)).isEqualTo(String.valueOf(order));

            redis.opsForValue().set(key, legacy, Duration.ofHours(1));
            presence().focusEnded(userId, sessionId());
            assertThat(redis.hasKey(key)).isFalse();
        }

        private UUID uuidV7At(Instant at) {
            return Generators.timeBasedEpochGenerator(new Random(), new UUIDClock() {
                @Override
                public long currentTimeMillis() {
                    return at.toEpochMilli();
                }
            }).generate();
        }
    }

    @Nested
    @DisplayName("실패는 집중을 막지 않는다")
    class FailureIsSwallowed {

        @Test
        @DisplayName("Redis 가 닿지 않아도 예외가 올라가지 않는다")
        void swallowsFailures() {
            LettuceConnectionFactory dead = new LettuceConnectionFactory("127.0.0.1", 1);
            dead.afterPropertiesSet();
            StringRedisTemplate deadTemplate = new StringRedisTemplate(dead);
            deadTemplate.afterPropertiesSet();
            RedisFocusPresence presence = new RedisFocusPresence(deadTemplate, CLOCK);

            assertThatCode(() -> presence.focusStarted(userId, sessionId(), STARTED_AT)).doesNotThrowAnyException();
            assertThatCode(() -> presence.focusEnded(userId, sessionId())).doesNotThrowAnyException();
            // 재구축도 같다 — 여기서 던지면 주기 크론이 매 회차 스택트레이스를 뱉는다.
            assertThatCode(() -> presence.restoreLeaseIfMissing(userId, sessionId(), STARTED_AT)).doesNotThrowAnyException();

            dead.destroy();
        }

        @Test
        @DisplayName("커밋 «콜백 안»에서 죽어도 삼킨다 — 이미 커밋된 요청을 실패로 보이게 하면 안 된다")
        void swallowsFailuresInsideCommitCallback() {
            LettuceConnectionFactory dead = new LettuceConnectionFactory("127.0.0.1", 1);
            dead.afterPropertiesSet();
            StringRedisTemplate deadTemplate = new StringRedisTemplate(dead);
            deadTemplate.afterPropertiesSet();

            TransactionSynchronizationManager.initSynchronization();
            new RedisFocusPresence(deadTemplate, CLOCK).focusEnded(userId, sessionId());

            assertThatCode(() -> TransactionSynchronizationManager.getSynchronizations()
                    .forEach(s -> s.afterCommit()))
                    .doesNotThrowAnyException();

            dead.destroy();
        }
    }

    private RedisFocusPresence presence() {
        return new RedisFocusPresence(redis, CLOCK);
    }

    /** DB 시퀀스를 흉내 낸다 — 먼저 뽑힌 것이 더 작다. 9 → 10 자리수 경계도 지나가게 8 에서 시작한다. */
    private static final AtomicLong ORDER = new AtomicLong(8);

    private static Long sessionId() {
        return ORDER.incrementAndGet();
    }
}
