package com.oneorthree.phone.magazine.repository;

import com.oneorthree.phone.magazine.repository.domain.MagazineIssue;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 고양이 잡지 호 (GROMO-2289, V120). */
public interface MagazineIssueRepository extends JpaRepository<MagazineIssue, UUID> {

    boolean existsByIssueDate(LocalDate issueDate);

    /** 지금까지의 마지막 호수 — 호가 없으면 0. 다음 호수는 이 값 + 1 이다({@code issue_no} 유일이 겹침을 막는다). */
    @Query("SELECT COALESCE(MAX(i.issueNo), 0) FROM MagazineIssue i")
    int maxIssueNo();

    /** 최근 7호 — 최신 호가 먼저다. 지난 호 보관 범위(MAG-07)이자 «오늘 호» 판정의 기준이다. */
    List<MagazineIssue> findTop7ByOrderByIssueNoDesc();

    /** 가장 최근 호 — 현재 호 판정(망원경 칸 미리보기)의 기준이다. */
    Optional<MagazineIssue> findFirstByOrderByIssueNoDesc();

    /** 그날 호 — 알림 펼치기 대상 조회용(GROMO-2307). */
    Optional<MagazineIssue> findByIssueDate(LocalDate issueDate);

    /**
     * 알림 펼치기 완료 표시(GROMO-2307) — 처음 한 번만 쓴다. 엔티티 필드가 쓰기 불가라 갱신 쿼리로만 바꾼다.
     *
     * @return 1 = 이번 호출이 표시했다, 0 = 이미 표시돼 있다
     */
    @Modifying
    @Query("UPDATE MagazineIssue i SET i.notifiedAt = :now WHERE i.id = :id AND i.notifiedAt IS NULL")
    int markNotified(@Param("id") UUID id, @Param("now") Instant now);
}
