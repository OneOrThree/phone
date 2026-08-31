package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.league.repository.domain.LeagueRankSnapshot;
import com.oneorthree.phone.league.repository.LeagueRankSnapshotUpsertRepository.SnapshotRank;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class LeagueRankSnapshotUpsertRepositoryTest extends RepositoryTestBase {

    @Autowired
    LeagueRankSnapshotUpsertRepository upsertRepository;
    @Autowired
    LeagueRankSnapshotRepository snapshotRepository;

    @Test
    @DisplayName("동일 user snapshot은 PostgreSQL ON CONFLICT로 중복 없이 순위를 갱신한다")
    void atomicallyUpsertsSameUserAndDay() {
        LocalDate today = LocalDate.of(2026, 7, 6);
        UUID userId = UUID.randomUUID();

        upsertRepository.upsertAll(today, List.of(new SnapshotRank(userId, 3)));
        upsertRepository.upsertAll(today, List.of(new SnapshotRank(userId, 1)));

        assertThat(snapshotRepository.findByCreatedAt(today))
                .singleElement()
                .extracting(LeagueRankSnapshot::getUserId, LeagueRankSnapshot::getRank)
                .containsExactly(userId, 1);
    }
}
