package com.oneorthree.phone.construction.repository;

import com.oneorthree.phone.construction.repository.domain.ConstructionGuideRecipient;
import com.oneorthree.phone.construction.repository.domain.ConstructionGuideRecipientId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface ConstructionGuideRecipientRepository
        extends JpaRepository<ConstructionGuideRecipient, ConstructionGuideRecipientId> {
    /** 현재 주민이며 서버에서 완공을 확정한 건설만 안내한다. */
    @Query(value = "SELECT r.* FROM construction_guide_recipients r "
            + "JOIN island_facilities f ON f.island_id = r.island_id AND f.building_id = r.building_id "
            + "JOIN group_members gm ON gm.group_id = r.island_id AND gm.user_id = r.user_id "
            + "WHERE r.island_id = :islandId AND r.user_id = :userId "
            + "AND f.status = 'COMPLETED' AND gm.is_left = false "
            + "ORDER BY f.completed_at, r.building_id", nativeQuery = true)
    List<ConstructionGuideRecipient> findCompletedForResident(@Param("islandId") UUID islandId,
                                                              @Param("userId") UUID userId);
}
