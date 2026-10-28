package com.oneorthree.phone.shop.repository;

import com.oneorthree.phone.shop.repository.domain.ShopProductRevision;
import com.oneorthree.phone.shop.repository.domain.ShopProductRevisionId;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ShopProductRevisionRepository extends JpaRepository<ShopProductRevision, ShopProductRevisionId> {
}
