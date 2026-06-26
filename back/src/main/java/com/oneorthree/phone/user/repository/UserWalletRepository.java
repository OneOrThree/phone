package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.UserWallet;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface UserWalletRepository extends JpaRepository<UserWallet, UUID> {
}
