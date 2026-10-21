package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.CustomizationRewardItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

/** 꾸미기 보상 후보 (GROMO-2301) — 읽기 전용. */
public interface CustomizationRewardItemRepository
        extends JpaRepository<CustomizationRewardItem, CustomizationRewardItem.Key> {

    List<CustomizationRewardItem> findByRevision(int revision);
}
