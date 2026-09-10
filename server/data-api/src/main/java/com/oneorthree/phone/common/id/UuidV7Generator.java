package com.oneorthree.phone.common.id;

import org.hibernate.engine.spi.SharedSessionContractImplementor;
import org.hibernate.generator.BeforeExecutionGenerator;
import org.hibernate.generator.EventType;

import java.util.EnumSet;
import java.util.UUID;

/**
 * 엔티티 PK 용 UUID v7 생성기 — 발급은 {@link UuidV7} 한 곳으로 모은다.
 *
 * <p>여기서 직접 {@code Generators.…().generate()} 를 부르면 <b>같은 밀리초 안의 단조성이 조용히
 * 사라진다</b>(호출마다 카운터가 초기화된다). 실측과 근거는 {@link UuidV7} 의 표에 있다.
 *
 * <p><b>이 성질은 이제 계약이다.</b> 종전에는 PK 순서에 기대는 조회가 없어 무해했지만, 집중 프레즌스
 * 리스가 {@code focus_sessions.id} 의 시간 순서로 「어느 시작·종료가 더 새로운가」를 판정한다
 * (GROMO-292, {@code common/port/RedisFocusPresence}). 단조성이 깨지면 정상적인 새 시작이
 * 「이미 끝난 세션」으로 무시되거나, 옛 리스가 남아 최대 13시간 채팅이 막힌다.
 */
public class UuidV7Generator implements BeforeExecutionGenerator {

    @Override
    public UUID generate(SharedSessionContractImplementor session, Object owner, Object currentValue,
            EventType eventType) {
        return UuidV7.next();
    }

    @Override
    public EnumSet<EventType> getEventTypes() {
        return EnumSet.of(EventType.INSERT);
    }
}
