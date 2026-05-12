package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.Item;
import com.oneorthree.phone.domain.UserItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.security.core.userdetails.User;

import java.util.List;

public interface UserItemRepository extends JpaRepository<UserItem, Long> {
    // 인벤토리 조회
    List<UserItem> findbyUser(User user);

    // 아이템 소유 여부 확인
    boolean existsByUserAndItem(User user, Item item);

    // 아이템 지급 (ON CONFLICT DO NOTHING)
    @Modifying
    @Query(value = """
        INSERT INTO user_items (user_id, item_id, acquired_at)
        VALUES (:userId, :itemId, now())
        ON CONFLICT (user_id, item_id) DO NOTHING
        """, nativeQuery = true)
    void grantIfNotExists(@Param("userId") Long userId, @Param("itemId") Long itemId);
}
