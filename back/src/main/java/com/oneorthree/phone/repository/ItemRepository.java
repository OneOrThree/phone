package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.Item;
import com.oneorthree.phone.domain.SlotType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ItemRepository extends JpaRepository<Item, Long> {
    //슬롯 별 아이템 목록 (상점)
    List<Item> findbySlotType(SlotType slotType);
}
