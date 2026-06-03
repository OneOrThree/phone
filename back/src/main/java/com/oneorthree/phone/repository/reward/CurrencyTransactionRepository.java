package com.oneorthree.phone.repository.reward;

import com.oneorthree.phone.domain.reward.CurrencyTransaction;
import com.oneorthree.phone.domain.user.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CurrencyTransactionRepository extends JpaRepository<CurrencyTransaction, Long> {

    List<CurrencyTransaction> findByUserOrderByTransactedAtDesc(User user);
}
