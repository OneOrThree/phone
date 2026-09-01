package com.oneorthree.phone.item.repository;

import com.oneorthree.phone.item.repository.domain.Item;
import com.oneorthree.phone.item.repository.domain.ItemType;
import com.oneorthree.phone.item.repository.domain.SlotType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/**
 * 아이템 카탈로그 저장소. 유저별 보유가 아니라 상점에 존재하는 아이템 원본을 다룬다.
 */
public interface ItemRepository extends JpaRepository<Item, UUID> {

    /**
     * 종류로 카탈로그를 훑는다.
     *
     * @param itemType 착용 가능/장식 등 아이템 종류
     * @return 해당 종류의 아이템 전부. 판매 중단(is_active=false) 여부는 걸러 주지 않으므로 호출측이 봐야 한다
     */
    List<Item> findByItemType(ItemType itemType);

    /**
     * 착용 칸으로 카탈로그를 훑는다.
     *
     * @param slotType 대상 칸
     * @return 그 칸에 들어갈 수 있는 아이템 전부. 칸을 차지하지 않는 장식 아이템은 어떤 칸으로도 잡히지 않는다
     */
    List<Item> findBySlotType(SlotType slotType);
}
