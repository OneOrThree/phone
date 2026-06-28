package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaMember;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class LeagueArenaMemberRepositoryTest extends RepositoryTestBase {

    @Autowired
    LeagueArenaMemberRepository leagueArenaMemberRepository;
    @Autowired
    LeagueArenaRepository leagueArenaRepository;
    @Autowired
    LeagueTierConfigRepository leagueTierConfigRepository;
    @Autowired
    UserRepository userRepository;

    private LeagueTierConfig saveTierConfig(int level) {
        return leagueTierConfigRepository.save(LeagueTierConfig.builder()
                .tierLevel(level).arenaSize(30).promoteCount(10).relegateCount(5).relegateWarningCount(3).build());
    }

    private LeagueArena saveArena(LeagueTierConfig cfg, LeagueArenaStatus status) {
        return leagueArenaRepository.save(LeagueArena.builder()
                .tierConfig(cfg).weekStartAt(Instant.parse("2026-06-22T00:00:00Z")).status(status).build());
    }

    private User saveUser(String nickname) {
        return userRepository.save(User.builder().nickname(nickname).currentTier(1).build());
    }

    private LeagueArenaMember saveMember(LeagueArena arena, User user, int focusMinutes) {
        return leagueArenaMemberRepository.save(LeagueArenaMember.builder()
                .user(user).leagueArena(arena).tierLevel(arena.getTierConfig().getTierLevel())
                .totalFocusMinutes(focusMinutes).build());
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
        leagueArenaMemberRepository.flush();

        Optional<LeagueArenaMember> mine =
                leagueArenaMemberRepository.findByUserAndArenaStatus(u1.getId(), LeagueArenaStatus.ACTIVE);
        assertThat(mine).isPresent();
        assertThat(mine.get().getLeagueArena().getId()).isEqualTo(active.getId());

        // ENDED 아레나에만 있는 유저는 ACTIVE 조회 시 없음
        assertThat(leagueArenaMemberRepository.findByUserAndArenaStatus(u2.getId(), LeagueArenaStatus.ACTIVE))
                .isEmpty();
    }

    @Test
    @DisplayName("findRankedByArena — totalFocusMinutes 내림차순 정렬, 해당 아레나 멤버만, 닉네임 fetch")
    void findRankedByArena_orderedDesc() {
        LeagueTierConfig cfg = saveTierConfig(3);
        LeagueArena arena = saveArena(cfg, LeagueArenaStatus.ACTIVE);
        LeagueArena other = saveArena(cfg, LeagueArenaStatus.ACTIVE);
        saveMember(arena, saveUser("mid"), 200);
        saveMember(arena, saveUser("top"), 300);
        saveMember(arena, saveUser("low"), 100);
        saveMember(other, saveUser("other"), 999);
        leagueArenaMemberRepository.flush();

        List<LeagueArenaMember> ranked = leagueArenaMemberRepository.findRankedByArena(arena);

        assertThat(ranked).hasSize(3);
        assertThat(ranked).extracting(m -> m.getUser().getNickname())
                .containsExactly("top", "mid", "low");
    }

    @Test
    @DisplayName("findRankedByArena — 동점은 id 오름차순으로 순위 결정(결정적 정렬)")
    void findRankedByArena_tieBreakById() {
        LeagueTierConfig cfg = saveTierConfig(3);
        LeagueArena arena = saveArena(cfg, LeagueArenaStatus.ACTIVE);
        // 동일 focusMinutes 면 id 오름차순으로 결정적 정렬돼야 한다.
        // (UUID v7 는 같은 밀리초 내 생성 시 랜덤 꼬리로 순서가 갈려 저장 순서 != id 순서일 수 있으므로
        //  저장 순서를 가정하지 않고, 실제 id 를 정렬한 기대값과 비교한다.)
        LeagueArenaMember a = saveMember(arena, saveUser("a"), 150);
        LeagueArenaMember b = saveMember(arena, saveUser("b"), 150);
        leagueArenaMemberRepository.flush();
        List<UUID> expectedOrder = Stream.of(a.getId(), b.getId()).sorted().toList();

        List<LeagueArenaMember> ranked = leagueArenaMemberRepository.findRankedByArena(arena);

        assertThat(ranked).extracting(LeagueArenaMember::getId)
                .containsExactlyElementsOf(expectedOrder);
    }
}
