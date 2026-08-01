package com.oneorthree.phone.character.repository;

import com.oneorthree.phone.character.domain.CharacterGeneration;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface CharacterGenerationRepository extends JpaRepository<CharacterGeneration, UUID> {

    /** 롤링 윈도우(from 이후) 내 유저의 생성 건수 — remaining 계산용. */
    long countByUserAndCreatedAtGreaterThanEqual(User user, Instant from);

    /** 롤링 윈도우(from 이후) 내 가장 오래된 생성 — resetAt(슬롯이 비는 시각) 계산용. */
    Optional<CharacterGeneration> findFirstByUserAndCreatedAtGreaterThanEqualOrderByCreatedAtAsc(
            User user, Instant from);
}
