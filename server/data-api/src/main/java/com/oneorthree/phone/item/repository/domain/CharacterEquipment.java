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

/**
 * 캐릭터의 착용 칸 하나. (user_id, slot_type) 이 유니크라 한 칸에는 언제나 최대 하나만 걸린다.
 *
 * <p>벗기기는 행을 지우지 않고 {@code item} 을 null 로 만드는 방식이라, 한 번 쓴 칸의 행은
 * 계속 남는다 — 행의 존재는 "착용 중"이 아니라 "이 칸을 쓴 적 있음"을 뜻한다.
 */
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

    /**
     * 이 칸에 아이템을 건다.
     *
     * @param item 걸 아이템. 이미 걸려 있던 것은 조용히 밀려나므로, 호출 전에 칸이 비어 있는지
     *             확인할 필요가 없다
     */
    public void equip(Item item) {
        this.item = item;
    }

    /**
     * 이 칸을 비운다. 행 자체는 남으므로 이후 조회에서 item 이 null 인 칸으로 계속 보인다.
     */
    public void unequip() {
        this.item = null;
    }

}
