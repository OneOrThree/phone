package com.oneorthree.phone.currency.repository;

import com.oneorthree.phone.currency.repository.domain.CurrencyTransaction;
import com.oneorthree.phone.user.repository.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/**
 * 재화 변동 원장. append-only 이고 기입을 고쳐 쓰지 않으므로, 잔액이 의심스러울 때
 * 대조 근거가 되는 곳이다. 중복 기입 방지는 {@code idempotency_key} 유니크 제약이 맡는다.
 */
public interface CurrencyTransactionRepository extends JpaRepository<CurrencyTransaction, UUID> {

    /**
     * 유저의 전체 원장을 최신순으로 읽는다.
     *
     * @param user 대상 유저
     * @return 기입 전체 — 페이지네이션이 없어 오래 쓴 유저일수록 목록이 길어진다
     */
    List<CurrencyTransaction> findByUserOrderByCreatedAtDesc(User user);

    /**
     * 멱등키 선점 여부. 유니크 제약이 최후 방어선이고 이 조회는 그 앞단 가드다
     * — 정산 배치 재실행처럼 "이미 적용됨"이 정상 흐름인 경로에서 예외 대신 스킵으로 처리하기 위함.
     *
     * @param idempotencyKey 호출자가 정한 멱등키
     * @return 이미 기입된 키면 true — 호출측은 잔액도 원장도 건드리지 않고 조용히 물러난다
     */
    boolean existsByIdempotencyKey(String idempotencyKey);
}
