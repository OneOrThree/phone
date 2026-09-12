package com.oneorthree.realtime.event;

import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** 신뢰한 도메인 생산자가 정본에서 결정한 수신 대상. 외부 요청 DTO로 노출하지 않는다. */
public sealed interface RealtimeAudience {

    record IslandAudience(UUID islandId) implements RealtimeAudience {
        public IslandAudience {
            Objects.requireNonNull(islandId, "islandId");
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
