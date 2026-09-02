package com.oneorthree.phone.item.repository;

import com.oneorthree.phone.item.repository.domain.CharacterEquipment;
import com.oneorthree.phone.item.repository.domain.SlotType;
import com.oneorthree.phone.user.repository.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 캐릭터 착용 상태 저장소. (user, slot_type) 이 유니크라 한 칸에 두 개가 걸릴 수 없고,
 * 벗기는 행을 지우는 대신 item 을 null 로 만드는 방식이라 한 번 만든 칸의 행은 계속 남는다.
 */
public interface CharacterEquipmentRepository extends JpaRepository<CharacterEquipment, UUID> {

    /**
     * 유저의 전체 장착 상태 조회 (캐릭터 렌더링)
     *
     * @param user 대상 유저
     * @return 손댄 적 있는 칸의 행 전부. 벗어 둔 칸도 item 이 null 인 채로 함께 나온다
     */
    List<CharacterEquipment> findByUser(User user);

    /**
     * 여러 유저의 장착 상태 일괄 조회 (핀 친구 캐릭터 표시정보)
     *
     * @param users 대상 유저들
     * @return 유저별로 여러 행이 섞여 있는 평평한 목록 — 호출측이 유저 기준으로 묶어야 한다.
     *         한 번도 착용한 적 없는 유저는 아예 빠진다
     */
    List<CharacterEquipment> findByUserIn(Collection<User> users);

    /**
     * 특정 슬롯 장착 상태 조회 (장착 / 해제)
     *
     * @param user     대상 유저
     * @param slotType 볼 칸
     * @return 그 칸의 행. empty 는 "한 번도 그 칸을 쓴 적 없음"이고, 행은 있는데 item 이 null 이면
     *         "썼다가 벗어 둔 상태"라 둘을 구분해야 한다
     */
    Optional<CharacterEquipment> findByUserAndSlotType(User user, SlotType slotType);
}
