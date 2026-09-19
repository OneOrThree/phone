package com.oneorthree.phone.shop.repository;

import com.oneorthree.phone.shop.repository.domain.ShopCatalogActivePublication;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ShopCatalogActivePublicationRepository extends JpaRepository<ShopCatalogActivePublication, Boolean> {
}
