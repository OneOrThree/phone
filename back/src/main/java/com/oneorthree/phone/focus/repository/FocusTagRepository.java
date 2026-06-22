package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.domain.FocusTag;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface FocusTagRepository extends JpaRepository<FocusTag, UUID> {

    List<FocusTag> findByUser(User user);
}
