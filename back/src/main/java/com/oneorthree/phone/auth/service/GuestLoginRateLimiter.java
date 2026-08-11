package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 게스트 계정 생성({@code POST /auth/guest})을 <b>클라이언트 IP 당 고정 윈도</b> 횟수로 제한한다 (GROMO-1510).
 *
 * <p>이 엔드포인트는 인증이 없어 호출 한 번마다 {@code users} 행이 하나 생긴다. 게스트 개방(티켓 1508 ·
 * 1509)이 나가면 게스트도 리그·그룹에 들어가므로, 계정을 무한히 찍어 랭킹과 그룹 베팅(코인)을 흔들 수 있다.
 *
 * <p><b>축은 IP 하나다.</b> 기기 축은 넣지 않았다 — 클라이언트가 기기 식별자를 보내지 않을뿐더러,
 * 보내더라도 값이 클라이언트 소유라 헤더만 바꾸면 우회된다. 대량 생성 공격에 대해 방어력이 0 인 축은
 * 넣어봐야 코드만 는다.
 *
 * <p><b>저장소는 프로세스 메모리다</b>(DB·Redis 없음). 현재 dev/prod 는 호스트 한 대에 app 컨테이너
 * 하나(compose)라 인스턴스별 카운터 = 전역 카운터다. 인스턴스를 늘리는 순간 실효 한도가 인스턴스 수만큼
 * 곱해지고 재배포 때 카운터가 날아간다 — 그때는 공유 저장소(Redis 등)로 올려야 한다.
 *
 * <p><b>한도는 프로퍼티로 뺐다.</b> 통신사 CGNAT·학교/카페 공용 와이파이는 여러 실사용자가 IP 하나를
 * 공유해서, 너무 조이면 정상 신규 유저의 온보딩이 막힌다(가장 비싼 오탐). 데모·심의처럼 한 망에서
 * 대량 가입이 예상되면 배포 없이 값만 올린다.
 */
@Slf4j
@Component
public class GuestLoginRateLimiter {

    /**
     * 추적 IP 상한 — 넘으면 만료 항목을 청소한다. 맵이 무한히 크는 걸 막는 유일한 장치다.
     * 만료 항목이 없을 만큼 넓게 분산된 공격이면 요청마다 1만 건 전수 스캔이 되지만(수십 마이크로초),
     * 그 상황은 IP 단위 제한 자체가 무력한 구간이라 여기서 더 손보지 않는다.
     */
    private static final int MAX_TRACKED_IPS = 10_000;

    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final int maxPerWindow;
    private final Duration window;
    private final Clock clock;

    @Autowired
    public GuestLoginRateLimiter(
            @Value("${auth.guest.rate-limit.max-per-window:10}") int maxPerWindow,
            @Value("${auth.guest.rate-limit.window:1h}") Duration window) {
        this(maxPerWindow, window, Clock.systemUTC());
    }

    // 테스트에서 시계를 고정해 윈도 만료를 결정적으로 검증하기 위한 생성자.
    GuestLoginRateLimiter(int maxPerWindow, Duration window, Clock clock) {
        this.maxPerWindow = maxPerWindow;
        this.window = window;
        this.clock = clock;
    }

    /**
     * 이번 요청을 한 건으로 세고, 윈도 한도를 넘었으면
     * {@link AuthErrorCode#GUEST_CREATION_RATE_LIMITED}(429)로 끊는다.
     *
     * <p>차단된 요청도 카운트에 포함하지만 윈도 시작 시각은 밀지 않는다 — 계속 두드려도 최초 요청
     * 기준 윈도가 끝나면 정상적으로 풀린다.
     */
    public void check(String clientIp) {
        Instant now = clock.instant();
        if (windows.size() > MAX_TRACKED_IPS) {
            // 값이 방금 갱신된 항목까지 같이 지워질 수 있지만, 결과는 그 IP 가 한도를 새로 받는 것뿐이다.
            windows.entrySet().removeIf(entry -> isExpired(entry.getValue(), now));
        }

        Window current = windows.compute(clientIp, (ip, existing) ->
                existing == null || isExpired(existing, now)
                        ? new Window(now, 1)
                        : new Window(existing.startedAt(), existing.count() + 1));

        if (current.count() > maxPerWindow) {
            log.warn("게스트 생성 레이트리밋 차단 — ip={}, count={} (윈도 {} 당 {}회)",
                    clientIp, current.count(), window, maxPerWindow);
            throw new AuthException(AuthErrorCode.GUEST_CREATION_RATE_LIMITED);
        }
    }

    private boolean isExpired(Window candidate, Instant now) {
        return !now.isBefore(candidate.startedAt().plus(window));
    }

    /** IP 하나의 현재 윈도 — 시작 시각과 그 윈도에서 센 요청 수. */
    private record Window(Instant startedAt, int count) {
    }
}
