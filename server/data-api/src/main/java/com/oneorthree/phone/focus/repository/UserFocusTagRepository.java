package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.DefaultTag;
import com.oneorthree.phone.focus.repository.domain.UserFocusTag;
import com.oneorthree.phone.user.repository.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserFocusTagRepository extends JpaRepository<UserFocusTag, UUID> {

    /**
     * 소프트 딜리트 — 활성(삭제되지 않은) 채택 태그만 조회.
     * 목록 응답이 tag.getDefaultTag().getName() 을 읽으므로 JOIN FETCH 로 N+1 방지 (PR #170 리뷰).
     */
    @Query("SELECT ut FROM UserFocusTag ut JOIN FETCH ut.defaultTag "
            + "WHERE ut.user = :user AND ut.deletedAt IS NULL")
    List<UserFocusTag> findByUserAndDeletedAtIsNull(@Param("user") User user);

    Optional<UserFocusTag> findByIdAndDeletedAtIsNull(UUID id);

    /**
     * 여러 유저의 활성 채택 태그를 한 번에 조회 (GROMO-1565, BotSimulator 가 봇 190명분을 매 tick 읽는다).
     * defaultTag 를 fetch 하지 않는 이유: 호출측이 태그 id 만 쓰고 이름을 읽지 않는다.
     * ORDER BY ut.id — 스케줄 생성이 이 순서에 의존하므로(과목 인덱스) 조회마다 흔들리면 안 된다.
     */
    @Query("SELECT ut FROM UserFocusTag ut "
            + "WHERE ut.user.id IN :userIds AND ut.deletedAt IS NULL ORDER BY ut.id")
    List<UserFocusTag> findActiveByUserIdIn(@Param("userIds") Collection<UUID> userIds);

    /**
     * 중복 채택 방지 — (user, defaultTag) 활성 채택 존재 여부 확인
     */
    Optional<UserFocusTag> findByUserAndDefaultTagAndDeletedAtIsNull(User user, DefaultTag defaultTag);
}
