package com.oneorthree.phone.repository.item;

import com.oneorthree.phone.domain.item.Item;
import com.oneorthree.phone.domain.item.ItemType;
import com.oneorthree.phone.domain.item.SlotType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ItemRepository extends JpaRepository<Item, Long> {
    List<Item> findByItemType(ItemType itemType);
    List<Item> findBySlotType(SlotType slotType);
}
