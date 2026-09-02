package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.currency.repository.domain.CurrencyTransaction;
import com.oneorthree.phone.currency.repository.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupBetVoidReason;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 내기 2계층 스키마(GROMO-1262)의 실 SQL 제약 검증 — 애플리케이션 가드가 뚫려도 DB 가 막아야
 * 하는 지점들: 회차 유니크(bet_id, session_date)·참가 유니크(session_id, user_id)·설정 유니크
 * (challenge_id)·멱등키 유니크·정산 CAS.
 *
 * <p><b>ci 프로파일 주의</b>: 스키마는 Flyway 가 아니라 엔티티 create-drop 으로 만들어진다
 * ({@code application-ci.yml}). 유니크 제약은 엔티티에 선언돼 있어 그대로 생성되지만 V40 stake
 * CHECK 등 마이그레이션 전용 제약의 검증은 V39~V41 마이그레이션 테스트가 Flyway 체인으로 맡는다.
 */
class GroupChallengeBetRepositoryTest extends RepositoryTestBase {

    private static final String MIGRATION_PATH = "db/migration/V22__currency_transaction_reward_types.sql";

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    @Autowired
    GroupChallengeBetRepository groupChallengeBetRepository;
    @Autowired
    GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @Autowired
    GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    CurrencyTransactionRepository currencyTransactionRepository;
    @Autowired
    JdbcTemplate jdbcTemplate;

    private Group group;
    private GroupChallenge challenge;
    private GroupChallengeBet config;
    private User user;

    private final LocalDate sessionDate = LocalDate.of(2026, 7, 31);

    @BeforeEach
    void setUp() {
        group = groupRepository.saveAndFlush(Group.builder().name("스터디").build());
        challenge = groupChallengeRepository.saveAndFlush(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .build());
        config = configOf(challenge);
        user = userRepository.saveAndFlush(User.builder().nickname("재영").isGuest(false).build());
    }

    private GroupChallengeBet configOf(GroupChallenge target) {
        return groupChallengeBetRepository.saveAndFlush(GroupChallengeBet.builder()
                .group(group)
                .challenge(target)
                .stake(30)
                .enabled(true)
                .build());
    }

    private GroupChallengeBetSession sessionOf(LocalDate date) {
        return sessionOf(config, date, GroupBetStatus.OPEN);
    }

    private GroupChallengeBetSession sessionOf(GroupChallengeBet target, LocalDate date, GroupBetStatus status) {
        Instant closesAt = date.plusDays(1).atStartOfDay(KST).toInstant();
        return groupChallengeBetSessionRepository.saveAndFlush(GroupChallengeBetSession.builder()
                .bet(target)
                .group(target.getGroup())
                .challenge(target.getChallenge())
                .sessionDate(date)
                .stake(target.getStake())
                .goalMinutes(120)
                .missionCategory(target.getChallenge().getCategory())
                .missionType(target.getChallenge().getType())
                .status(status)
                .startsAt(date.atStartOfDay(KST).toInstant())
                .joinClosesAt(closesAt)
                .closesAt(closesAt)
                .settleAfter(closesAt)
                .build());
    }

    private GroupChallengeBet anotherConfig() {
        return configOf(groupChallengeRepository.saveAndFlush(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .build()));
    }

    // ── 2계층 유니크 제약 ────────────────────────────────────────────────

    @Test
    @DisplayName("UNIQUE (challenge_id) — 챌린지당 설정 1개는 DB 가 막는다(동시 개설 레이스 최후 방어)")
    void rejectsDuplicateConfigForSameChallenge() {
        assertThatThrownBy(() -> groupChallengeBetRepository.saveAndFlush(GroupChallengeBet.builder()
                .group(group)
                .challenge(challenge)
                .stake(50)
                .enabled(true)
                .build()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("UNIQUE (bet_id, session_date) — 하루 1회차는 DB 가 막는다(구 FR-7 부분 유니크의 대체)")
    void rejectsDuplicateSessionForSameDate() {
        sessionOf(sessionDate);

        assertThatThrownBy(() -> sessionOf(config, sessionDate, GroupBetStatus.OPEN))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("날짜가 다르면 같은 설정이라도 회차를 각각 열 수 있다")
    void allowsSessionsOnDifferentDatesForSameConfig() {
        sessionOf(sessionDate);
        sessionOf(config, sessionDate.plusDays(1), GroupBetStatus.OPEN);

        assertThat(groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                List.of(challenge.getId()), sessionDate, GroupBetStatus.UNUSED)).hasSize(1);
    }

    @Test
    @DisplayName("날짜 배치 로드 — UNUSED(0명 종료)만 빠지고 정산 결과(SETTLED 등)는 실린다 (hadBet 보호, N52)")
    void findByDateExcludesOnlyUnused() {
        GroupChallengeBet unusedOnly = anotherConfig();
        GroupChallengeBet settledOnly = anotherConfig();
        GroupChallengeBetSession open = sessionOf(sessionDate);
        sessionOf(unusedOnly, sessionDate, GroupBetStatus.UNUSED);
        GroupChallengeBetSession settled = sessionOf(settledOnly, sessionDate, GroupBetStatus.SETTLED);

        List<GroupChallengeBetSession> found = groupChallengeBetSessionRepository
                .findByChallengeIdInAndSessionDateAndStatusNot(
                        List.of(challenge.getId(), unusedOnly.getChallenge().getId(),
                                settledOnly.getChallenge().getId()),
                        sessionDate, GroupBetStatus.UNUSED);

        assertThat(found)
                .extracting(GroupChallengeBetSession::getId)
                .containsExactlyInAnyOrder(open.getId(), settled.getId());
    }

    @Test
    @DisplayName("내기 이력 챌린지 조회 — 설정이 있으면 잡힌다(휴면 배지), 설정 없는 챌린지는 빠진다")
    void findChallengeIdsWithAnyBetMatchesConfigPresence() {
        GroupChallenge fresh = groupChallengeRepository.saveAndFlush(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.SCREEN_TIME)
                .type(MissionType.DURATION)
                .build());
        GroupChallengeBet other = anotherConfig();

        List<UUID> found = groupChallengeBetRepository.findChallengeIdsWithAnyBet(
                List.of(challenge.getId(), other.getChallenge().getId(), fresh.getId()));

        assertThat(found).containsExactlyInAnyOrder(challenge.getId(), other.getChallenge().getId());
    }

    @Test
    @DisplayName("OPEN 보유 챌린지 조회 — 날짜 무관 status 기반이라 내일 회차도 잡히고, 정산만 남은 챌린지는 빠진다")
    void findChallengeIdsWithOpenBetIsDateAgnostic() {
        GroupChallengeBet settledOnly = anotherConfig();
        // 내일 날짜 OPEN — 요청 date 스코프와 무관하게 "지금 걸린 판"으로 잡혀야 휴면 오판이 없다.
        sessionOf(config, sessionDate.plusDays(1), GroupBetStatus.OPEN);
        sessionOf(settledOnly, sessionDate, GroupBetStatus.SETTLED);

        List<UUID> found = groupChallengeBetRepository.findChallengeIdsWithOpenBet(
                List.of(challenge.getId(), settledOnly.getChallenge().getId()));

        assertThat(found).containsExactly(challenge.getId());
    }

    @Test
    @DisplayName("(session_id, user_id) 유니크 — 같은 회차에 같은 유저 2번 참가는 DB 가 막는다(동시 참가 레이스 최후 방어)")
    void rejectsDuplicateParticipant() {
        GroupChallengeBetSession session = sessionOf(sessionDate);
        groupChallengeBetParticipantRepository.saveAndFlush(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());

        assertThatThrownBy(() -> groupChallengeBetParticipantRepository.saveAndFlush(
                GroupChallengeBetParticipant.builder().session(session).user(user).build()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("idempotency_key 유니크 — 같은 멱등키 재기입은 DB 가 막는다(정산 재실행 이중 지급 차단)")
    void rejectsDuplicateIdempotencyKey() {
        String key = "session:" + UUID.randomUUID() + ":payout:" + UUID.randomUUID();
        currencyTransactionRepository.saveAndFlush(CurrencyTransaction.builder()
                .user(user).amount(45).type(CurrencyTransactionType.BET_PAYOUT).idempotencyKey(key).build());

        assertThatThrownBy(() -> currencyTransactionRepository.saveAndFlush(CurrencyTransaction.builder()
                .user(user).amount(45).type(CurrencyTransactionType.BET_PAYOUT).idempotencyKey(key).build()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("멱등키가 null 인 기존 경로(세션 적립 등)는 여러 건이어도 유니크에 걸리지 않는다")
    void allowsMultipleNullIdempotencyKeys() {
        currencyTransactionRepository.saveAndFlush(CurrencyTransaction.builder()
                .user(user).amount(10).type(CurrencyTransactionType.SESSION_COMPLETE).build());
        currencyTransactionRepository.saveAndFlush(CurrencyTransaction.builder()
                .user(user).amount(10).type(CurrencyTransactionType.SESSION_COMPLETE).build());

        assertThat(currencyTransactionRepository.existsByIdempotencyKey("session:none")).isFalse();
    }

    // ── 챌린지별 최신 정산 1건 (DISTINCT ON) ─────────────────────────────

    @Test
    @DisplayName("최신 정산 조회 — 챌린지당 1행만, 그것도 session_date 가 가장 큰 행이 온다")
    void latestSettledReturnsExactlyOneRowPerChallenge() {
        GroupChallengeBet other = anotherConfig();
        sessionOf(config, sessionDate.minusDays(2), GroupBetStatus.SETTLED);
        GroupChallengeBetSession newest =
                sessionOf(config, sessionDate.minusDays(1), GroupBetStatus.REFUNDED);
        GroupChallengeBetSession otherOnly =
                sessionOf(other, sessionDate.minusDays(5), GroupBetStatus.SETTLED);

        List<GroupChallengeBetSession> found = groupChallengeBetSessionRepository
                .findLatestSettledByChallengeIds(
                        List.of(challenge.getId(), other.getChallenge().getId()));

        assertThat(found)
                .extracting(GroupChallengeBetSession::getId)
                .containsExactlyInAnyOrder(newest.getId(), otherOnly.getId());
    }

    @Test
    @DisplayName("최신 정산 조회 — OPEN(진행 중) 회차는 제외된다. 정산 이력이 없는 챌린지는 아예 빠진다")
    void latestSettledExcludesOpenSessions() {
        GroupChallengeBet other = anotherConfig();
        sessionOf(config, sessionDate, GroupBetStatus.OPEN);
        GroupChallengeBetSession settled =
                sessionOf(config, sessionDate.minusDays(1), GroupBetStatus.SETTLED);
        sessionOf(other, sessionDate, GroupBetStatus.OPEN);

        List<GroupChallengeBetSession> found = groupChallengeBetSessionRepository
                .findLatestSettledByChallengeIds(
                        List.of(challenge.getId(), other.getChallenge().getId()));

        assertThat(found).extracting(GroupChallengeBetSession::getId).containsExactly(settled.getId());
    }

    @Test
    @DisplayName("최신 정산 조회 — VOIDED·UNUSED 는 제외, FORFEITED(몰수)는 포함된다 (구앱 렌더 보호·N52)")
    void latestSettledExcludesVoidedAndUnusedButIncludesForfeited() {
        // 가장 최신이 VOIDED — 구앱은 VOIDED 문자열을 몰라 정산 결과처럼 오표시한다(신 API 부터 노출).
        sessionOf(config, sessionDate, GroupBetStatus.VOIDED);
        sessionOf(config, sessionDate.minusDays(2), GroupBetStatus.UNUSED);
        GroupChallengeBetSession forfeited =
                sessionOf(config, sessionDate.minusDays(1), GroupBetStatus.FORFEITED);

        List<GroupChallengeBetSession> found = groupChallengeBetSessionRepository
                .findLatestSettledByChallengeIds(List.of(challenge.getId()));

        assertThat(found).extracting(GroupChallengeBetSession::getId).containsExactly(forfeited.getId());
    }

    // ── 그룹 탈퇴 연동 대상 조회 ─────────────────────────────────────────

    @Test
    @DisplayName("탈퇴 대상 조회 — 이 그룹에서 내가 참가 중인 OPEN 회차만, id 오름차순으로 온다")
    void findsOpenSessionIdsForParticipant() {
        GroupChallengeBet other = anotherConfig();
        GroupChallengeBetSession open = sessionOf(sessionDate);
        GroupChallengeBetSession openOther = sessionOf(other, sessionDate, GroupBetStatus.OPEN);
        GroupChallengeBetSession settled =
                sessionOf(config, sessionDate.minusDays(1), GroupBetStatus.SETTLED);
        for (GroupChallengeBetSession session : List.of(open, openOther, settled)) {
            groupChallengeBetParticipantRepository.saveAndFlush(
                    GroupChallengeBetParticipant.builder().session(session).user(user).build());
        }
        // 참가하지 않은 OPEN 회차는 대상이 아니다.
        sessionOf(anotherConfig(), sessionDate, GroupBetStatus.OPEN);

        List<UUID> found = groupChallengeBetSessionRepository
                .findOpenSessionIdsByGroupIdAndParticipantUserId(group.getId(), user.getId());

        assertThat(found).containsExactlyInAnyOrder(open.getId(), openOther.getId());
        assertThat(found).isSorted();
    }

    @Test
    @DisplayName("계정 탈퇴 대상 조회(유저 스코프) — 그룹 무관하게 참가 중 OPEN 회차 전부, id 오름차순 (GROMO-801)")
    void findsOpenSessionIdsAcrossGroupsForParticipant() {
        Group otherGroup = groupRepository.saveAndFlush(Group.builder().name("다른방").build());
        GroupChallenge otherGroupChallenge = groupChallengeRepository.saveAndFlush(GroupChallenge.builder()
                .group(otherGroup)
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .build());
        GroupChallengeBet otherGroupConfig = groupChallengeBetRepository.saveAndFlush(
                GroupChallengeBet.builder()
                        .group(otherGroup)
                        .challenge(otherGroupChallenge)
                        .stake(30)
                        .enabled(true)
                        .build());
        GroupChallengeBetSession mine = sessionOf(sessionDate);
        GroupChallengeBetSession mineInOtherGroup =
                sessionOf(otherGroupConfig, sessionDate, GroupBetStatus.OPEN);
        GroupChallengeBetSession settled =
                sessionOf(config, sessionDate.minusDays(1), GroupBetStatus.SETTLED);
        for (GroupChallengeBetSession session : List.of(mine, mineInOtherGroup, settled)) {
            groupChallengeBetParticipantRepository.saveAndFlush(
                    GroupChallengeBetParticipant.builder().session(session).user(user).build());
        }
        // 참가하지 않은 OPEN 회차는 대상이 아니다.
        sessionOf(anotherConfig(), sessionDate, GroupBetStatus.OPEN);

        List<UUID> found = groupChallengeBetSessionRepository
                .findOpenSessionIdsByParticipantUserId(user.getId());

        assertThat(found).containsExactlyInAnyOrder(mine.getId(), mineInOtherGroup.getId());
        assertThat(found).isSorted();
    }

    // ── 정산 게이트 CAS ──────────────────────────────────────────────────

    @Test
    @DisplayName("정산 CAS — OPEN 이면 1행, 이미 정산됐으면 0행(동시 정산의 두 번째 트랜잭션이 여기서 스킵된다)")
    void compareAndSetSettledClaimsOnlyOnce() {
        GroupChallengeBetSession session = sessionOf(sessionDate);
        Instant settledAt = Instant.parse("2026-08-01T04:00:00Z");

        assertThat(groupChallengeBetSessionRepository.compareAndSetSettled(
                session.getId(), GroupBetStatus.SETTLED, null, settledAt)).isEqualTo(1);

        // 두 번째 시도는 status=OPEN 조건이 이미 깨져 아무 행도 건드리지 못한다.
        assertThat(groupChallengeBetSessionRepository.compareAndSetSettled(
                session.getId(), GroupBetStatus.REFUNDED, null, settledAt)).isZero();
        // 상태는 첫 CAS 가 쓴 값 그대로 — 뒤에 온 쪽이 덮어쓰지 못한다.
        assertThat(groupChallengeBetSessionRepository.findStatusById(session.getId()))
                .contains(GroupBetStatus.SETTLED);
    }

    @Test
    @DisplayName("무산 CAS — VOIDED 전이에 void_reason 이 같은 UPDATE 로 박힌다 (GROMO-1404)")
    void compareAndSetVoidedRecordsReason() {
        GroupChallengeBetSession session = sessionOf(sessionDate);

        assertThat(groupChallengeBetSessionRepository.compareAndSetSettled(
                session.getId(), GroupBetStatus.VOIDED,
                GroupBetVoidReason.INSUFFICIENT_PARTICIPANTS,
                Instant.now())).isEqualTo(1);

        // 벌크 UPDATE 는 영속성 컨텍스트를 우회한다 — findById 는 낡은 1차 캐시를 돌려주므로
        // DB 원본을 SQL 로 직접 읽는다(compareAndSetSettled 의 주석 계약 그대로).
        assertThat(jdbcTemplate.queryForMap(
                "SELECT status, void_reason FROM group_challenge_bet_sessions WHERE id = ?",
                session.getId()))
                .containsEntry("status", "VOIDED")
                .containsEntry("void_reason", "INSUFFICIENT_PARTICIPANTS");
    }

    @Test
    @DisplayName("V22 의 type CHECK — 등록된 모든 사유(재화 보상 3종 포함)는 통과, 미등록 값은 거절된다")
    void migrationTypeCheckAcceptsBetTypesAndRejectsUnknown() {
        applyTypeCheckFromMigration();

        for (CurrencyTransactionType type : CurrencyTransactionType.values()) {
            insertTransaction(type.name());
        }

        // 마지막에 둔 이유: Postgres 는 실패한 문에서 트랜잭션을 abort 시켜 이후 SQL 이 모두 막힌다.
        assertThatThrownBy(() -> insertTransaction("BET_JACKPOT"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * V22 의 ALTER 문(type CHECK 재작성 = DROP + ADD)을 <b>파일에서 읽어 그대로</b> 실행한다 —
     * 이 테스트가 검증하는 것은 CHECK 식의 사본이 아니라 마이그레이션 원본이다.
     */
    private void applyTypeCheckFromMigration() {
        List<String> alters = Arrays.stream(readMigration().split(";"))
                .map(String::trim)
                .filter(s -> s.contains("CONSTRAINT currency_transactions_type_check"))
                .toList();

        assertThat(alters)
                .as("V22 의 type CHECK 재작성은 DROP + ADD 두 문이어야 한다")
                .hasSize(2);
        alters.forEach(jdbcTemplate::execute);
    }

    private String readMigration() {
        try (var in = new ClassPathResource(MIGRATION_PATH).getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("마이그레이션 파일을 읽지 못했습니다: " + MIGRATION_PATH, e);
        }
    }

    private void insertTransaction(String type) {
        jdbcTemplate.update(
                "INSERT INTO currency_transactions (id, user_id, amount, type, created_at) "
                        + "VALUES (?, ?, ?, ?, now())",
                UUID.randomUUID(), user.getId(), 10, type);
    }
}
