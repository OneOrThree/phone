package com.oneorthree.phone.domain;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

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
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "item_id", nullable = false)
    private Item item;

    @Enumerated(EnumType.STRING)
    @Column(name = "slot_type", nullable = false)
    private SlotType slotType;

    // todo 글로벌 시간 변경
    @CreationTimestamp
    @Column(name = "equipped_at", updatable = false)
    private Instant equippedAt;

    public void equip(Item item) {
        this.item = item;
    }
    public void unequip() {
        this.item = null;
    }
}
