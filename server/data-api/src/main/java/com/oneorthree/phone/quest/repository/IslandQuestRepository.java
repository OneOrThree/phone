package com.oneorthree.phone.quest.repository;

import com.oneorthree.phone.quest.repository.domain.IslandQuest;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public interface IslandQuestRepository extends JpaRepository<IslandQuest, UUID> {

    /**
     * 그 날짜 회차가 아직 없는 퀘스트 id — 회차 개설 스케줄러의 후보다. 섬 생존·잠금 아래 재검사는
     * 개설 트랜잭션이 한다(여기서 읽은 목록은 잠금 전 스냅샷).
     */
    @Query("SELECT q.id FROM IslandQuest q WHERE NOT EXISTS (SELECT 1 FROM IslandQuestOccurrence o "
            + "WHERE o.questId = q.id AND o.occurrenceDate = :date)")
    List<UUID> findIdsWithoutOccurrenceOn(@Param("date") LocalDate date);
}
