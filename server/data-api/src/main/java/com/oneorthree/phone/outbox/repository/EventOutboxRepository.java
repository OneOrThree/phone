package com.oneorthree.phone.outbox.repository;

import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/** 봉투 저장·조회. 봉투는 불변이라 갱신 메서드를 두지 않는다. */
public interface EventOutboxRepository extends JpaRepository<EventOutbox, UUID> {

    /**
     * 결정적 사건 키로 찾는다 — 재기록 판단·리컨실·수동 재전송 입구가 쓴다.
     *
     * @param eventId 결정적 사건 키
     * @return 있으면 봉투
     */
    Optional<EventOutbox> findByEventId(String eventId);
}
