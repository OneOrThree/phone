package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.SeaRemark;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.UUID;

/** 바다 한마디 저장소 (GROMO-2299). */
public interface SeaRemarkRepository extends JpaRepository<SeaRemark, UUID> {

    /** 탈퇴 파기 — 사용자 행이 익명화만 되어 FK 연쇄 삭제가 돌지 않는다. */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM SeaRemark r WHERE r.userId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);
}
