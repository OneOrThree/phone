package com.oneorthree.phone.item.repository;

import com.oneorthree.phone.item.domain.Item;
import com.oneorthree.phone.item.domain.ItemType;
import com.oneorthree.phone.item.domain.SlotType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ItemRepository extends JpaRepository<Item, Long> {

    List<Item> findByItemType(ItemType itemType);

    List<Item> findBySlotType(SlotType slotType);
}
