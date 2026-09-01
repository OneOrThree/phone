package com.oneorthree.phone.auth.support;

import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 게스트 계정 생성({@code POST /auth/guest})을 <b>클라이언트 IP 당 고정 윈도</b> 횟수로 제한한다 (GROMO-1510).
 *
 * <p>이 엔드포인트는 인증이 없어 호출 한 번마다 {@code users} 행이 하나 생긴다. 게스트 개방(티켓 1508 ·
 * 1509)이 나가면 게스트도 리그·그룹에 들어가므로, 계정을 무한히 찍어 랭킹과 그룹 베팅(코인)을 흔들 수 있다.
 *
 * <p><b>축은 IP 하나다.</b> 기기 축은 넣지 않았다 — 클라이언트가 기기 식별자를 보내지 않을뿐더러,
 * 보내더라도 값이 클라이언트 소유라 헤더만 바꾸면 우회된다. 대량 생성 공격에 대해 방어력이 0 인 축은
 * 넣어봐야 코드만 는다. 다만 <b>IPv6 는 주소가 아니라 {@code /64} 프리픽스 단위</b>로 센다 —
 * 회선 하나에 프리픽스가 통째로 할당돼서 주소 단위로는 셀 의미가 없다.
 *
 * <p><b>저장소는 프로세스 메모리다</b>(DB·Redis 없음). 현재 dev/prod 는 호스트 한 대에 app 컨테이너
 * 하나(compose)라 인스턴스별 카운터 = 전역 카운터다. 인스턴스를 늘리는 순간 실효 한도가 인스턴스 수만큼
 * 곱해지고 재배포 때 카운터가 날아간다 — 그때는 공유 저장소(Redis 등)로 올려야 한다.
 *
 * <p><b>한도는 프로퍼티로 뺐다.</b> 통신사 CGNAT·학교/카페 공용 와이파이는 여러 실사용자가 IP 하나를
 * 공유해서, 너무 조이면 정상 신규 유저의 온보딩이 막힌다(가장 비싼 오탐). 데모·심의처럼 한 망에서
 * 대량 가입이 예상되면 배포 없이 값만 올린다.
 *
 * <p><b>전역 상한은 키 위조에 대한 2차 방어선이다</b> (PR #621 코드리뷰 P1). IP 별 한도는 키를
 * 자유롭게 고를 수 있으면 통째로 무력화되는데(요청마다 새 버킷), 오리진이 Cloudflare 를 거치지 않고
 * 직접 닿을 수 있는 배포에서는 앞단 nginx 가 전달 헤더를 덮어쓰지 않는 한 그 전제가 깨진다. 전역
 * 카운터는 키를 아무리 돌려도 우회되지 않아 대량 생성의 총량을 묶는다. <b>근본 해결은 nginx 가
 * 전달 헤더를 덮어쓰고 오리진 방화벽을 Cloudflare 대역으로 제한하는 것</b>이고, 그 설정은 이
 * 레포가 아니라 인프라 레포에 있다 — 여기서는 총량만 묶는다.
 *
 * <p>전역 상한은 IP 한도를 통과한 요청만 센다. 한 IP 를 두들겨 전역 예산을 태우고 정상 가입을
 * 막는 길을 만들지 않기 위해서다. 기본값(1시간당 300)은 정상 트래픽이 닿을 일이 없도록 IP 한도의
 * 30배로 잡았다 — 그래도 활성 공격 중에는 신규 가입이 느려질 수 있다는 게 이 방어선의 대가다.
 */
@Slf4j
@Component
public class GuestLoginRateLimiter {

    /**
     * 추적 IP 상한 — <b>하드 상한</b>이다. 도달하면 만료 여부와 무관하게 가장 오래 안 쓰인 항목부터
     * 밀어낸다(LRU). 만료 항목만 지우는 방식은 서로 다른 키가 상한을 넘겨 쏟아지면 아무것도 못 지운 채
     * 맵이 계속 커져서, 인증 없는 호출자가 힙을 무한히 늘릴 수 있었다 (PR #621 코드리뷰 P1).
     *
     * <p>키 홍수로 밀려난 정상 IP 는 카운터가 초기화돼 한도를 새로 받는다 — 힙·CPU 를 확실히 묶는
     * 대가로 그 구간의 제한 정확도를 포기한 것이다. 그 정도 규모의 분산 공격은 IP 단위 제한 자체가
     * 답이 아니고, 공유 저장소로 올릴 때 같이 볼 문제다.
     */
    private static final int MAX_TRACKED_IPS = 10_000;

    private final Map<String, Window> windows = boundedLru();
    private final AtomicReference<Window> globalWindow = new AtomicReference<>();
    private final int maxPerWindow;
    private final int maxGlobalPerWindow;
    private final Duration window;
    private final Clock clock;

    @Autowired
    public GuestLoginRateLimiter(
            @Value("${auth.guest.rate-limit.max-per-window:10}") int maxPerWindow,
            @Value("${auth.guest.rate-limit.max-per-window-global:300}") int maxGlobalPerWindow,
            @Value("${auth.guest.rate-limit.window:1h}") Duration window) {
        this(maxPerWindow, maxGlobalPerWindow, window, Clock.systemUTC());
    }

    // 테스트에서 시계를 고정해 윈도 만료를 결정적으로 검증하기 위한 생성자.
    GuestLoginRateLimiter(int maxPerWindow, int maxGlobalPerWindow, Duration window, Clock clock) {
        // 설정이 잘못 배포되면 기동 단계에서 죽인다 (PR #621 코드리뷰 P2). 윈도가 0/음수면 매 요청이
        // 만료 판정을 받아 카운트가 늘 1로 초기화돼 보호가 조용히 사라지고, 한도가 0 이하면 모든
        // 게스트 로그인이 막힌다 — 둘 다 런타임에 알아채기 어려운 실패라 부팅에서 끊는 게 낫다.
        // 상한은 Integer.MAX_VALUE 도 막는다 — 포화 계산의 '한도+1' 이 넘쳐 음수가 되면 판정이
        // 영원히 거짓이 되어 제한이 조용히 꺼진다.
        requirePositiveLimit("auth.guest.rate-limit.max-per-window", maxPerWindow);
        requirePositiveLimit("auth.guest.rate-limit.max-per-window-global", maxGlobalPerWindow);
        if (window == null || window.isZero() || window.isNegative()) {
            throw new IllegalArgumentException("auth.guest.rate-limit.window 는 양수여야 합니다: " + window);
        }
        this.maxPerWindow = maxPerWindow;
        this.maxGlobalPerWindow = maxGlobalPerWindow;
        this.window = window;
        this.clock = clock;
    }

    private static void requirePositiveLimit(String property, int value) {
        if (value <= 0 || value == Integer.MAX_VALUE) {
            throw new IllegalArgumentException(
                    property + " 는 1 이상 " + Integer.MAX_VALUE + " 미만이어야 합니다: " + value);
        }
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
        String key = bucketKey(clientIp);

        Window perIp = windows.compute(key, (ip, existing) -> advance(existing, now, maxPerWindow));
        if (perIp.count() > maxPerWindow) {
            // 윈도당 첫 차단만 남긴다 (PR #621 코드리뷰 P1). 매 차단마다 찍으면 인증 없는 호출자가
            // 요청 수에 비례해 로그 처리량·보존 용량·Datadog 수집 비용을 부풀릴 수 있다.
            if (!perIp.blockAlreadyLogged()) {
                log.warn("게스트 생성 레이트리밋 차단 — ip={} (윈도 {} 당 {}회 초과, 이 윈도의 이후 차단은 로그 생략)",
                        anonymize(key), window, maxPerWindow);
            }
            throw new AuthException(AuthErrorCode.GUEST_CREATION_RATE_LIMITED);
        }

        // IP 한도에서 이미 막힌 요청은 전역 카운터를 건드리지 않는다 — 한 IP 를 두들겨 전역 예산을
        // 태워서 정상 유저 가입까지 막는 길을 만들면 안 된다.
        Window global = globalWindow.updateAndGet(existing -> advance(existing, now, maxGlobalPerWindow));
        if (global.count() > maxGlobalPerWindow) {
            if (!global.blockAlreadyLogged()) {
                log.warn("게스트 생성 전역 레이트리밋 차단 — 윈도 {} 당 {}회 초과 (키 위조·분산 생성 의심)",
                        window, maxGlobalPerWindow);
            }
            throw new AuthException(AuthErrorCode.GUEST_CREATION_RATE_LIMITED);
        }
    }

    /** 윈도를 한 칸 진행시킨다 — 만료됐으면 새로 시작하고, 아니면 {@code cap+1} 까지만 센다. */
    private Window advance(Window existing, Instant now, int cap) {
        if (existing == null || isExpired(existing, now)) {
            return new Window(now, 1, false);
        }
        // cap+1 에서 카운트를 멈춘다 — 차단 중에도 계속 올리면 이론상 int 가 넘쳐 음수가 되면서
        // 제한이 풀린다. 멈춰도 판정(> cap)은 그대로 유지된다.
        return new Window(existing.startedAt(), Math.min(existing.count() + 1, cap + 1), existing.count() > cap);
    }

    private boolean isExpired(Window candidate, Instant now) {
        return !now.isBefore(candidate.startedAt().plus(window));
    }

    /**
     * 레이트리밋 버킷 키 — IPv6 는 {@code /64} 프리픽스로 접는다 (PR #621 코드리뷰 P1).
     *
     * <p>IPv6 는 가정용 회선 하나에도 {@code /64} 이상이 통째로 할당돼서, 주소를 그대로 키로 쓰면
     * 공격자가 자기 프리픽스 안에서 소스 주소만 바꿔가며 한도를 무한히 새로 받는다. 초대링크 클릭
     * 기록이 쓰는 원본 IP 값은 건드리지 않고 여기서만 접는다.
     */
    private static String bucketKey(String clientIp) {
        // ':' 가 없으면 IPv4 이거나 IP 가 아닌 값("unknown")이라 그대로 쓴다. 이 가드가 있어야
        // getByName 이 호스트명으로 오인해 DNS 조회로 새지 않는다(':' 포함 문자열은 리터럴로만 해석).
        if (clientIp.indexOf(':') < 0) {
            return clientIp;
        }
        try {
            byte[] address = InetAddress.getByName(clientIp).getAddress();
            if (address.length != 16) {
                // IPv4 매핑 주소(::ffff:1.2.3.4)는 4바이트로 돌아온다 — IPv4 취급.
                return clientIp;
            }
            StringBuilder prefix = new StringBuilder(20);
            for (int i = 0; i < 8; i += 2) {
                prefix.append(Integer.toHexString(((address[i] & 0xff) << 8) | (address[i + 1] & 0xff)));
                prefix.append(':');
            }
            return prefix.append(":/64").toString();
        } catch (UnknownHostException e) {
            // IPv6 리터럴이 아니면 원문 그대로 — 정규화 실패가 제한 자체를 풀어주면 안 된다.
            return clientIp;
        }
    }

    /** IPv4 는 마지막 옥텟을 지운다 — 대역은 남기고 개인 식별은 끊는다. */
    private static String anonymize(String bucketKey) {
        int lastDot = bucketKey.lastIndexOf('.');
        if (lastDot > 0) {
            return bucketKey.substring(0, lastDot) + ".x";
        }
        // IPv6 는 이미 /64 프리픽스로 접힌 키고, "unknown" 등은 가릴 개인정보가 없다.
        return bucketKey;
    }

    /**
     * 접근 순서 LRU — 상한을 넘기면 가장 오래 안 쓰인 항목이 자동으로 빠진다.
     *
     * <p>{@code ConcurrentHashMap} 으로 같은 하드 상한을 지키려면 요청마다 맵을 전수 스캔해야 해서
     * 요청당 O(n) 이 된다. 게스트 로그인은 QPS 가 낮아 맵 단위 락이 그보다 훨씬 싸다.
     */
    private static Map<String, Window> boundedLru() {
        return Collections.synchronizedMap(new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Window> eldest) {
                return size() > MAX_TRACKED_IPS;
            }
        });
    }

    /**
     * 버킷 하나의 현재 윈도.
     *
     * @param startedAt 윈도 시작 시각
     * @param count 이 윈도에서 센 요청 수 (한도+1 에서 포화)
     * @param blockAlreadyLogged 이 윈도에서 앞선 요청이 이미 차단·기록됐는가 — 로그 1회 제한용
     */
    private record Window(Instant startedAt, int count, boolean blockAlreadyLogged) {
    }
}
