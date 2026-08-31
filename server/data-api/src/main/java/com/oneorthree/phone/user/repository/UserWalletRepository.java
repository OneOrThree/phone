package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.repository.domain.UserWallet;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface UserWalletRepository extends JpaRepository<UserWallet, UUID> {

    /**
     * 잔액을 <b>바꾸는</b> 경로 전용 지갑 조회 + 행 배타 락(SELECT … FOR UPDATE).
     *
     * <p><b>왜 낙관락(@Version)만으로는 부족한가</b>: 같은 지갑을 동시에 건드리는 두 트랜잭션은
     * 각자 같은 version 을 읽고 둘 다 UPDATE 를 시도해, 늦은 쪽이 0행 갱신으로
     * {@code ObjectOptimisticLockingFailureException} 을 맞고 <b>트랜잭션 전체가 롤백</b>된다.
     * 챌린지 삭제처럼 한 트랜잭션이 여러 회차·여러 참가자의 환불을 한꺼번에 처리하는 경로에서는,
     * 참가자가 겹치는 삭제 두 건이 동시에 들어오면 한쪽의 삭제·환불이 통째로 실패한다(실측).
     * 비관 락이면 늦은 쪽이 <b>기다렸다가</b> 갱신된 값을 읽어 정상 진행한다.
     *
     * <p><b>교착이 나지 않는 이유</b>: 지갑을 여러 개 잡는 경로는 전부 <b>userId 오름차순</b>으로만
     * 접근한다(계약 §3, 전역 락 순서 = 회차 id 오름차순 → 지갑 userId 오름차순). 리그 주간 배치처럼
     * 유저가 많은 경로는 <b>유저 1명 = 트랜잭션 1개</b>라(배치 빈이 무트랜잭션이고 정산기가
     * {@code @Transactional}) 한 트랜잭션이 지갑을 하나만 잡는다 — 대기 사슬이 생기지 않는다.
     *
     * <p><b>읽기 전용 조회에는 쓰지 말 것</b> — 잔액 표시 같은 순수 조회가 배타 락을 잡으면 무관한
     * 결제·정산이 줄줄이 막히고, {@code @Transactional(readOnly = true)} 아래에서는 Postgres 가
     * {@code FOR UPDATE} 자체를 거절한다(리그에서 겪은 전례). 표시용은 {@code findById} 를 쓴다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select w from UserWallet w where w.userId = :userId")
    Optional<UserWallet> findByIdForUpdate(@Param("userId") UUID userId);
}
