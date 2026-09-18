package com.oneorthree.phone.common.ratelimit;

import com.oneorthree.phone.common.exception.RateLimitedException;
import lombok.extern.slf4j.Slf4j;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * <b>계정 하나당 1시간 고정 윈도</b> 횟수 제한 (GROMO-1934) — 친구 요청·편지 발송 스팸 방어.
 * 엔드포인트마다 인스턴스 하나({@code config/RateLimitConfig})라 한 계정의 친구 요청과 편지는 따로 센다.
 *
 * <p><b>왜 {@code GuestLoginRateLimiter} 를 재사용하지 않나.</b> 그쪽은 인증 없는 호출을 막는 물건이라
 * 축이 IP(IPv6 {@code /64} 접기)이고, 키 위조를 전제로 한 전역 상한과 IP 익명화 로그까지 한 몸이다.
 * 여기는 인증된 주체(UUID)가 키라 위조할 키가 없다 — 전역 상한도 접기도 필요 없고, 대신 초과 시
 * <b>남은 시간</b>({@code retryAfterMs})을 돌려줘야 한다(그쪽은 {@code AuthErrorCode} 를 그냥 던진다).
 * IP 리미터를 일반화하면 게스트 생성 방어선의 동작을 건드리게 되므로 고정 윈도·LRU 상한·부팅 검증
 * <b>패턴만</b> 옮겨 왔다.
 *
 * <p>차단된 요청도 윈도 시작 시각을 밀지 않는다 — 계속 두드려도 첫 요청 기준 1시간이 지나면 풀린다.
 */
@Slf4j
public class PerUserHourlyLimiter {

    static final Duration WINDOW = Duration.ofHours(1);

    /**
     * 추적 계정 상한 — 넘으면 가장 오래 안 쓰인 계정부터 밀어낸다(LRU). 키가 인증된 계정이라 위조로
     * 맵을 부풀릴 수는 없고, 한 시간에 서로 다른 발신자가 이만큼 넘을 때만 조용한 계정의 카운터가 초기화된다.
     * 계속 두드리는 계정은 늘 최근 접근이라 밀려나지 않는다.
     */
    private static final int MAX_TRACKED_USERS = 10_000;

    // ponytail: 프로세스 메모리 카운터다. 지금은 인스턴스 하나(docs/architecture/decisions.md ⓨ)라 이것이 곧
    // 전역 카운터지만, 인스턴스를 N 대로 늘리면 실효 한도가 N 배가 되고 재배포마다 초기화된다.
    // 그때는 Redis ratelimit:* 키(A19)로 올린다.
    private final Map<UUID, Window> windows = Collections.synchronizedMap(
            new LinkedHashMap<>(16, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<UUID, Window> eldest) {
                    return size() > MAX_TRACKED_USERS;
                }
            });
    private final String name;
    private final int maxPerHour;
    private final Clock clock;

    /**
     * @param name       설정 키 이름 — 잘못된 값으로 부팅이 끊길 때와 차단 로그에서 어느 한도인지 가리킨다
     * @param maxPerHour 계정당 1시간 허용 횟수. 0 이하면 전부 막히고, {@code Integer.MAX_VALUE} 면
     *                   포화 계산의 {@code +1} 이 넘쳐 제한이 조용히 꺼지므로 둘 다 부팅에서 거부한다
     * @param clock      윈도 판정 시계 — 테스트가 고정·이동 시계를 넣는다
     */
    public PerUserHourlyLimiter(String name, int maxPerHour, Clock clock) {
        if (maxPerHour <= 0 || maxPerHour == Integer.MAX_VALUE) {
            throw new IllegalArgumentException(
                    name + " 는 1 이상 " + Integer.MAX_VALUE + " 미만이어야 합니다: " + maxPerHour);
        }
        this.name = name;
        this.maxPerHour = maxPerHour;
        this.clock = clock;
    }

    /**
     * 이번 요청을 한 건으로 세고, 한도를 넘었으면 윈도가 끝날 때까지 남은 시간을 실어 끊는다.
     *
     * @param userId 인증된 호출자
     * @throws RateLimitedException 이번 요청이 윈도의 {@code maxPerHour + 1} 번째 이상일 때
     */
    public void acquire(UUID userId) {
        Instant now = clock.instant();
        Window current = windows.compute(userId, (key, existing) -> advance(existing, now));
        if (current.count() > maxPerHour) {
            if (!current.blockAlreadyLogged()) {
                log.warn("계정 레이트리밋 차단 — limit={} userId={} (1시간 {}회 초과, 이 윈도의 이후 차단은 로그 생략)",
                        name, userId, maxPerHour);
            }
            long remainingMs = Duration.between(now, current.startedAt().plus(WINDOW)).toMillis();
            // 윈도 끝까지 1ms 미만이 남으면 0 이 되는데, 0 은 「지금 바로」라 재시도가 또 막힌다.
            throw new RateLimitedException(Math.max(1, remainingMs));
        }
    }

    private Window advance(Window existing, Instant now) {
        if (existing == null || !now.isBefore(existing.startedAt().plus(WINDOW))) {
            return new Window(now, 1, false);
        }
        // maxPerHour+1 에서 멈춘다 — 차단 중에 계속 올리면 이론상 int 가 넘쳐 음수가 되며 제한이 풀린다.
        return new Window(existing.startedAt(), Math.min(existing.count() + 1, maxPerHour + 1),
                existing.count() > maxPerHour);
    }

    /**
     * @param startedAt          윈도 시작 시각(이 윈도 첫 요청)
     * @param count              이 윈도에서 센 요청 수 (한도+1 에서 포화)
     * @param blockAlreadyLogged 앞선 요청이 이미 차단·기록됐는가 — 윈도당 로그 1회
     */
    private record Window(Instant startedAt, int count, boolean blockAlreadyLogged) {
    }
}
