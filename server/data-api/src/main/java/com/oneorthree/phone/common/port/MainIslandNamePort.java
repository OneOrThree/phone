package com.oneorthree.phone.common.port;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/**
 * 「이 사람들의 메인 섬 이름」 한 질문 (GROMO-1971 · GROMO-1656).
 *
 * <p><b>왜 포트인가.</b> 친구 목록은 {@code friend}(L3)가 만드는데 메인 섬과 섬 이름은 {@code group}(L5)의
 * 데이터다 — 직접 부르면 레이어 역행이라 {@code DomainLayerRulesTest} 가 빌드를 깬다. 필요한 것은 이 질문
 * 하나뿐이라 답을 아는 쪽({@code group})이 구현하고 묻는 쪽은 인터페이스만 본다
 * ({@link InviteAttributionPort} 와 같은 논증).
 *
 * <p>구현: {@code group/service/MainIslandService}.
 */
public interface MainIslandNamePort {

    /**
     * <b>배치</b>로 묻는다 — 친구 한 명씩 조회하면 그대로 N+1 이다(티어·집중 라이브가 이미 배치인 이유).
     *
     * @param userIds 대상. 비어 있으면 빈 맵
     * @return 메인 섬이 있는 사용자만 담긴 {@code userId → 섬 이름}. <b>소속이 하나도 없는 사람은 키가 없다</b> —
     *         호출측은 그 부재를 «메인 섬 없음»(null)으로 읽는다
     */
    Map<UUID, String> mainIslandNamesByUserId(Collection<UUID> userIds);
}
