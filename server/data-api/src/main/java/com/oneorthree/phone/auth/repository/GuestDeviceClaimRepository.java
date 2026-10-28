package com.oneorthree.phone.auth.repository;

import com.oneorthree.phone.auth.repository.domain.GuestDeviceClaim;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 게스트 기기 점유 원장 (GROMO-2036).
 *
 * <p>조회·저장·삭제뿐이라 쿼리를 따로 적지 않는다. <b>동시 최초 발급의 판정자는 PK 유니크</b>이고,
 * 진 쪽은 트랜잭션이 통째로 롤백된 뒤(= 자기가 만들던 게스트 유저도 함께 사라진다) 다시 조회해
 * 이긴 쪽의 유저를 받는다 — 그 재시도는 {@code AuthService.guestSession} 이 소유한다.
 */
public interface GuestDeviceClaimRepository extends JpaRepository<GuestDeviceClaim, String> {
}
