package com.oneorthree.phone.outbox.service;

import com.oneorthree.phone.config.OutboxRelayProperties;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * relay 의 <b>트랜잭션 경계</b> — 선점·완료·실패 표시만 한다 (A21).
 *
 * <p>{@link OutboxRelayService} 와 분리한 이유는 하나다: {@code @Transactional} 은 프록시가 만드는
 * 경계라 <b>같은 클래스 안의 자기 호출은 경계를 타지 않는다</b>. 오케스트레이션과 트랜잭션을 한
 * 클래스에 두면 선점이 트랜잭션 없이 돌고, 그건 컴파일도 테스트도 잡아 주지 않는다.
 *
 * <p>외부 호출(브로커·HTTP)은 여기 없다 — 전달은 트랜잭션 밖에서 일어나야 한다.
 *
 * <p>{@code @Service} 가 아니라 {@code OutboxRelayConfig} 의 {@code @Bean} 인 이유: relay 가 꺼진
 * 기동에서는 {@code OutboxRelayProperties} 자체가 없다. 컴포넌트 스캔으로 잡히면 꺼 둔 서버가
 * 「설정이 없다」로 기동에 실패한다.
 */
@RequiredArgsConstructor
public class OutboxRelayStore {

    private final EventOutboxDeliveryRepository deliveryRepository;
    private final OutboxRelayProperties properties;
    private final Clock clock;

    /**
     * 한 대상의 미전달 행을 리스로 선점하고 그 행들을 돌려준다.
     *
     * <p>만료 리스 회수도 같은 문장이 한다 — 죽은 워커가 잡아 둔 행은 {@code lease_expires_at} 이
     * 지난 순간 다시 후보가 된다.
     *
     * @param target 전달 대상
     * @param owner  워커 식별자
     * @param token  이번 선점의 펜싱 토큰
     * @return 이 워커가 소유하게 된 행들. 순서 축별로 가장 낮은 version 하나씩이다
     */
    @Transactional
    public List<EventOutboxDelivery> claim(OutboxTarget target, String owner, UUID token) {
        Instant now = clock.instant();
        Instant leaseUntil = now.plus(properties.getLeaseDuration());
        int count = deliveryRepository.claimBatch(
                target.name(), now, leaseUntil, owner, token, properties.getBatchSize());
        if (count == 0) {
            return List.of();
        }
        return deliveryRepository.findLeased(token);
    }

    /**
     * 전달 완료 표시 — 토큰이 일치할 때만.
     *
     * @param deliveryId 전달 행
     * @param token      선점 때 받은 펜싱 토큰
     * @return 1 = 표시됨, 0 = 리스를 이미 잃었다(낡은 완료 보고)
     */
    @Transactional
    public int markDelivered(UUID deliveryId, UUID token) {
        return deliveryRepository.markDelivered(deliveryId, token, clock.instant());
    }

    /**
     * 실패를 기록하고 다음 시도 시각을 민다 — 토큰이 일치할 때만.
     *
     * <p><b>행을 지우지 않는다.</b> 고갈 처리는 A18 보류라 여기서 임의로 정하지 않는다.
     *
     * @param deliveryId 전달 행
     * @param token      선점 때 받은 펜싱 토큰
     * @param nextAt     다음 시도 시각
     * @param error      마지막 오류 요약
     * @return 1 = 기록됨, 0 = 리스를 이미 잃었다
     */
    @Transactional
    public int markFailed(UUID deliveryId, UUID token, Instant nextAt, String error) {
        return deliveryRepository.markFailed(deliveryId, token, nextAt, error);
    }
}
