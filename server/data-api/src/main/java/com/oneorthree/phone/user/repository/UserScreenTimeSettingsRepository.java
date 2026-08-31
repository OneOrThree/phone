package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.repository.domain.UserScreenTimeSettings;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface UserScreenTimeSettingsRepository extends JpaRepository<UserScreenTimeSettings, UUID> {

    /**
     * 스크린타임 권한 <b>공유 잠금</b> 조회 — SCREEN_TIME 회차 참여 가드(N50) 전용.
     *
     * <p>락 없이 읽으면 "권한 true 확인 → 차감" 사이에 권한 회수({@link #findByIdForUpdate} 를 쓰는
     * 수정 경로)가 커밋돼, <b>보고 수단이 없는 유저가 유료 회차에 남는다</b>(미보고 = 미달성이라
     * 확정 패배 — 권한 가드를 둔 이유 자체가 무너진다). 참여 경로의 users 행 공유 락으로는 막지
     * 못한다 — 권한 수정은 users 를 건드리지 않고 설정 테이블만 바꾸기 때문이다(멤버십 재검증에
     * 별도 잠금이 필요한 N54 와 같은 구조).
     *
     * <p>공유 잠금끼리는 충돌하지 않아 동시 참여는 그대로 병렬이다. 회수가 먼저 커밋되면 이 조회가
     * false 를 보고 409, 참여가 먼저면 회수가 참여 커밋까지 기다린다(그 순간엔 권한이 실제로
     * 있었으므로 참가가 유효하다).
     */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("SELECT s FROM UserScreenTimeSettings s WHERE s.userId = :userId")
    Optional<UserScreenTimeSettings> findByIdForShare(@Param("userId") UUID userId);

    /** 권한 수정 경로용 <b>배타 잠금</b> — 위 공유 잠금과 짝을 이뤄 참여 검사와 직렬화된다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM UserScreenTimeSettings s WHERE s.userId = :userId")
    Optional<UserScreenTimeSettings> findByIdForUpdate(@Param("userId") UUID userId);
}
