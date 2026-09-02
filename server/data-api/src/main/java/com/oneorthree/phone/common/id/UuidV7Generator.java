package com.oneorthree.phone.common.id;

import com.fasterxml.uuid.Generators;
import org.hibernate.engine.spi.SharedSessionContractImplementor;
import org.hibernate.generator.BeforeExecutionGenerator;
import org.hibernate.generator.EventType;

import java.util.EnumSet;
import java.util.UUID;

/**
 * {@link GeneratedUuidV7} 의 실제 생성기. Hibernate 가 INSERT 를 실행하기 <b>전에</b> 호출하므로
 * 애플리케이션은 flush 전에도 PK 를 알 수 있다 — DB 시퀀스와 달리 왕복이 필요 없고,
 * 부모·자식을 한 트랜잭션에서 조립할 때 id 를 먼저 쓸 수 있다.
 *
 * <p>{@link org.hibernate.generator.EventType#INSERT} 만 처리한다. UPDATE 에서도 값을 만들면
 * PK 가 바뀌어 기존 참조가 통째로 끊기므로, 이미 값이 있는 행은 손대지 않는다.
 */
public class UuidV7Generator implements BeforeExecutionGenerator {

    @Override
    public UUID generate(SharedSessionContractImplementor session, Object owner, Object currentValue,
            EventType eventType) {
        return Generators.timeBasedEpochRandomGenerator().generate();
    }

    @Override
    public EnumSet<EventType> getEventTypes() {
        return EnumSet.of(EventType.INSERT);
    }
}
