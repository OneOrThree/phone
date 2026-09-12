package com.oneorthree.realtime.presence;

import com.oneorthree.realtime.common.redis.RedisKeys;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * 「이 유저가 지금 집중 중인가」 한 가지만 답한다 — {@code presence:focus:{userId}} 의 존재 여부로.
 *
 * <p><b>이 서비스는 프레즌스를 쓰지 않는다.</b> 소유자는 Data API 고 채팅은 읽는 쪽이다(A19).
 * 그래서 이 클래스에는 쓰기·삭제 메서드가 없고, 앞으로도 두면 안 된다 — 채팅이 리스를 지울 수 있게
 * 되는 순간 「집중 중엔 채팅 불가」는 채팅이 스스로 해제할 수 있는 규칙이 된다.
 *
 * <h2>이 판정이 틀릴 수 있는 두 방향</h2>
 * <ul>
 *   <li><b>집중 중인데 «아니다»로 읽힌다</b> — Data API 의 리스 쓰기가 실패했을 때다. 그쪽 쓰기는
 *       best-effort 라(집중 시작이 Redis 때문에 실패하면 안 된다) 실제로 일어날 수 있다.
 *       <b>이 방향은 수용한다.</b> 이 규칙은 남을 막는 규칙이 아니라 자기 자신을 위한 규칙이라,
 *       드물게 새는 대가가 「Redis 가 흔들리면 집중을 시작할 수 없다」보다 훨씬 싸다.</li>
 *   <li><b>집중이 끝났는데 «중이다»로 읽힌다</b> — 종료 시 삭제가 유실됐을 때다. 이쪽은 유저가
 *       영영 채팅에 못 들어가는 상태라 훨씬 나쁘다. 그래서 리스에는 <b>TTL 이 반드시 있어야</b> 하고,
 *       (삭제가 유실돼도 TTL 이 지나면 스스로 풀린다) TTL 값은 소유자인 Data API 가 정한다.</li>
 * </ul>
 *
 * <p>Redis 자체가 죽으면 예외가 그대로 전파된다. 잡아서 «집중 아님»으로 접지 않는 이유는, 그 시점엔
 * 팬아웃도 멤버십 캐시도 죽어 있어 <b>채팅이 어차피 동작하지 않기 때문</b>이다 — 여기서만 살려 두면
 * 「연결은 되는데 메시지는 안 오는」 더 헷갈리는 상태가 된다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FocusPresenceReader {

    private final StringRedisTemplate redis;

    /**
     * @param userId 판정 대상. 요청자 자신이어야 한다 — 남의 집중 여부를 이 서비스가 알 이유가 없다
     * @return 집중 세션 리스가 살아 있으면 true
     */
    public boolean isFocusing(UUID userId) {
        return Boolean.TRUE.equals(redis.hasKey(RedisKeys.focusPresence(userId)));
    }
}
