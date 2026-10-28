package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

/**
 * 유저별 알림 수신 설정. PK 가 곧 유저 id(1:1)다. 행이 없으면 아직 한 번도 설정을 저장하지 않은
 * 유저이므로, 수신 여부 판정은 그 경우의 기본값을 호출측이 정한다.
 *
 * <p><b>쓰기 경로만 잠금 조회를 쓴다</b>(GROMO-1659) — 발송 경로의 대량 조회는 잠금 없이 남는다.
 * 이 행에는 <b>동시 쓰기 주체가 둘</b>이다: 공개 {@code PUT /users/me/notification-settings}(전체 교체)와
 * 내부 {@code PUT /internal/users/{id}/notification-settings-commands}(전체 교체 + 순서용 version 발급).
 */
public interface UserNotificationSettingsRepository extends JpaRepository<UserNotificationSettings, UUID> {

    /**
     * 설정을 <b>바꿀</b> 트랜잭션용 배타 잠금 조회.
     *
     * <p>잠금 없이 읽으면 「읽은 상태 → 새 상태」 판정이 커밋 순서와 어긋난다. 초기 상태가 켜짐일 때
     * 「끄기」와 「켜짐 유지」가 겹치면, 끄기가 먼저 커밋돼도 둘째 트랜잭션의 엔티티 스냅샷은 여전히
     * 켜짐이라 Hibernate 가 <b>변경 없음으로 보고 UPDATE 를 생략</b>한다. 그런데 봉투는 더 높은
     * version 의 「켬」으로 나가므로, Data 는 꺼짐 · 알림 서버는 켬이 된다.
     *
     * <p>배타 잠금으로 읽으면 둘째 트랜잭션의 판독이 상대 커밋 <b>뒤</b>로 밀리고, Postgres 가 잠금
     * 해제 시점에 최신 행으로 재평가해 준다 — 그래서 「끔 → 켬」이 실제 더티 UPDATE 가 되고 행과
     * 봉투가 같아진다. 잠금은 <b>version 발급(aggregate 행 잠금)보다 앞서</b> 잡아야 한다. 뒤에 잡으면
     * 이미 낡은 상태를 읽은 뒤라 순서가 고쳐지지 않는다.
     *
     * <p><b>범위는 이 행의 판독 직렬화까지다.</b> 이 잠금이 보장하는 것은 「설정 상태를 읽고 바꾸는
     * 트랜잭션끼리 순서가 선다」 하나뿐이다. 여기서 잡는 순서는 <b>설정 행 → aggregate 행</b>이고
     * 이 트랜잭션은 그 둘 말고 다른 행을 잠그지 않는다. 알림 전반의 잠금 순서가 안전하다는 뜻은
     * <b>아니다</b> — 다중 수신자 USER 축 교착은 GROMO-893 으로 미해결이며 이 변경이 건드리지 않는다.
     *
     * @param userId 설정 주인
     * @return 잠긴 설정. <b>행이 없으면 빈 값</b> — 파기 여부(soft delete) 판정은 호출부가 한다.
     *     지금 두 호출부의 파기 취급이 서로 달라서 여기서 접지 않는다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM UserNotificationSettings s WHERE s.userId = :userId")
    Optional<UserNotificationSettings> findByIdForUpdate(@Param("userId") UUID userId);
}
