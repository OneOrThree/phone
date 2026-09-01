package com.oneorthree.phone.item.repository;

import com.oneorthree.phone.item.repository.domain.Item;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.item.repository.domain.UserItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;


import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 유저 보유 아이템 저장소. (user_id, item_id) 가 유니크라 같은 아이템을 두 번 갖지 않는다
 * — 수량 개념이 없고 "있다/없다"만 있다.
 */
public interface UserItemRepository extends JpaRepository<UserItem, UUID> {

    /**
     * 인벤토리 조회
     *
     * @param user 대상 유저
     * @return 보유 행 전부. 착용 중인지 여부는 여기서 알 수 없다
     */
    List<UserItem> findByUser(User user);

    /**
     * 아이템 소유 여부 확인 + acquiredAt 확보 (장착 이벤트 payload 용)
     *
     * @param user 대상 유저
     * @param item 확인할 아이템
     * @return 보유 행. empty 면 미보유라 장착 요청을 거절해야 한다
     */
    Optional<UserItem> findByUserAndItem(User user, Item item);

    /**
     * 아이템 지급 (ON CONFLICT DO NOTHING)
     *
     * <p>이미 갖고 있으면 조용히 넘어가므로 여러 번 불러도 결과가 같다. 엔티티를 거치지 않는
     * 네이티브 INSERT 라 영속성 컨텍스트에는 반영되지 않는다는 점에 주의한다.
     *
     * @param userId 받을 유저
     * @param itemId 넣어 줄 아이템
     */
    @Modifying
    @Query(value = """
                INSERT INTO user_items (user_id, item_id, created_at)
                VALUES (:userId, :itemId, now())
                ON CONFLICT (user_id, item_id) DO NOTHING
                """, nativeQuery = true)
    void grantIfNotExists(@Param("userId") UUID userId, @Param("itemId") UUID itemId);
}
