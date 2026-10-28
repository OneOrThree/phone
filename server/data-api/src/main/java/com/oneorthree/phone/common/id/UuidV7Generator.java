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
 * <p>집중 프레즌스 리스는 한때 {@code focus_sessions.id} 의 시간 순서로 순서를 판정했으나, 그 순서는
 * 인스턴스 시계에 묶여 다중화에서 어긋나므로 DB 순번({@code presence_order})으로 옮겼다(GROMO-1743).
 * PK 의 단조성은 여전히 지키지만, 이제 인스턴스 사이의 순서를 여기에 기대는 코드는 없다.
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
