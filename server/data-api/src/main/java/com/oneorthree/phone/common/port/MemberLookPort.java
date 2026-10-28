package com.oneorthree.phone.common.port;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/**
 * 「이 사람들의 털색과 착용 외양」 한 질문 (GROMO-2389 · GROMO-1656).
 *
 * <p><b>왜 포트인가.</b> 친구 목록은 {@code friend}(L3), 퀘스트 진행은 {@code quest}(L7)가 만드는데 착용 외양은
 * {@code appearance}(L7)의 데이터다 — 직접 부르면 레이어 역행(또는 같은 층 참조)이라 {@code DomainLayerRulesTest} 가
 * 빌드를 깬다. 답을 아는 쪽({@code appearance})이 구현하고 묻는 쪽은 인터페이스만 본다
 * ({@link MainIslandNamePort} 와 같은 논증).
 *
 * <p>구현: {@code appearance/service/AppearanceService}.
 */
public interface MemberLookPort {

    /**
     * <b>배치</b>로 묻는다 — 한 명씩 조회하면 그대로 N+1 이다.
     *
     * @param userIds 대상. 비어 있으면 빈 맵
     * @return 활성 계정만 담긴 {@code userId → 외형}. <b>탈퇴·미존재 계정은 키가 없다</b> — 호출측은 그 부재를
     *         «외형 없음»(null)으로 읽는다. 외양 행이 없는 활성 계정은 기본 외양이다
     */
    Map<UUID, MemberLook> looksByUserId(Collection<UUID> userIds);

    /**
     * @param catColor   고양이 색. 미선택이면 null
     * @param appearance 착용 외양
     */
    record MemberLook(String catColor, Appearance appearance) {
    }

    /**
     * 착용 외양 — {@code PersonalAppearanceView} 와 같은 필드·같은 JSON 이다. 묻는 쪽(friend L3 · quest L7)이
     * {@code appearance.dto} 를 import 하면 같은 레이어 참조라 이 포트에 따로 둔다(주민 목록과 모양이 어긋나지
     * 않도록 필드 순서·이름을 그대로 맞춘다).
     */
    record Appearance(
            String clothes,
            String decor,
            String head,
            String neck,
            String shoes,
            String hull,
            String position,
            long version) {
    }
}
