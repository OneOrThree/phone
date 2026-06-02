package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.FocusTag;
import com.oneorthree.phone.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface FocusTagRepository extends JpaRepository<FocusTag, Long> {
    List<FocusTag> findByUser(User user);
}
