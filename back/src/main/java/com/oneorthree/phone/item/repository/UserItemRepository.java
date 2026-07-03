package com.oneorthree.phone.item.repository;

import com.oneorthree.phone.item.domain.Item;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.item.domain.UserItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;


import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserItemRepository extends JpaRepository<UserItem, UUID> {

    // 인벤토리 조회
    List<UserItem> findByUser(User user);

    // 아이템 소유 여부 확인 + acquiredAt 확보 (장착 이벤트 payload 용)
    Optional<UserItem> findByUserAndItem(User user, Item item);

    // 아이템 지급 (ON CONFLICT DO NOTHING)
    @Modifying
    @Query(value = """
                INSERT INTO user_items (user_id, item_id, acquired_at)
                VALUES (:userId, :itemId, now())
                ON CONFLICT (user_id, item_id) DO NOTHING
                """, nativeQuery = true)
    void grantIfNotExists(@Param("userId") UUID userId, @Param("itemId") UUID itemId);
}
