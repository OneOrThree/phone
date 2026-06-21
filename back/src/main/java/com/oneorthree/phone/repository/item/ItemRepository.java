package com.oneorthree.phone.repository.item;

import com.oneorthree.phone.domain.item.Item;
import com.oneorthree.phone.domain.item.ItemType;
import com.oneorthree.phone.domain.item.SlotType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ItemRepository extends JpaRepository<Item, UUID> {

    List<Item> findByItemType(ItemType itemType);

    List<Item> findBySlotType(SlotType slotType);
}
