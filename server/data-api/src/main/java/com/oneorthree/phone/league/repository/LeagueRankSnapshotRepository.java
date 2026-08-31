package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.repository.domain.LeagueRankSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/** 일간 전역 순위 스냅샷을 날짜 단위로 일괄 조회하고 저장한다. */
public interface LeagueRankSnapshotRepository extends JpaRepository<LeagueRankSnapshot, UUID> {

    List<LeagueRankSnapshot> findByCreatedAt(LocalDate createdAt);

    List<LeagueRankSnapshot> findByCreatedAtAndUserIdIn(LocalDate createdAt, Collection<UUID> userIds);

    @Query("SELECT COALESCE(MAX(snapshot.rank), 0) FROM LeagueRankSnapshot snapshot "
            + "WHERE snapshot.createdAt = :createdAt")
    int findMaximumRankByCreatedAt(LocalDate createdAt);
}
