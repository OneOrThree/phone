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
 * {@code islands} 를 가리키는 FK 28개(V0 baseline) 중 13개가 {@code ON DELETE RESTRICT}, 3개가 미지정(NO ACTION)이고,
 * 그중에는 정책이 「유지한다」고 못 박은 개인 집중 기록({@code focus_session_details})과 정산 증거
 * ({@code group_members})가 섞여 있다. 물리 삭제는 그것까지 지우거나 FK 로 실패한다.
 * 그래서 섬 행은 {@code status = ENDED} + {@code deleted_at} 묘비로 「없는 섬」을 확정하고
 * ({@code IslandMovementGuards.isAlive} 가 이미 두 축을 본다), <b>공동</b> 테이블만 실제로 지운다.
 * 섬 행이 남으므로 나머지 CASCADE 9개·SET NULL 3개도 돌지 않는다 — 지울 표는 CASCADE 여도 아래 목록에 적는다.
 *
 * <h2>왜 테이블 목록을 여기 세워 두는가</h2>
 * 도메인마다 {@code deleteByIslandId} 를 심으면 새 섬 테이블이 생길 때 한 곳만 빠져도 조용히 남는다.
 * 한 목록이면 새 테이블을 더할 자리가 하나고, <b>삭제 순서</b>(자식 → 부모)도 한눈에 검토된다.
 * 참조를 만들지 않으므로 도메인 높이 표를 거스르지도 않는다 — SQL 은 참조가 아니다.
 *
 * <p><b>순서가 곧 정합성이다.</b> 아래 목록은 FK 의 자식이 먼저다: 퀘스트 청구·코호트 → 회차 → 퀘스트,
 * 통장 거래 → 통장, 건설 기여 → 건설 상태. 뒤집으면 {@code RESTRICT} 에 걸려 트랜잭션 전체가 롤백된다.
 *
 * <h2>{@code islands} 참조 전수 — {@code IslandPurgeGuardTest} 가 지킨다 (GROMO-2284)</h2>
 * 목록을 눈대중으로 늘리면 또 빠진다. 가드 테스트가 V0 를 올린 DB 의 {@code pg_constraint} 에서 {@code islands} 를
 * 가리키는 FK 표를 읽고 FK 없이 섬 id 를 가진 표({@code island_weekly_focus}·{@code telescope_buckets})를 더해,
 * 표마다 {@link #PURGE_STATEMENTS} 가 지우거나 테스트의 허용목록에 «남기는 사유»가 적혀 있는지 단언한다. 새 섬 참조
 * 표를 만들면 둘 중 한쪽에 적어야 테스트가 통과한다. <b>남기는 표와 그 사유의 정본은 그 허용목록이다</b>
 * ({@code group_members}·{@code island_join_requests}·{@code focus_session_details}·{@code focus_tutorial_rewards}·
 * {@code letters}·{@code user_main_islands}·{@code user_island_contexts}·{@code group_invite_links}·
 * {@code telescope_buckets}). {@code owned_products} 는 {@code owner_type='island'} 행만 지우고 개인 보유품은 남긴다.
 * 지우는 표 중 설명이 필요한 것:
 * <ul>
 *   <li>{@code group_announcements}·{@code group_announcement_comments} — 지운다. 게시판은 공동 기록이다. 댓글 FK 는
 *       공지에 {@code ON DELETE CASCADE}(V0)라 공지만 지워도 따라 지워지지만, 자식 먼저 규칙대로 댓글을 먼저 적는다.</li>
 *   <li>{@code island_guestbook_entries} — 지운다(GROMO-2262, V113). 방명록은 섬의 공동
 *       기록이고 글마다 작성자 id 가 달려 있다. 섬 행이 소프트 삭제라 {@code ON DELETE CASCADE} 는 돌지 않으므로
 *       여기서 직접 지운다. 다른 테이블이 이 표를 참조하지 않아 목록 안의 순서는 자유롭다.</li>
 *   <li>{@code telescope_pins} — 지운다(GROMO-2268, V115). 남의 망원경에 «직접 넣은 섬» 으로 남은 행이다. 섬 행이 소프트
 *       삭제라 {@code ON DELETE CASCADE} 는 돌지 않는다. 다른 테이블이 이 표를 참조하지 않아 순서는 자유롭다.</li>
 *   <li>{@code island_news} — 지운다(GROMO-2267, V116). 섬 소식은 주민 전원이 읽는 공동 피드다. 섬 행이
 *       소프트 삭제라 {@code ON DELETE CASCADE} 는 돌지 않으므로 직접 지운다. 유저 컬럼이 없어 계정 탈퇴가 건드릴
 *       행도 없다. 홍보비의 원장 행은 아래 통장 원장 줄이 이미 지운다.</li>
 *   <li>{@code island_promotions} — 지운다(GROMO-2289, V119). 섬장이 신청한 잡지 홍보 칸이다. 닫힌 섬의 칸은 잡지에서도
 *       읽는 순간 빠지고 기록판을 볼 주민도 없다. 섬 행이 소프트 삭제라 {@code ON DELETE CASCADE} 는 돌지 않는다.
 *       신청자 열({@code applied_by})은 기록이라 계정 탈퇴 정리는 없다. 홍보비 원장 행은 아래 통장 원장 줄이 지운다.</li>
 *   <li>{@code island_weekly_focus}·{@code island_weekly_member_counts} — 지운다(GROMO-2284). 주간 랭킹의 분자
 *       read model 과 동결 분모다. 랭킹은 읽을 때 죽은 섬을 거르므로({@code IslandRankingsService}) 화면은 같고 행만
 *       정리된다. 분자는 FK 가 없어 DB 가 따라 지울 길이 없다. 단 주 마감 재계산
 *       ({@code IslandRankingFreezeService#closeWeek})이 남아 있는 {@code focus_session_details} 로 섬이 닫힌 주의
 *       분자 행을 다시 채울 수 있다 — 그 행도 읽기에서 걸러진다.</li>
 *   <li>{@code island_layouts}·{@code onboarding_islands} — 지운다(GROMO-2284). 섬 배치는 공동 데이터다. 온보딩 예약은
 *       정착 때 이미 지워지지만({@code OnboardingIslandService#settleAtArrival}) 남은 행이 닫힌 섬을 가리킬 이유가
 *       없다.</li>
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
     * <p>새 섬 테이블을 만들면 여기에 한 줄을 더하거나 {@code IslandPurgeGuardTest} 의 허용목록에 남기는 사유를 적는다.
     * 둘 다 안 하면 그 테스트가 깨진다. 패키지 공개는 그 테스트가 문장 머리의 표 이름을 읽기 위해서다.
     */
    static final List<String> PURGE_STATEMENTS = List.of(
            // 섬별 7일 평균 일 스냅샷 (V114, GROMO-2257) — 파생 통계라 닫힌 섬을 읽는 곳이 없다. 자식이 없는 독립 표다.
            "DELETE FROM island_focus_averages WHERE island_id = :islandId",
            // 주간 랭킹 분자·동결 분모 (GROMO-2343·1997) — 자식이 없는 독립 표다. 분자는 FK 가 없다(클래스 javadoc).
            // ponytail: 두 표 PK 가 (week_start, island_id) 라 island_id 만으로는 표를 훑는다 — 섬 종료가 드물고 표가
            // 주×섬 크기라 둔다. 느려지면 island_id 인덱스를 마이그레이션으로 더한다.
            "DELETE FROM island_weekly_focus WHERE island_id = :islandId",
            "DELETE FROM island_weekly_member_counts WHERE island_id = :islandId",
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
            // 건물·건설 상태·배치 (V62) — 기여가 건설 상태의 자식이다. 배치는 자식이 없는 독립 표다.
            "DELETE FROM island_facilities WHERE island_id = :islandId",
            "DELETE FROM island_construction_contributions WHERE island_id = :islandId",
            "DELETE FROM island_construction_states WHERE island_id = :islandId",
            "DELETE FROM island_layouts WHERE island_id = :islandId",
            // 게시판 (공지 + 댓글) — 댓글 FK 는 공지에 ON DELETE CASCADE(V0)라 공지만 지워도 따라 지워진다.
            // 그래도 자식 먼저 규칙대로 댓글을 먼저 적어, 순서를 FK 동작에 기대지 않는다.
            "DELETE FROM group_announcement_comments WHERE notice_id IN "
                    + "(SELECT id FROM group_announcements WHERE group_id = :islandId)",
            "DELETE FROM group_announcements WHERE group_id = :islandId",
            // 방명록 (V113, GROMO-2262) — 방문자·주민이 남긴 글과 작성자 id. 섬 행은 소프트 삭제라 V113 의
            // ON DELETE CASCADE 는 돌지 않는다. 다른 테이블이 이 표를 참조하지 않아 순서는 자유롭다.
            "DELETE FROM island_guestbook_entries WHERE island_id = :islandId",
            // 섬 도착 기록 (V112, GROMO-2260) — 다른 표의 부모가 아니다. 섬은 묘비만 남고 하드 삭제되지 않아
            // FK 의 ON DELETE CASCADE 가 돌지 않으므로 여기서 지운다. 닫힌 섬은 즉시 이동·다음 위치 후보가 아니다.
            "DELETE FROM island_arrivals WHERE island_id = :islandId",
            // 망원경 핀 (V115, GROMO-2268) — 다른 표의 부모가 아니다. 이것도 CASCADE 가 돌지 않으므로 여기서 지운다.
            // 읽기 쪽도 살아 있는 섬만 보여 주지만, 닫힌 섬이 남의 핀 행으로 남을 이유는 없다.
            "DELETE FROM telescope_pins WHERE island_id = :islandId",
            // 섬 소식 (V116, GROMO-2267) — 주민 전원이 읽던 공동 피드. 섬 행은 소프트 삭제라 V116 의 ON DELETE CASCADE 는
            // 돌지 않는다. 유저 컬럼이 없어 탈퇴 정리는 없고, 다른 테이블이 이 표를 참조하지 않아 순서는 자유롭다.
            "DELETE FROM island_news WHERE island_id = :islandId",
            // 잡지 홍보 칸 (V119, GROMO-2289) — 섬장이 꾸며 신청한 칸. 섬 행은 소프트 삭제라 V119 의 ON DELETE CASCADE 는
            // 돌지 않는다. 홍보 칸 삭제 시 신고는 CASCADE 로 지워지고 핀의 홍보 연결은 NULL 이 된다.
            "DELETE FROM island_promotions WHERE island_id = :islandId",
            // 온보딩 무인도 예약 (GROMO-2284) — 정착 때 이미 지워지지만 남은 예약이 닫힌 섬을 가리킬 이유가 없다. 독립 표다.
            "DELETE FROM onboarding_islands WHERE island_id = :islandId",
            // 공동 잔액·원장 (V62) — 원장이 통장의 자식이라 가장 마지막이다. 홍보비 원장 행(PROMOTION_FEE)도 여기서 지워진다.
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
