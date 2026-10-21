package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.IslandNews;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/** 섬 소식 (GROMO-2267, V116). */
public interface IslandNewsRepository extends JpaRepository<IslandNews, UUID> {

    /** 최신순 — 같은 시각이면 UUID v7(시간 정렬)이 큰 쪽이 먼저다. {@code (island_id, created_at DESC)} 인덱스를 탄다. */
    List<IslandNews> findByIslandIdOrderByCreatedAtDescIdDesc(UUID islandId, Pageable pageable);
}
