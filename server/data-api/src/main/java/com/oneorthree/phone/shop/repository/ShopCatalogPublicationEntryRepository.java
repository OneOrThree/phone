package com.oneorthree.phone.shop.repository;

import com.oneorthree.phone.shop.repository.domain.ShopCatalogPublicationEntry;
import com.oneorthree.phone.shop.repository.domain.ShopCatalogPublicationEntryId;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ShopCatalogPublicationEntryRepository
        extends JpaRepository<ShopCatalogPublicationEntry, ShopCatalogPublicationEntryId> {
}
