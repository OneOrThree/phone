package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.league.repository.domain.LeagueArena;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LeagueArenaRepositoryTest extends RepositoryTestBase {

    @Autowired
    LeagueArenaRepository leagueArenaRepository;

    @Test
    @DisplayName("동일 주차 anchor는 DB unique 제약으로 동시 중복 생성을 차단한다")
    void rejectsDuplicateStartedAt() {
        Instant startedAt = Instant.parse("2026-07-12T15:00:00Z");
        leagueArenaRepository.saveAndFlush(LeagueArena.builder().startedAt(startedAt).build());

        assertThatThrownBy(() -> leagueArenaRepository.saveAndFlush(
                LeagueArena.builder().startedAt(startedAt).build()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
