package com.oneorthree.phone.item.repository.domain;

import com.oneorthree.phone.user.repository.domain.User;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(
        name = "character_equipment",
        uniqueConstraints = {
                @UniqueConstraint(columnNames = {"user_id", "slot_type"})
        }
)
@Getter
@Builder
@AllArgsConstructor
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CharacterEquipment {

    // NOTE(671 스코프 밖 — GROMO-707): item_id(FK→items) → user_item_id(FK→user_items) 참조 재설계는
    //   장착 로직 변경을 동반하는 후속 티켓(707)에서 진행. 671 에서는 건드리지 않음.

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "item_id", nullable = false)
    private Item item;

    @Enumerated(EnumType.STRING)
    @Column(name = "slot_type", nullable = false)
    private SlotType slotType;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    public void equip(Item item) {
        this.item = item;
    }

    public void unequip() {
        this.item = null;
    }

}
