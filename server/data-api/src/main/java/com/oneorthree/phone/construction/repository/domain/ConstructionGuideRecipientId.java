package com.oneorthree.phone.construction.repository.domain;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.UUID;

@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class ConstructionGuideRecipientId implements Serializable {
    private UUID islandId;
    private String buildingId;
    private UUID userId;
}
