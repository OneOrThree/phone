package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.CurrencyTransaction;
import com.oneorthree.phone.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CurrencyTransactionRepository extends JpaRepository<CurrencyTransaction, Long> {
    List<CurrencyTransaction> findByUserOrderByTransactedAtDesc(User user);
}
