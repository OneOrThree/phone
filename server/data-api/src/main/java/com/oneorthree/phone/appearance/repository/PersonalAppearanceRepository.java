package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.PersonalAppearance;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface PersonalAppearanceRepository extends JpaRepository<PersonalAppearance, UUID> {

    /**
     * 외양 적용 경로 전용 배타 잠금 — <b>반드시 트랜잭션 안에서</b>.
     * version·병합·outbox 가 이 잠금 아래에서 직렬화된다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT a FROM PersonalAppearance a WHERE a.userId = :userId")
    Optional<PersonalAppearance> findByIdForUpdate(@Param("userId") UUID userId);

    /**
     * 첫 접근 때 행을 만든다 — {@code ON CONFLICT DO NOTHING} 으로 동시 첫 접근이
     * UNIQUE 위반으로 트랜잭션을 오염시키지 않는다 (aggregate_versions 선례).
     */
    @Modifying
    @Query(value = "INSERT INTO personal_appearances (user_id) VALUES (:userId) "
            + "ON CONFLICT (user_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId);
}
