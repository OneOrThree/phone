package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.domain.DefaultTag;
import com.oneorthree.phone.focus.domain.UserFocusTag;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserFocusTagRepository extends JpaRepository<UserFocusTag, UUID> {

    // 소프트 딜리트 — 활성(삭제되지 않은) 채택 태그만 조회
    List<UserFocusTag> findByUserAndDeletedAtIsNull(User user);

    Optional<UserFocusTag> findByIdAndDeletedAtIsNull(UUID id);

    // 중복 채택 방지 — (user, defaultTag) 활성 채택 존재 여부 확인
    Optional<UserFocusTag> findByUserAndDefaultTagAndDeletedAtIsNull(User user, DefaultTag defaultTag);
}
