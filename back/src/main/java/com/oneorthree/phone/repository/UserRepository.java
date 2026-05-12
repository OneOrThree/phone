package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {
    // 소셜 로그인
    Optional<User> findByNickname(String nickname);
}
