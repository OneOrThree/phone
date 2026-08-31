package com.oneorthree.phone.item.repository;

import com.oneorthree.phone.item.repository.domain.Item;
import com.oneorthree.phone.item.repository.domain.ItemType;
import com.oneorthree.phone.item.repository.domain.SlotType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ItemRepository extends JpaRepository<Item, UUID> {

    List<Item> findByItemType(ItemType itemType);

    List<Item> findBySlotType(SlotType slotType);
}
