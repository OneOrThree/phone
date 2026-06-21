package com.oneorthree.phone.currency.repository;

import com.oneorthree.phone.currency.domain.CurrencyTransaction;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CurrencyTransactionRepository extends JpaRepository<CurrencyTransaction, Long> {

    List<CurrencyTransaction> findByUserOrderByTransactedAtDesc(User user);
}
