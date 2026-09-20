package com.oneorthree.realtime.event;

import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** 신뢰한 도메인 생산자가 정본에서 결정한 수신 대상. 외부 요청 DTO로 노출하지 않는다. */
public sealed interface RealtimeAudience {

    /**
     * 그 섬의 토픽으로 나간다.
     *
     * @param islandId   섬
     * @param recipients <b>비어 있으면 제한 없음</b> — 그 목적지를 구독한 사람 전부가 받는다(관전 채널).
     *                   수신 자격이 구독 인가보다 좁은 채널(응원)만 채운다. 「비어 있음 = 아무도 아님」이
     *                   아니라는 점이 함정이라, {@link EventRouter} 가 그런 채널에 대해 <b>비어 있지 않을
     *                   것</b>을 강제한다 — 실수로 빈 집합을 넘기면 전원 공개가 되는 대신 거절된다
     */
    record IslandAudience(UUID islandId, Set<UUID> recipients) implements RealtimeAudience {

        public IslandAudience(UUID islandId) {
            this(islandId, Set.of());
        }

        public IslandAudience {
            Objects.requireNonNull(islandId, "islandId");
            recipients = Set.copyOf(recipients);
        }
    }

    record UserAudience(Set<UUID> userIds) implements RealtimeAudience {
        public UserAudience {
            userIds = Set.copyOf(userIds);
            if (userIds.isEmpty()) {
                throw new IllegalArgumentException("수신 사용자가 필요합니다.");
            }
        }
    }
}
