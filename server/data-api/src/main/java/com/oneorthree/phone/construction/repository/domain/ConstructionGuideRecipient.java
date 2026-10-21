package com.oneorthree.phone.construction.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

/** 착공 시점에 확정한 실제 기여 주민. 이후 가입자는 이 명단에 추가하지 않는다. */
@Entity
@Table(name = "construction_guide_recipients")
@IdClass(ConstructionGuideRecipientId.class)
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class ConstructionGuideRecipient {
    @Id
    @Column(name = "island_id", nullable = false)
    private UUID islandId;
    @Id
    @Column(name = "building_id", nullable = false, length = 30)
    private String buildingId;
    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;
}
