package com.oneorthree.realtime.common.id;

import org.hibernate.engine.spi.SharedSessionContractImplementor;
import org.hibernate.generator.BeforeExecutionGenerator;
import org.hibernate.generator.EventType;

import java.util.EnumSet;
import java.util.UUID;

/**
 * UUID v7 PK 생성기 — Data API 의 같은 이름 클래스와 동작이 같다(서비스가 갈려 코드를 공유하지 않을 뿐).
 *
 * <p>채팅에서 v7 은 단순한 인덱스 지역성 최적화가 아니라 <b>커서 페이징의 근거</b>다. v7 은 앞 48비트가
 * epoch 밀리초라 사전순 정렬 = 시간순 정렬이고, 그래서 히스토리 조회가 {@code id < :cursor} 하나로
 * "이 메시지보다 과거"를 표현할 수 있다. v4 로 바꾸면 정렬이 무작위가 되어 페이징이 조용히 깨진다.
 *
 * <p>발급은 {@link UuidV7} 한 곳으로 모은다 — 같은 밀리초 안의 단조성이 «공유 생성기»에서만
 * 성립하기 때문이다. 이 클래스에서 직접 {@code Generators.…} 를 부르면 그 성질이 조용히 사라진다
 * (근거와 실측은 {@link UuidV7} 참조).
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
