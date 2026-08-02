package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.currency.domain.CurrencyTransaction;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.user.domain.User;
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
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 내기 스키마의 실 SQL 제약 검증 — 애플리케이션 가드가 뚫려도 DB 가 막아야 하는 지점들.
 *
 * <p>동시 개설·동시 참가는 서비스의 exists 검사만으로는 레이스를 막지 못한다(검사와 삽입 사이가 열려
 * 있다). 정산 재실행의 이중 지급도 마찬가지로 멱등키 유니크가 최후 방어선이다. 그래서 세 유니크
 * 제약이 실제 Postgres 에 존재하는지를 여기서 확인한다.
 *
 * <p><b>ci 프로파일 주의</b>: 스키마는 Flyway 가 아니라 엔티티 create-drop 으로 만들어진다
 * ({@code application-ci.yml}). 유니크 제약은 엔티티에 선언돼 있어 그대로 생성되지만
 * {@code currency_transactions} 의 type CHECK 는 마이그레이션에만 있다 — 그래서 CHECK 테스트는
 * V22(currency 사유 CHECK) 파일에서 ALTER 문을 직접 읽어 적용한 뒤 검증한다(마이그레이션 SQL 자체를 검증하는 셈).
 */
class GroupChallengeBetRepositoryTest extends RepositoryTestBase {

    private static final String MIGRATION_PATH = "db/migration/V22__currency_transaction_reward_types.sql";

    @Autowired
    GroupChallengeBetRepository groupChallengeBetRepository;
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
    private User user;

    private final LocalDate betDate = LocalDate.of(2026, 7, 31);

    @BeforeEach
    void setUp() {
        // saveAndFlush 로 즉시 DB 에 내보낸다 — type CHECK 테스트는 JdbcTemplate 로 직접 INSERT 하므로
        // 영속성 컨텍스트에만 있는 user 행은 FK 로 보이지 않는다.
        group = groupRepository.saveAndFlush(Group.builder().name("스터디").build());
        challenge = groupChallengeRepository.saveAndFlush(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .build());
        user = userRepository.saveAndFlush(User.builder().nickname("재영").isGuest(false).build());
    }

    private GroupChallengeBet betOf(LocalDate date) {
        return betOf(challenge, date, GroupBetStatus.OPEN);
    }

    private GroupChallengeBet betOf(GroupChallenge target, LocalDate date, GroupBetStatus status) {
        return GroupChallengeBet.builder()
                .group(group)
                .challenge(target)
                .creatorUser(user)
                .stake(30)
                .betDate(date)
                .status(status)
                .build();
    }

    private GroupChallenge anotherChallenge() {
        return groupChallengeRepository.saveAndFlush(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .build());
    }

    @Test
    @DisplayName("(challenge_id, bet_date) 유니크 — 같은 챌린지·같은 날짜 내기 2건은 DB 가 막는다")
    void rejectsDuplicateBetForSameChallengeAndDate() {
        groupChallengeBetRepository.saveAndFlush(betOf(betDate));

        assertThatThrownBy(() -> groupChallengeBetRepository.saveAndFlush(betOf(betDate)))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("날짜가 다르면 같은 챌린지라도 내기를 각각 걸 수 있다")
    void allowsBetsOnDifferentDatesForSameChallenge() {
        groupChallengeBetRepository.saveAndFlush(betOf(betDate));
        groupChallengeBetRepository.saveAndFlush(betOf(betDate.plusDays(1)));

        assertThat(groupChallengeBetRepository.findByChallengeIdInAndBetDate(
                List.of(challenge.getId()), betDate)).hasSize(1);
    }

    @Test
    @DisplayName("(bet_id, user_id) 유니크 — 같은 내기에 같은 유저 2번 참가는 DB 가 막는다(동시 참가 레이스 최후 방어)")
    void rejectsDuplicateParticipant() {
        GroupChallengeBet bet = groupChallengeBetRepository.saveAndFlush(betOf(betDate));
        groupChallengeBetParticipantRepository.saveAndFlush(
                GroupChallengeBetParticipant.builder().bet(bet).user(user).build());

        assertThatThrownBy(() -> groupChallengeBetParticipantRepository.saveAndFlush(
                GroupChallengeBetParticipant.builder().bet(bet).user(user).build()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("idempotency_key 유니크 — 같은 멱등키 재기입은 DB 가 막는다(정산 재실행 이중 지급 차단)")
    void rejectsDuplicateIdempotencyKey() {
        String key = "bet:" + UUID.randomUUID() + ":payout:" + user.getId();
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

        assertThat(currencyTransactionRepository.existsByIdempotencyKey("bet:none")).isFalse();
    }

    // ── 챌린지별 최신 정산 1건 (DISTINCT ON) ─────────────────────────────

    @Test
    @DisplayName("최신 정산 조회 — 챌린지당 1행만, 그것도 bet_date 가 가장 큰 행이 온다")
    void latestSettledReturnsExactlyOneRowPerChallenge() {
        GroupChallenge other = anotherChallenge();
        groupChallengeBetRepository.saveAndFlush(betOf(challenge, betDate.minusDays(2), GroupBetStatus.SETTLED));
        GroupChallengeBet newest =
                groupChallengeBetRepository.saveAndFlush(betOf(challenge, betDate.minusDays(1),
                        GroupBetStatus.REFUNDED));
        GroupChallengeBet otherOnly =
                groupChallengeBetRepository.saveAndFlush(betOf(other, betDate.minusDays(5),
                        GroupBetStatus.SETTLED));

        List<GroupChallengeBet> found = groupChallengeBetRepository.findLatestSettledByChallengeIds(
                List.of(challenge.getId(), other.getId()));

        assertThat(found)
                .extracting(GroupChallengeBet::getId)
                .containsExactlyInAnyOrder(newest.getId(), otherOnly.getId());
    }

    @Test
    @DisplayName("최신 정산 조회 — OPEN(진행 중) 내기는 제외된다. 정산 이력이 없는 챌린지는 아예 빠진다")
    void latestSettledExcludesOpenBets() {
        GroupChallenge other = anotherChallenge();
        // 가장 최신이지만 아직 OPEN — 지난 내기 줄에 나오면 안 된다.
        groupChallengeBetRepository.saveAndFlush(betOf(challenge, betDate, GroupBetStatus.OPEN));
        GroupChallengeBet settled =
                groupChallengeBetRepository.saveAndFlush(betOf(challenge, betDate.minusDays(1),
                        GroupBetStatus.SETTLED));
        groupChallengeBetRepository.saveAndFlush(betOf(other, betDate, GroupBetStatus.OPEN));

        List<GroupChallengeBet> found = groupChallengeBetRepository.findLatestSettledByChallengeIds(
                List.of(challenge.getId(), other.getId()));

        assertThat(found).extracting(GroupChallengeBet::getId).containsExactly(settled.getId());
    }

    @Test
    @DisplayName("최신 정산 조회 — CANCELED(취소)는 제외, FORFEITED(몰수)는 포함된다")
    void latestSettledExcludesCanceledButIncludesForfeited() {
        // 가장 최신이 취소 — 취소는 결과가 아니라 없던 일이므로 '지난 내기' 줄에 나오면 안 된다.
        // 구앱은 CANCELED 문자열을 몰라 정산 결과처럼 오표시한다.
        groupChallengeBetRepository.saveAndFlush(betOf(challenge, betDate, GroupBetStatus.CANCELED));
        GroupChallengeBet forfeited = groupChallengeBetRepository.saveAndFlush(
                betOf(challenge, betDate.minusDays(1), GroupBetStatus.FORFEITED));

        List<GroupChallengeBet> found = groupChallengeBetRepository.findLatestSettledByChallengeIds(
                List.of(challenge.getId()));

        assertThat(found).extracting(GroupChallengeBet::getId).containsExactly(forfeited.getId());
    }

    @Test
    @DisplayName("취소 이력만 있는 챌린지는 최신 정산 조회에서 아예 빠진다")
    void latestSettledOmitsChallengeWithOnlyCanceledBets() {
        groupChallengeBetRepository.saveAndFlush(betOf(challenge, betDate, GroupBetStatus.CANCELED));

        assertThat(groupChallengeBetRepository.findLatestSettledByChallengeIds(
                List.of(challenge.getId()))).isEmpty();
    }

    // ── 그룹 탈퇴 연동 대상 조회 ─────────────────────────────────────────

    @Test
    @DisplayName("탈퇴 대상 조회 — 이 그룹에서 내가 참가 중인 OPEN 내기만, id 오름차순으로 온다")
    void findsOpenBetIdsForParticipant() {
        GroupChallenge other = anotherChallenge();
        GroupChallengeBet open = groupChallengeBetRepository.saveAndFlush(betOf(betDate));
        GroupChallengeBet openOther =
                groupChallengeBetRepository.saveAndFlush(betOf(other, betDate, GroupBetStatus.OPEN));
        GroupChallengeBet settled = groupChallengeBetRepository.saveAndFlush(
                betOf(challenge, betDate.minusDays(1), GroupBetStatus.SETTLED));
        for (GroupChallengeBet bet : List.of(open, openOther, settled)) {
            groupChallengeBetParticipantRepository.saveAndFlush(
                    GroupChallengeBetParticipant.builder().bet(bet).user(user).build());
        }
        // 참가하지 않은 OPEN 내기는 대상이 아니다.
        groupChallengeBetRepository.saveAndFlush(
                betOf(anotherChallenge(), betDate, GroupBetStatus.OPEN));

        List<UUID> found = groupChallengeBetRepository
                .findOpenBetIdsByGroupIdAndParticipantUserId(group.getId(), user.getId());

        assertThat(found).containsExactlyInAnyOrder(open.getId(), openOther.getId());
        assertThat(found).isSorted();
    }

    // ── 정산 게이트 CAS ──────────────────────────────────────────────────

    @Test
    @DisplayName("정산 CAS — OPEN 이면 1행, 이미 정산됐으면 0행(동시 정산의 두 번째 트랜잭션이 여기서 스킵된다)")
    void compareAndSetSettledClaimsOnlyOnce() {
        GroupChallengeBet bet = groupChallengeBetRepository.saveAndFlush(betOf(betDate));
        Instant settledAt = Instant.parse("2026-08-01T04:00:00Z");

        assertThat(groupChallengeBetRepository.compareAndSetSettled(
                bet.getId(), GroupBetStatus.SETTLED, settledAt)).isEqualTo(1);

        // 두 번째 시도는 status=OPEN 조건이 이미 깨져 아무 행도 건드리지 못한다.
        assertThat(groupChallengeBetRepository.compareAndSetSettled(
                bet.getId(), GroupBetStatus.REFUNDED, settledAt)).isZero();
        // 상태는 첫 CAS 가 쓴 값 그대로 — 뒤에 온 쪽이 덮어쓰지 못한다.
        assertThat(groupChallengeBetRepository.findStatusById(bet.getId()))
                .contains(GroupBetStatus.SETTLED);
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
     *
     * <p>ci 스키마는 create-drop 이지만 {@code currency_transactions_type_check} 는 이미 존재한다
     * (Hibernate 6 이 enum 컬럼에서 같은 이름의 CHECK 를 생성한다). 덕분에 DROP 도 dev/prod 와
     * 동일하게 성립하므로 두 문을 있는 그대로 돌릴 수 있다.
     */
    private void applyTypeCheckFromMigration() {
        // 앞선 주석 줄까지 한 덩어리로 잘리므로 제약 이름으로 고른다(선행 주석이 있어도 실행에는 문제없다).
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
