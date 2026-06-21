package com.oneorthree.phone.repository.focus;

import com.oneorthree.phone.domain.focus.FocusTag;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface FocusTagRepository extends JpaRepository<FocusTag, Long> {

    List<FocusTag> findByUser(User user);
}
