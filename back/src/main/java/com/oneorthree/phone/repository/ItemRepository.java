package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.Item;
import com.oneorthree.phone.domain.ItemType;
import com.oneorthree.phone.domain.SlotType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ItemRepository extends JpaRepository<Item, Long> {
    List<Item> findByItemType(ItemType itemType);
    List<Item> findBySlotType(SlotType slotType);
}
