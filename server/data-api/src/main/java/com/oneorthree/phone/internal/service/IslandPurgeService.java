package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.port.IslandPurgePort;
import com.oneorthree.phone.group.repository.GroupRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 섬 삭제 — 공동 데이터를 함께 지운다 (GROMO-1995, {@link IslandPurgePort}).
 *
 * <h2>소프트 삭제인 이유</h2>
 * {@code groups} 를 가리키는 FK 가 <b>전부 {@code ON DELETE RESTRICT}</b> 이고(V62·V64·V71·V73·V74),
 * 그중에는 정책이 「유지한다」고 못 박은 개인 집중 기록({@code focus_sessions})과 정산 증거
 * ({@code group_members}·내기 참가)가 섞여 있다. 물리 삭제는 그것까지 지우거나 FK 로 실패한다.
 * 그래서 섬 행은 {@code status = ENDED} + {@code deleted_at} 묘비로 「없는 섬」을 확정하고
 * ({@code IslandMovementGuards.isAlive} 가 이미 두 축을 본다), <b>공동</b> 테이블만 실제로 지운다.
 *
 * <h2>왜 테이블 목록을 여기 세워 두는가</h2>
 * 도메인마다 {@code deleteByIslandId} 를 심으면 새 섬 테이블이 생길 때 한 곳만 빠져도 조용히 남는다.
 * 한 목록이면 새 테이블을 더할 자리가 하나고, <b>삭제 순서</b>(자식 → 부모)도 한눈에 검토된다.
 * 참조를 만들지 않으므로 도메인 높이 표를 거스르지도 않는다 — SQL 은 참조가 아니다.
 *
 * <p><b>순서가 곧 정합성이다.</b> 아래 목록은 FK 의 자식이 먼저다: 퀘스트 청구·코호트 → 회차 → 퀘스트,
 * 통장 거래 → 통장, 건설 기여 → 건설 상태. 뒤집으면 {@code RESTRICT} 에 걸려 트랜잭션 전체가 롤백된다.
 *
 * <p><b>지우지 않는 것.</b> {@code group_members}(이탈 마킹으로 이미 소속이 끊겼고 정산 증거다) ·
 * {@code island_join_requests}(섬 종결이 {@code ISLAND_CLOSED} 로 닫는다 — 신청은 공동 기록이 아니라
 * 신청자의 기록이다) · {@code focus_sessions}·{@code focus_reward_accruals}(개인 집중 기록, 정책이
 * 유지) · {@code owned_products} 의 {@code owner_type='user'} 행(개인 보유품, 정책이 유지).
 *
 * <h2>{@code groups(id)} 참조 전수 — 2026-09-21 실측</h2>
 * 목록을 눈대중으로 늘리면 또 빠진다. 마이그레이션 전량에서 {@code groups(id)} 를 참조하는 테이블을
 * 세어 <b>24개</b>를 찾았고(V1 baseline 6 + V3·V19·V21·V39·V57·V58·V62×3·V63·V64×2·V71×3·V73·V74·V81),
 * 아래 목록과 「안 지우는 것」이 그 24개를 남김없이 덮는다. 지우지 않기로 한 나머지의 근거는 이렇다:
 * <ul>
 *   <li>{@code group_join_codes} — 지운다(아래). 섬의 참여 코드는 정책이 말한 「섬 정보·설정」이다.</li>
 *   <li>{@code group_announcements}·{@code group_announcement_comments} — 지운다(아래). 게시판은
 *       공동 기록이다. 댓글의 FK 는 {@code ON DELETE SET NULL}(V66, BQ02 미결)이라 공지만 지우면
 *       댓글이 {@code notice_id=null} 로 <b>남는다</b> — 그래서 댓글을 먼저 지운다.</li>
 *   <li>{@code user_main_islands} — 안 지운다. 마지막 주민이 나가는 순간
 *       {@code MainIslandService#onMembershipRevoked} 가 같은 트랜잭션에서 옮기거나 지워, 여기 닿을
 *       때 이 섬을 가리키는 행은 이미 없다. 여기서 또 지우면 같은 사실의 장부가 둘이 된다.</li>
 *   <li>{@code user_island_contexts} — 안 지운다. 같은 이유로 {@code UserIslandContextRecovery} 가
 *       이미 옮기거나 비웠다(GROMO-1995). 행 자체는 사용자의 것이라 애초에 지울 대상도 아니다.</li>
 *   <li>{@code group_invite_links}·{@code invite_link_clicks} — 안 지운다. 종결은
 *       {@code recordGroupClosed} 가 링크 도메인에 <b>폐기 사건</b>으로 전달하고(㋢), 클릭은 설치
 *       귀속(MMP) 증거다. 여기서 행을 지우면 그 두 계약이 동시에 깨진다.</li>
 *   <li>{@code group_challenges}·{@code group_challenge_bets}·{@code group_challenge_bet_sessions} —
 *       안 지운다. 1.x 챌린지·내기의 정산 증거다({@link IslandPurgePort} 가 못 박은 「유지」 목록).</li>
 *   <li>{@code group_notice_grants}·{@code share_cards} — 안 지운다. 1.x 잔존 테이블로 엔티티조차
 *       없다(2026-09-21 실측). 공지 작성 권한의 정본은 이 표가 아니라
 *       {@code group_members.announcement_permission} 이고, 그 행은 멤버십과 함께 남는다.</li>
 *   <li>{@code group_invites} — 안 지운다. {@code GroupInviteRepository} 가 스스로 「미사용(2026-07-31,
 *       유저 직접 초대 종료)」이라 적어 두었고, 실제로 남은 호출부는 계정 탈퇴 파기
 *       ({@code deleteAllInvolving}) 하나뿐인 <b>사용자 축</b>이다. 섬 축으로 새로 생기는 행이 없으니
 *       섬 종결이 지울 것도 없다.</li>
 * </ul>
 */
@Service
@Slf4j
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class IslandPurgeService implements IslandPurgePort {

    /**
     * 지울 공동 테이블 — <b>자식 먼저</b>. 각 문장의 바인딩은 {@code :islandId} 하나다.
     *
     * <p>새 섬 테이블을 만들면 여기에 한 줄을 더한다. 빠뜨리면 닫힌 섬의 공동 데이터가 남는다.
     */
    private static final List<String> PURGE_STATEMENTS = List.of(
            // 건설 퀘스트·일일 퀘스트 (V71) — 청구·코호트가 회차의 자식이고 회차가 퀘스트의 자식이다.
            "DELETE FROM island_quest_claims WHERE island_id = :islandId",
            "DELETE FROM island_quest_cohort_members WHERE occurrence_id IN "
                    + "(SELECT id FROM island_quest_occurrences WHERE island_id = :islandId)",
            "DELETE FROM island_quest_occurrences WHERE island_id = :islandId",
            "DELETE FROM island_quests WHERE island_id = :islandId",
            // 공동 구매·적용 내역 (V64·V73·V74) — 섬 소유 보유품만, 개인 보유품은 남긴다.
            "DELETE FROM shop_orders WHERE island_id = :islandId",
            "DELETE FROM island_playbacks WHERE island_id = :islandId",
            "DELETE FROM island_appearances WHERE island_id = :islandId",
            "DELETE FROM owned_products WHERE owner_type = 'island' AND group_id = :islandId",
            // 건물·건설 상태 (V62) — 기여가 건설 상태의 자식이다.
            "DELETE FROM island_facilities WHERE island_id = :islandId",
            "DELETE FROM island_construction_contributions WHERE island_id = :islandId",
            "DELETE FROM island_construction_states WHERE island_id = :islandId",
            // 게시판 (V1 공지 + V66 댓글) — 댓글 FK 가 ON DELETE SET NULL 이라 공지를 먼저 지우면
            // 댓글이 notice_id=null 로 살아남는다. 자식(댓글)이 먼저여야 하는 이유가 CASCADE 가
            // 아니라 «SET NULL» 이라는 점만 다를 뿐, 순서 규칙은 위와 같다.
            "DELETE FROM group_announcement_comments WHERE notice_id IN "
                    + "(SELECT id FROM group_announcements WHERE group_id = :islandId)",
            "DELETE FROM group_announcements WHERE group_id = :islandId",
            // 참여 코드 (V3) — 섬당 1행인 「섬 설정」이다. 남기면 죽은 섬의 코드가 계속 유효해 보인다.
            "DELETE FROM group_join_codes WHERE group_id = :islandId",
            // 공동 잔액·원장 (V62) — 원장이 통장의 자식이라 가장 마지막이다.
            "DELETE FROM island_wallet_transactions WHERE island_id = :islandId",
            "DELETE FROM island_wallets WHERE island_id = :islandId");

    private final GroupRepository groups;
    private final Clock clock;

    @PersistenceContext
    private EntityManager entityManager;

    @Override
    public void purgeIsland(UUID islandId) {
        // 같은 트랜잭션이 방금 바꾼 엔티티(이탈 마킹·통장 갱신)를 먼저 내려보낸다 — 네이티브 DELETE 는
        // 영속성 컨텍스트를 자동으로 비워 주지 않아서, 안 하면 플러시가 지운 행을 다시 UPDATE 하려 든다.
        entityManager.flush();
        int removed = 0;
        for (String statement : PURGE_STATEMENTS) {
            removed += entityManager.createNativeQuery(statement)
                    .setParameter("islandId", islandId)
                    .executeUpdate();
        }
        // {@code clear()} 하지 않는다 — 호출자가 방금 바꾼 멤버십·섬·봉투가 함께 detach 되어 이어지는
        // 처리가 준영속 인스턴스를 만지게 된다. 위 flush 로 그쪽 변경은 이미 DB 에 내려가 있고, 지운
        // 테이블의 엔티티는 이 경로가 애초에 적재하지 않는다.
        groups.findById(islandId).ifPresent(island -> island.markDeleted(Instant.now(clock)));
        log.info("island purged islandId={} rows={}", islandId, removed);
    }
}
