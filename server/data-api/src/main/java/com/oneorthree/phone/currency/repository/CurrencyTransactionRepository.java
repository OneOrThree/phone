package com.oneorthree.phone.currency.repository;

import com.oneorthree.phone.currency.repository.domain.CurrencyTransaction;
import com.oneorthree.phone.user.repository.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface CurrencyTransactionRepository extends JpaRepository<CurrencyTransaction, UUID> {

    List<CurrencyTransaction> findByUserOrderByCreatedAtDesc(User user);

    /**
     * 멱등키 선점 여부. 유니크 제약이 최후 방어선이고 이 조회는 그 앞단 가드다
     * — 정산 배치 재실행처럼 "이미 적용됨"이 정상 흐름인 경로에서 예외 대신 스킵으로 처리하기 위함.
     */
    boolean existsByIdempotencyKey(String idempotencyKey);
}
