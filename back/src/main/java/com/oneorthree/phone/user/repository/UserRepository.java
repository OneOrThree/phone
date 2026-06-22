package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByNickname(String nickname);

    Optional<User> findByRefreshToken(String refreshToken);
}
