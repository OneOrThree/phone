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

    /**
     * @param createdAt 스냅샷을 뜬 날짜(KST 축). 하루 단위 단일 값이라 기간 조회가 아니다
     * @return 그날 스냅샷 전부. 그날 스냅샷을 뜬 적이 없으면 빈 리스트
     */
    List<LeagueRankSnapshot> findByCreatedAt(LocalDate createdAt);

    /**
     * @param createdAt 스냅샷을 뜬 날짜(KST 축)
     * @param userIds   순위를 알고 싶은 유저들. 빈 컬렉션을 넘기면 항상 빈 결과다
     * @return 그날 스냅샷 중 지정 유저의 행만. 그날 집중 이력이 없어 스냅샷에 안 든 유저는 빠지므로,
     *         요청한 수보다 적게 돌아올 수 있다
     */
    List<LeagueRankSnapshot> findByCreatedAtAndUserIdIn(LocalDate createdAt, Collection<UUID> userIds);

    /**
     * 그날 스냅샷의 꼴찌 순위 = 순위가 매겨진 인원 수. 미순위 유저에게 "몇 명 중 몇 등"의 분모를 줄 때 쓴다.
     *
     * @param createdAt 스냅샷을 뜬 날짜(KST 축)
     * @return 최대 rank. 그날 스냅샷이 없으면 null 이 아니라 0 이라, 호출측에 null 검사를 강요하지 않는다
     */
    @Query("SELECT COALESCE(MAX(snapshot.rank), 0) FROM LeagueRankSnapshot snapshot "
            + "WHERE snapshot.createdAt = :createdAt")
    int findMaximumRankByCreatedAt(LocalDate createdAt);
}
