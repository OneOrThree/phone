package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class LeagueArenaUserRepositoryTest extends RepositoryTestBase {

    private static final int FOURTEEN_HOURS_IN_SECONDS = 14 * 60 * 60;

    @Autowired
    LeagueArenaUserRepository leagueArenaUserRepository;
    @Autowired
    LeagueArenaRepository leagueArenaRepository;
    @Autowired
    LeagueTierConfigRepository leagueTierConfigRepository;
    @Autowired
    UserRepository userRepository;

    private LeagueTierConfig saveTierConfig(int level) {
        return leagueTierConfigRepository.save(LeagueTierConfig.builder()
                .tierLevel(level).arenaSize(30).promoteCount(10).relegateCount(5).relegateWarningCount(3)
                .badgeId("tier-" + level)
                .promotionTime(level * FOURTEEN_HOURS_IN_SECONDS)
                .relegationTime((level - 1) * FOURTEEN_HOURS_IN_SECONDS)
                .build());
    }

    private LeagueArena saveArena(LeagueTierConfig cfg, LeagueArenaStatus status) {
        return leagueArenaRepository.save(LeagueArena.builder()
                .tierConfig(cfg).startedAt(Instant.parse("2026-06-22T00:00:00Z")).status(status).build());
    }

    private User saveUser(String nickname) {
        return userRepository.save(User.builder().nickname(nickname).build());
    }

    private User saveUserWithOccupation(String nickname, Occupation occupation) {
        return userRepository.save(User.builder().nickname(nickname)
                .occupation(occupation).build());
    }

    private LeagueArenaUser saveMember(LeagueArena arena, User user, int focusSeconds) {
        return leagueArenaUserRepository.save(LeagueArenaUser.builder()
                .user(user).leagueArena(arena).tierLevel(arena.getTierConfig().getTierLevel())
                .totalFocusSeconds(focusSeconds).build());
    }

    @Test
    @DisplayName("findByUserAndArenaStatus — 유저의 ACTIVE 아레나 멤버십만 반환, ENDED는 제외")
    void findByUserAndArenaStatus_onlyActive() {
        LeagueTierConfig cfg = saveTierConfig(3);
        LeagueArena active = saveArena(cfg, LeagueArenaStatus.ACTIVE);
        LeagueArena ended = saveArena(cfg, LeagueArenaStatus.ENDED);
        User u1 = saveUser("u1");
        User u2 = saveUser("u2");
        saveMember(active, u1, 100);
        saveMember(ended, u2, 100);
        leagueArenaUserRepository.flush();

        Optional<LeagueArenaUser> mine =
                leagueArenaUserRepository.findByUserAndArenaStatus(u1.getId(), LeagueArenaStatus.ACTIVE);
        assertThat(mine).isPresent();
        assertThat(mine.get().getLeagueArena().getId()).isEqualTo(active.getId());

        // ENDED 아레나에만 있는 유저는 ACTIVE 조회 시 없음
        assertThat(leagueArenaUserRepository.findByUserAndArenaStatus(u2.getId(), LeagueArenaStatus.ACTIVE))
                .isEmpty();
    }

    @Test
    @DisplayName("findByUserIdInAndArenaStatus — 여러 유저의 ACTIVE 멤버십만 배치 반환, ENDED·미소속 제외 (GROMO-710)")
    void findByUserIdInAndArenaStatus_batchOnlyActive() {
        LeagueTierConfig cfg = saveTierConfig(3);
        LeagueArena active = saveArena(cfg, LeagueArenaStatus.ACTIVE);
        LeagueArena ended = saveArena(cfg, LeagueArenaStatus.ENDED);
        User activeUser = saveUser("activeUser");   // ACTIVE 멤버십 → 포함
        User endedUser = saveUser("endedUser");     // ENDED 멤버십만 → 제외
        User noMembership = saveUser("noMembership"); // 아레나 미소속 → 제외
        saveMember(active, activeUser, 100);
        saveMember(ended, endedUser, 100);
        leagueArenaUserRepository.flush();

        List<LeagueArenaUser> result = leagueArenaUserRepository.findByUserIdInAndArenaStatus(
                List.of(activeUser.getId(), endedUser.getId(), noMembership.getId()),
                LeagueArenaStatus.ACTIVE);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getUser().getId()).isEqualTo(activeUser.getId());
        assertThat(result.get(0).getTierLevel()).isEqualTo(3);
    }

    @Test
    @DisplayName("findRankedByArena — totalFocusSeconds 내림차순 정렬, 해당 아레나 멤버만, 닉네임 fetch")
    void findRankedByArena_orderedDesc() {
        LeagueTierConfig cfg = saveTierConfig(3);
        LeagueArena arena = saveArena(cfg, LeagueArenaStatus.ACTIVE);
        LeagueArena other = saveArena(cfg, LeagueArenaStatus.ACTIVE);
        saveMember(arena, saveUser("mid"), 200);
        saveMember(arena, saveUser("top"), 300);
        saveMember(arena, saveUser("low"), 100);
        saveMember(other, saveUser("other"), 999);
        leagueArenaUserRepository.flush();

        List<LeagueArenaUser> ranked = leagueArenaUserRepository.findRankedByArena(arena);

        assertThat(ranked).hasSize(3);
        assertThat(ranked).extracting(m -> m.getUser().getNickname())
                .containsExactly("top", "mid", "low");
    }

    @Test
    @DisplayName("findRankedByActiveArenasAndOccupation — 같은 occupation 전역 집계, 다른 아레나 포함, ENDED 제외")
    void findRankedByActiveArenasAndOccupation_crossArenaAndExcludesEnded() {
        LeagueTierConfig cfg = saveTierConfig(3);
        LeagueArena activeA = saveArena(cfg, LeagueArenaStatus.ACTIVE);
        LeagueArena activeB = saveArena(cfg, LeagueArenaStatus.ACTIVE);
        LeagueArena ended = saveArena(cfg, LeagueArenaStatus.ENDED);

        // ACTIVE 아레나 A — 노무사 2명, 다른 occupation 1명
        User lawyerA1 = saveUserWithOccupation("lawyerA1", Occupation.LABOR_ATTORNEY);
        User lawyerA2 = saveUserWithOccupation("lawyerA2", Occupation.LABOR_ATTORNEY);
        User university = saveUserWithOccupation("university", Occupation.UNIVERSITY);
        saveMember(activeA, lawyerA1, 300);
        saveMember(activeA, lawyerA2, 100);
        saveMember(activeA, university, 999);

        // ACTIVE 아레나 B — 다른 아레나에 있는 노무사 1명 (전역 집계에 포함돼야 함)
        User lawyerB = saveUserWithOccupation("lawyerB", Occupation.LABOR_ATTORNEY);
        saveMember(activeB, lawyerB, 200);

        // ENDED 아레나 — 노무사 (집계에서 제외돼야 함)
        User lawyerEnded = saveUserWithOccupation("lawyerEnded", Occupation.LABOR_ATTORNEY);
        saveMember(ended, lawyerEnded, 9999);

        leagueArenaUserRepository.flush();

        List<LeagueArenaUser> ranked = leagueArenaUserRepository
                .findRankedByActiveArenasAndOccupation(Occupation.LABOR_ATTORNEY, PageRequest.of(0, 100));

        // 노무사만 3명(ACTIVE 아레나 전체), ENDED 제외, totalFocusSeconds 내림차순
        assertThat(ranked).hasSize(3);
        assertThat(ranked).extracting(m -> m.getUser().getNickname())
                .containsExactly("lawyerA1", "lawyerB", "lawyerA2");
        // UNIVERSITY 유저 미포함
        assertThat(ranked).noneMatch(m -> m.getUser().getNickname().equals("university"));
        // ENDED 아레나 유저 미포함
        assertThat(ranked).noneMatch(m -> m.getUser().getNickname().equals("lawyerEnded"));
    }

    @Test
    @DisplayName("findRankedByActiveArenasAndOccupation — Pageable 제한 적용")
    void findRankedByActiveArenasAndOccupation_pageLimitApplied() {
        LeagueTierConfig cfg = saveTierConfig(3);
        LeagueArena arena = saveArena(cfg, LeagueArenaStatus.ACTIVE);
        User u1 = saveUserWithOccupation("u1", Occupation.UNIVERSITY);
        User u2 = saveUserWithOccupation("u2", Occupation.UNIVERSITY);
        User u3 = saveUserWithOccupation("u3", Occupation.UNIVERSITY);
        saveMember(arena, u1, 300);
        saveMember(arena, u2, 200);
        saveMember(arena, u3, 100);
        leagueArenaUserRepository.flush();

        // 상위 2명만 요청
        List<LeagueArenaUser> ranked = leagueArenaUserRepository
                .findRankedByActiveArenasAndOccupation(Occupation.UNIVERSITY, PageRequest.of(0, 2));

        assertThat(ranked).hasSize(2);
        assertThat(ranked.get(0).getUser().getNickname()).isEqualTo("u1");
        assertThat(ranked.get(1).getUser().getNickname()).isEqualTo("u2");
    }

    @Test
    @DisplayName("findRankedByActiveArenas — 직군 무관 전역 집계, 다른 아레나 포함, ENDED 제외, 내림차순")
    void findRankedByActiveArenas_crossArenaExcludesEnded() {
        LeagueTierConfig cfg = saveTierConfig(3);
        LeagueArena activeA = saveArena(cfg, LeagueArenaStatus.ACTIVE);
        LeagueArena activeB = saveArena(cfg, LeagueArenaStatus.ACTIVE);
        LeagueArena ended = saveArena(cfg, LeagueArenaStatus.ENDED);

        // 직군이 서로 달라도 전부 집계돼야 한다
        saveMember(activeA, saveUserWithOccupation("lawyer", Occupation.LABOR_ATTORNEY), 300);
        saveMember(activeA, saveUserWithOccupation("univ", Occupation.UNIVERSITY), 100);
        saveMember(activeB, saveUser("noOccupation"), 200);
        // ENDED 아레나는 제외
        saveMember(ended, saveUser("endedUser"), 9999);
        leagueArenaUserRepository.flush();

        List<LeagueArenaUser> ranked =
                leagueArenaUserRepository.findRankedByActiveArenas(PageRequest.of(0, 100));

        assertThat(ranked).hasSize(3);
        assertThat(ranked).extracting(m -> m.getUser().getNickname())
                .containsExactly("lawyer", "noOccupation", "univ");
        assertThat(ranked).noneMatch(m -> m.getUser().getNickname().equals("endedUser"));
    }

    @Test
    @DisplayName("findRankedByActiveArenas — Pageable 상한 적용")
    void findRankedByActiveArenas_pageLimitApplied() {
        LeagueTierConfig cfg = saveTierConfig(3);
        LeagueArena arena = saveArena(cfg, LeagueArenaStatus.ACTIVE);
        saveMember(arena, saveUser("a"), 300);
        saveMember(arena, saveUser("b"), 200);
        saveMember(arena, saveUser("c"), 100);
        leagueArenaUserRepository.flush();

        List<LeagueArenaUser> ranked =
                leagueArenaUserRepository.findRankedByActiveArenas(PageRequest.of(0, 2));

        assertThat(ranked).hasSize(2);
        assertThat(ranked.get(0).getUser().getNickname()).isEqualTo("a");
        assertThat(ranked.get(1).getUser().getNickname()).isEqualTo("b");
    }

    @Test
    @DisplayName("findRankedByArena — 동점은 id 오름차순으로 순위 결정(결정적 정렬)")
    void findRankedByArena_tieBreakById() {
        LeagueTierConfig cfg = saveTierConfig(3);
        LeagueArena arena = saveArena(cfg, LeagueArenaStatus.ACTIVE);
        // 동일 focusSeconds 면 id 오름차순으로 결정적 정렬돼야 한다.
        // (UUID v7 는 같은 밀리초 내 생성 시 랜덤 꼬리로 순서가 갈려 저장 순서 != id 순서일 수 있으므로
        //  저장 순서를 가정하지 않고, 실제 id 를 정렬한 기대값과 비교한다.)
        LeagueArenaUser a = saveMember(arena, saveUser("a"), 150);
        LeagueArenaUser b = saveMember(arena, saveUser("b"), 150);
        leagueArenaUserRepository.flush();
        List<UUID> expectedOrder = Stream.of(a.getId(), b.getId()).sorted().toList();

        List<LeagueArenaUser> ranked = leagueArenaUserRepository.findRankedByArena(arena);

        assertThat(ranked).extracting(LeagueArenaUser::getId)
                .containsExactlyElementsOf(expectedOrder);
    }
}
