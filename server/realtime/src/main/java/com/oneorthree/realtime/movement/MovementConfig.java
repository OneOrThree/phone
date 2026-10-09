package com.oneorthree.realtime.movement;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.UUID;

/**
 * movement 패키지의 Spring 배선. {@link RoomRuntime.Listener} 구현은 2247(STOMP 경계)이 등록한다 — 그 전까지는
 * 여기 기본값(no-op)을 써서 빌드·부팅이 깨지지 않게 한다.
 */
@Configuration
public class MovementConfig {

    @Bean
    @ConditionalOnMissingBean(RoomRuntime.Listener.class)
    public RoomRuntime.Listener noOpMovementListener() {
        return new RoomRuntime.Listener() {
            @Override
            public void onEvent(UUID islandId, MovementEvent event, Target target) {
                // ponytail: 2247 이 실제 STOMP 전송을 배선하기 전까지는 버린다.
            }

            @Override
            public void onSnapshot(UUID islandId, MovementEvent.Snapshot snapshot) {
                // 위와 동일.
            }
        };
    }
}
