package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.domain.FocusTag;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FocusTagRepository extends JpaRepository<FocusTag, UUID> {

    // 소프트 딜리트 — 활성(삭제되지 않은) 태그만 조회
    List<FocusTag> findByUserAndDeletedAtIsNull(User user);

    Optional<FocusTag> findByIdAndDeletedAtIsNull(UUID id);
}
