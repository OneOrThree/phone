package com.oneorthree.realtime.config;

import com.oneorthree.realtime.common.redis.Sourced;
import com.oneorthree.realtime.membership.CurrentMembershipVerifier;
import com.oneorthree.realtime.membership.MembershipService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.UUID;

/**
 * 멤버십 «허용»을 언제까지 믿어도 되는가 — 전달 직전 인가 캐시({@link OutboundAuthzCache})의 상한(GROMO-2340).
 *
 * <p>판정 자체는 {@code ChatAccessGuard} 가 한다(관문은 하나). 여기서는 판정 «뒤»에 원본 캐시
 * {@code cache:chat:member:{userId}} 의 값과 만료를 한 원자 단위로 읽어, 그 값도 «멤버»라고 말할 때만 그 만료를 돌려준다.
 * 판정과 이 읽기 사이에 다른 요청이 원본을 새 값으로 갈았다면 — 새 값이 비멤버면 담지 않고({@link Sourced#EXPIRED}), 여전히
 * 멤버면 새 값 자체가 유효한 근거라 그 만료까지 믿어도 된다. 판정 때의 GET 과 이 읽기는 종전 «GET + PTTL» 과 같은 두 왕복이다.
 *
 * <p>현재 인가 옵션 ON(verifier)이면 {@link Sourced#EXPIRED} — 멤버십을 포함한 허용을 담지 않는다. ON 의 관문에는 이미 인메모리
 * 허용 캐시({@code CurrentMembershipDecisionCache}, 30s, 사건 evict·세대 대조 — GROMO-2342)가 있어 그 위에 이 캐시 30s 를 쌓으면
 * 반영 상한이 최대 60s 로 늘어난다. 관문 캐시가 메모리라 ON 에서 이 캐시가 아끼는 것은 차단 Lua 1회뿐이니 포기한다.
 */
@Slf4j
@Component
public class OutboundMembershipSource {

    private final MembershipService membershipService;
    private final ObjectProvider<CurrentMembershipVerifier> currentVerifier;

    public OutboundMembershipSource(MembershipService membershipService,
            ObjectProvider<CurrentMembershipVerifier> currentVerifier) {
        this.membershipService = membershipService;
        this.currentVerifier = currentVerifier;
    }

    /** @return 이 (섬, 사용자) 멤버 허용의 절대 만료 — 원본 없음·비멤버·읽기 실패면 {@link Sourced#EXPIRED} */
    long notAfter(UUID islandId, UUID userId) {
        if (currentVerifier.getIfAvailable() != null) {
            return Sourced.EXPIRED;
        }
        try {
            Sourced<Set<UUID>> cached = membershipService.cachedGroupIdsSourced(userId);
            return cached.value() != null && cached.value().contains(islandId) ? cached.expiresAtNanos()
                    : Sourced.EXPIRED;
        } catch (RuntimeException e) {
            log.debug("멤버십 원본 만료 읽기 실패 — 담지 않는다. reason={}", e.getClass().getSimpleName());
            return Sourced.EXPIRED;
        }
    }
}
