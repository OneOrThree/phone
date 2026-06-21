package com.oneorthree.phone.currency.repository;

import com.oneorthree.phone.currency.domain.CurrencyTransaction;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface CurrencyTransactionRepository extends JpaRepository<CurrencyTransaction, UUID> {

    List<CurrencyTransaction> findByUserOrderByTransactedAtDesc(User user);
}
