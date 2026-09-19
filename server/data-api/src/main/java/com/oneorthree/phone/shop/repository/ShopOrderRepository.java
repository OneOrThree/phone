package com.oneorthree.phone.shop.repository;

import com.oneorthree.phone.shop.repository.domain.ShopOrder;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface ShopOrderRepository extends JpaRepository<ShopOrder, UUID> {
}
