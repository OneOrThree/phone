package com.oneorthree.phone.quest.repository;

import com.oneorthree.phone.quest.repository.domain.IslandQuest;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface IslandQuestRepository extends JpaRepository<IslandQuest, UUID> {

    /**
     * 그 날짜 회차가 아직 없는 퀘스트 id — 회차 개설 스케줄러의 후보다. 섬 생존·잠금 아래 재검사는
     * 개설 트랜잭션이 한다(여기서 읽은 목록은 잠금 전 스냅샷).
     */
    @Query("SELECT q.id FROM IslandQuest q WHERE NOT EXISTS (SELECT 1 FROM IslandQuestOccurrence o "
            + "WHERE o.questId = q.id AND o.occurrenceDate = :date)")
    List<UUID> findIdsWithoutOccurrenceOn(@Param("date") LocalDate date);

    /**
     * 퀘스트의 섬 — 회차 개설은 섬 잠금 <b>뒤에</b> 정의를 읽어야 해서 섬 id 를 잠그기 전에 먼저 안다.
     * 엔티티가 아니라 스칼라로 읽는 것이 핵심이다: {@code findById} 로 먼저 읽으면 그 인스턴스가 영속성
     * 컨텍스트에 남아 잠금 뒤 다시 읽어도 <b>잠금 전 스냅샷</b>(그 사이 커밋된 수정 이전 정의)을 돌려준다.
     */
    @Query("SELECT q.islandId FROM IslandQuest q WHERE q.id = :id")
    Optional<UUID> findIslandIdById(@Param("id") UUID id);

    /**
     * 계정 탈퇴 파기 (GROMO-1952, 계정 LLD §4) — 퀘스트 정의는 섬 자산이라 남기고 만든 방장 연결만 끊는다.
     * 이후 회차 개설은 작성자가 없으면 시스템 주체를 쓴다({@code IslandQuestService#openTodayIfMissing}).
     * 엔티티의 created_by 가 {@code updatable = false} 라 네이티브로 쓴다.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE island_quests SET created_by = NULL WHERE created_by = :userId", nativeQuery = true)
    int detachCreator(@Param("userId") UUID userId);
}
