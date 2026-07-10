package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.domain.DefaultTag;
import com.oneorthree.phone.focus.domain.UserFocusTag;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserFocusTagRepository extends JpaRepository<UserFocusTag, UUID> {

    // 소프트 딜리트 — 활성(삭제되지 않은) 채택 태그만 조회.
    // 목록 응답이 tag.getDefaultTag().getName() 을 읽으므로 JOIN FETCH 로 N+1 방지 (PR #170 리뷰).
    @Query("SELECT ut FROM UserFocusTag ut JOIN FETCH ut.defaultTag "
            + "WHERE ut.user = :user AND ut.deletedAt IS NULL")
    List<UserFocusTag> findByUserAndDeletedAtIsNull(@Param("user") User user);

    Optional<UserFocusTag> findByIdAndDeletedAtIsNull(UUID id);

    // 중복 채택 방지 — (user, defaultTag) 활성 채택 존재 여부 확인
    Optional<UserFocusTag> findByUserAndDefaultTagAndDeletedAtIsNull(User user, DefaultTag defaultTag);
}
