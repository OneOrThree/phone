package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.construction.repository.IslandWalletTransactionRepository;
import com.oneorthree.phone.construction.repository.domain.IslandWalletTransactionType;
import com.oneorthree.phone.construction.service.IslandWalletEvents;
import com.oneorthree.phone.construction.service.IslandWalletService;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.IslandNewsRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.IslandNews;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.internal.dto.IslandPromotionViews;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 고양이 잡지 홍보비와 섬 소식 (GROMO-2267, 섬 외부 계약 §7) — 섬장이 홍보를 신청하면 섬 통장에서 60마리를 빼고,
 * 주민 전원이 읽는 섬 소식 한 줄을 남긴다. 홍보 «내용»(글·틀·스티커)·마감·검토는 잡지 담당(E4-1)의 몫이라 여기엔
 * 돈과 소식뿐이다. 소식을 읽는 {@link #news} 도 이 서비스에 둔다 — 지금 소식을 쓰는 곳이 홍보 신청 하나뿐이라서다.
 *
 * <h2>신청 — 한 TX, 두 겹의 멱등</h2>
 * 앱 명령 키({@code Idempotency-Key})의 같은 키·같은 요청은 상점 구매와 같은 {@link PublicCommandService} 가 원
 * 201 을 재생한다. 다른 키로 같은 KST 날 또 신청하면 «오늘 키» {@code promotion:<섬 id>:<KST 날짜>} 의 원장 행이
 * 이미 있어 409 {@code PROMOTION_ALREADY_REQUESTED_TODAY} 다 — 이 키가 지갑 유니크 제약(섬, 사유, 키)이기도 해서
 * 이중 차감의 최후 방어선이 된다. 실패(부족·오늘 이미)는 receipt 도 차감도 남기지 않는다.
 *
 * <h2>잠금 — 유저(배타) → 섬(groups 배타) → 멤버십 → 지갑(배타)</h2>
 * 계약 §7 의 순서이고 상점 구매와 같다. 섬 잠금이 «오늘 이미 신청했나» 판정과 차감을 섬 단위로 직렬화한다 —
 * 섬장이 위임으로 바뀌는 날 두 사람이 동시에 신청해도 한 건만 통과한다. 섬장 판정은 DB 의 현재 역할이라 위임과도
 * 직렬화된다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class IslandPromotionService {

    /** 홍보비 — 고정 60마리다(결정 N1). 설정값이 아니다. */
    public static final int PROMOTION_FEE_FISH = 60;

    /** 소식 목록 상한 — 기본값(20)은 Business 의 몫이다. */
    private static final int MAX_NEWS_LIMIT = 50;

    /** 소식 문구 — 보낸 사람을 싣지 않는다(「섬장이」). 금액은 위 상수에서 따라온다. */
    private static final String NEWS_BODY = "섬장이 오늘 잡지 홍보에 " + PROMOTION_FEE_FISH + "마리를 썼어요";

    private final UserQueryService users;
    private final GroupQueryService groups;
    private final GroupMembershipMutationLocks membershipLocks;
    private final IslandWalletService wallets;
    private final IslandWalletTransactionRepository ledger;
    private final IslandWalletEvents walletEvents;
    private final IslandNewsRepository newsItems;
    private final PublicCommandService publicCommands;
    private final Clock clock;

    /**
     * 홍보 신청 — 섬장만(비주민·일반 주민은 403 {@code NOT_OWNER}). 같은 키·같은 요청의 재생도 <b>지금</b> 섬장이어야
     * 원 결과를 돌려준다(상점 구매의 재생 인가와 같은 규칙). 게스트는 컨트롤러가 이 앞에서 막는다.
     */
    @Transactional
    public IslandPromotionViews.Created promote(UUID userId, UUID islandId, UUID key) {
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "POST:/islands/" + islandId + "/promotions", key, InternalJson.tree(Map.of()));
        JsonNode data = publicCommands.run(command,
                () -> users.getCallerForUpdate(userId),
                ignored -> requireHost(userId, islandId),
                () -> place(userId, islandId)).value().data();
        return InternalJson.decode(data, IslandPromotionViews.Created.class);
    }

    private PublicCommandResult place(UUID userId, UUID islandId) {
        membershipLocks.lockGroup(islandId);
        requireHost(userId, islandId);
        // «오늘» 은 KST 날짜다(계약 §0). 이 키의 원장 행이 곧 «오늘 이미 신청했다» 의 증거다.
        String ledgerKey = "promotion:" + islandId + ":" + LocalDate.now(clock.withZone(ZonePolicy.KST));
        if (ledger.existsByIslandIdAndTypeAndIdempotencyKey(
                islandId, IslandWalletTransactionType.PROMOTION_FEE, ledgerKey)) {
            throw new GroupException(GroupErrorCode.PROMOTION_ALREADY_REQUESTED_TODAY);
        }
        int balanceAfter = wallets.debitForPromotion(islandId, PROMOTION_FEE_FISH, ledgerKey);
        IslandNews item = newsItems.save(
                new IslandNews(islandId, IslandNews.KIND_PROMOTION, NEWS_BODY, clock.instant()));
        EventEnvelope walletUpdated = walletEvents.changed(islandId, userId, "PROMOTION_FEE");
        return new PublicCommandResult(201,
                InternalJson.tree(new IslandPromotionViews.Created(PROMOTION_FEE_FISH, balanceAfter, item.getId())),
                InternalJson.tree(List.of(walletUpdated)));
    }

    /**
     * 섬 소식 — 최신순 {@code limit} 건. 활성 주민만(비주민·떠난 사람은 403 {@code MEMBER_ONLY}, 닫힌 섬은 404).
     * 게스트 주민도 읽는다 — 쓰기가 아니다.
     */
    public IslandPromotionViews.NewsPage news(UUID userId, UUID islandId, int limit) {
        if (limit < 1 || limit > MAX_NEWS_LIMIT) {
            throw new GroupException(GroupErrorCode.INVALID_PAGE_REQUEST);
        }
        User caller = users.getCaller(userId);
        Group island = groups.getGroup(islandId);
        IslandMovementGuards.requireAlive(island);
        groups.getMembership(caller, island);
        return new IslandPromotionViews.NewsPage(
                newsItems.findByIslandIdOrderByCreatedAtDescIdDesc(islandId, PageRequest.of(0, limit)).stream()
                        .map(row -> new IslandPromotionViews.NewsItem(
                                row.getId(), row.getKind(), row.getBody(), row.getCreatedAt()))
                        .toList());
    }

    /** 살아 있는 섬의 현재 섬장 — 비주민도 «섬장이 아니다» 라 {@code NOT_OWNER} 다(방명록 삭제·섬 관리와 같다). */
    private void requireHost(UUID userId, UUID islandId) {
        User caller = users.getCaller(userId);
        Group island = groups.getGroup(islandId);
        IslandMovementGuards.requireAlive(island);
        groups.findMembership(caller, island)
                .filter(member -> member.getRole() == GroupMemberRole.OWNER)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_OWNER));
    }
}
