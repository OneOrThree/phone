package com.oneorthree.phone.shop.repository;

import com.oneorthree.phone.shop.repository.domain.ShopCatalogActivePublication;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;

public interface ShopCatalogActivePublicationRepository extends JpaRepository<ShopCatalogActivePublication, Boolean> {

    /** 조회용 — 행이 없으면 활성 카탈로그가 없다(빈 목록). */
    @Query("SELECT p FROM ShopCatalogActivePublication p")
    Optional<ShopCatalogActivePublication> findCurrent();

    /**
     * 구매 TX 전용 공유 잠금 — 포인터 교체(발행)가 배타로 잡으므로, 구매가 읽은 판매 revision 이 커밋까지
     * 활성으로 남는다(LLD §4 「활성 publication 포인터를 읽고 commit까지 직렬화」). 구매끼리는 막지 않는다.
     */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("SELECT p FROM ShopCatalogActivePublication p")
    Optional<ShopCatalogActivePublication> findCurrentForShare();
}
