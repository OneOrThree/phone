package com.oneorthree.phone.character.service.repository;

import com.oneorthree.phone.character.service.repository.domain.CharacterGeneration;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface CharacterGenerationRepository extends JpaRepository<CharacterGeneration, UUID> {

    /** 롤링 윈도우(from 이후) 내 유저의 생성 건수 — remaining 계산용. */
    long countByUserAndCreatedAtGreaterThanEqual(User user, Instant from);

    /**
     * 롤링 윈도우(from 이후) 내 생성 시각을 오래된 순으로 조회 — resetAt(슬롯이 비는 시각) 계산용.
     *
     * <p>창에 한도(ROLLING_LIMIT) 초과 행이 있을 수 있어(무제한 grace spillover·경쟁) 가장 오래된 행이 아니라
     * "실제로 슬롯을 여는" (count - limit) 오프셋 행을 집어야 한다. 서비스가 {@code PageRequest.of(offset, 1)} 로
     * OFFSET :offset LIMIT 1 을 지정해 해당 행을 가져온다.
     */
    @Query("SELECT g.createdAt FROM CharacterGeneration g"
            + " WHERE g.user = :user AND g.createdAt >= :from"
            + " ORDER BY g.createdAt ASC")
    List<Instant> findCreatedAtInWindowOrderByCreatedAtAsc(User user, Instant from, Pageable pageable);

    /** 멱등키 중복 확인 — 같은 (user, clientGenerationId) 기록이 이미 있으면 재기록을 no-op 처리(③). */
    boolean existsByUserAndClientGenerationId(User user, UUID clientGenerationId);
}
