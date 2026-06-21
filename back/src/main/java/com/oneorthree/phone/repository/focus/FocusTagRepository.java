package com.oneorthree.phone.repository.focus;

import com.oneorthree.phone.domain.focus.FocusTag;
import com.oneorthree.phone.domain.user.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface FocusTagRepository extends JpaRepository<FocusTag, UUID> {

    List<FocusTag> findByUser(User user);
}
