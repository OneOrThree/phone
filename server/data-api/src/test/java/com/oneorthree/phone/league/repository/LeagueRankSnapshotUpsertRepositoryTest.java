package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.league.repository.domain.LeagueRankSnapshot;
import com.oneorthree.phone.league.repository.LeagueRankSnapshotUpsertRepository.SnapshotRank;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * upsert 는 자기 READ COMMITTED 트랜잭션에서 users 를 잠그고 쓴다(GROMO-1944) — 테스트 트랜잭션 안에 심은 사용자는
 * 그 트랜잭션에서 보이지 않으므로 이 클래스는 테스트 트랜잭션을 쓰지 않고 커밋된 사용자를 심는다.
 */
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class LeagueRankSnapshotUpsertRepositoryTest extends RepositoryTestBase {

    @Autowired
    LeagueRankSnapshotUpsertRepository upsertRepository;
    @Autowired
    LeagueRankSnapshotRepository snapshotRepository;
    @Autowired
    UserRepository userRepository;

    @Test
    @DisplayName("동일 user snapshot은 PostgreSQL ON CONFLICT로 중복 없이 순위를 갱신한다")
    void atomicallyUpsertsSameUserAndDay() {
        LocalDate today = LocalDate.of(2026, 7, 6);
        UUID userId = user(false);

        upsertRepository.upsertAll(today, List.of(new SnapshotRank(userId, 3)));
        upsertRepository.upsertAll(today, List.of(new SnapshotRank(userId, 1)));

        assertThat(snapshotRepository.findByCreatedAtAndUserIdIn(today, List.of(userId)))
                .singleElement()
                .extracting(LeagueRankSnapshot::getUserId, LeagueRankSnapshot::getRank)
                .containsExactly(userId, 1);
    }

    @Test
    @DisplayName("탈퇴·부재 사용자의 줄은 쓰지 않고 같은 묶음의 활성 사용자만 쓴다")
    void skipsWithdrawnAndMissingUsers() {
        LocalDate today = LocalDate.of(2026, 7, 7);
        UUID active = user(false);
        UUID withdrawn = user(true);
        UUID missing = UUID.randomUUID();

        upsertRepository.upsertAll(today, List.of(new SnapshotRank(withdrawn, 1), new SnapshotRank(active, 2),
                new SnapshotRank(missing, 3)));

        assertThat(snapshotRepository.findByCreatedAtAndUserIdIn(today, List.of(active, withdrawn, missing)))
                .singleElement()
                .extracting(LeagueRankSnapshot::getUserId)
                .isEqualTo(active);
    }

    private UUID user(boolean deleted) {
        return userRepository.save(User.builder().isDeleted(deleted).build()).getId();
    }
}
