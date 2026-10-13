package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.appearance.repository.OwnedProductRepository;
import com.oneorthree.phone.appearance.repository.domain.CatalogAsset;
import com.oneorthree.phone.common.support.BannedWords;
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
import com.oneorthree.phone.magazine.exception.MagazineErrorCode;
import com.oneorthree.phone.magazine.exception.MagazineException;
import com.oneorthree.phone.magazine.repository.IslandPromotionRepository;
import com.oneorthree.phone.magazine.repository.MagazineAssetMetaRepository;
import com.oneorthree.phone.magazine.repository.domain.IslandPromotion;
import com.oneorthree.phone.magazine.repository.domain.MagazineAssetMeta;
import com.oneorthree.phone.magazine.support.MagazineCalendar;
import com.oneorthree.phone.magazine.support.PromotionContent;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 고양이 잡지 홍보 칸과 섬 소식 (GROMO-2267 · GROMO-2289, 섬 외부 계약 §7 · 잡지 구현 계획 §3-2~3-5) — 섬장이 글·틀·
 * 스티커로 꾸민 칸을 다음 날 호에 신청하면 섬 통장에서 60마리를 빼고, 칸을 저장하고, 주민 전원이 읽는 섬 소식 한 줄을
 * 남긴다. 신청 창 안에서는 고칠 수 있고, 쓰기 화면은 이 섬의 다음 호 칸이나 지난번에 실은 칸으로 연다. 꾸미기 재료
 * 목록도 여기서 내려 준다 — 신청 검증과 같은 카탈로그 판정을 쓰기 때문이다.
 *
 * <h2>신청 창 — 하루 한 번, 다음 날 호에만</h2>
 * KST 07:00~24:00 에만 신청·고치기가 된다({@link MagazineCalendar}). 실릴 호는 신청한 KST 날 + 1 이다. 00시가 지나면
 * 그 호의 칸은 글·틀·스티커 모두 굳는다(10/14 확정 — 운영 사전 검토가 없어 글과 꾸미기를 나눌 이유가 없다).
 *
 * <h2>신청 — 한 TX, 두 겹의 멱등</h2>
 * 앱 명령 키({@code Idempotency-Key})의 같은 키·같은 본문은 상점 구매와 같은 {@link PublicCommandService} 가 원 201 을
 * 재생하고, 같은 키·다른 본문은 409 {@code IDEMPOTENCY_KEY_REUSED} 다(의미 요청에 본문을 싣는다). 다른 키로 같은 호에
 * 또 신청하면 «호 키» {@code promotion:<섬 id>:<호 날짜>} 의 원장 행이 이미 있어 409
 * {@code PROMOTION_ALREADY_REQUESTED_TODAY} 다 — 이 키가 지갑 유니크 제약(섬, 사유, 키)이고, 홍보 칸의
 * {@code UNIQUE (island_id, issue_date)} 와 함께 이중 차감의 최후 방어선이 된다. 실패(창 밖·비공개·이미·검증·부족)는
 * receipt 도 차감도 칸도 남기지 않는다.
 *
 * <h2>판정 순서 — 싼 검사 → 잠금 → 돈</h2>
 * 게스트(컨트롤러) → 기능 스위치 → 유저(배타) → 섬(groups 배타) → 섬 살아 있음 → 섬장 → 비공개 → 신청 창 → 이 호에 이미
 * → 글·배치·보유 → 지갑(배타) 차감 → 칸·소식·지갑 사건. 섬 잠금이 «이 호에 이미 신청했나» 판정과 차감을 섬 단위로
 * 직렬화한다 — 섬장이 위임으로 바뀌는 날 두 사람이 동시에 신청해도 한 건만 통과한다.
 *
 * <h2>재료 보유 — 세 갈래</h2>
 * 칸에 쓴 재료는 ① 퇴역하지 않은 무료 재료(지금 에셋 전부, 10/14 확정) ② 섬장 개인 보유({@code owned_products}, 앞으로의
 * 바다 시즌 재료) ③ 이 섬의 직전 칸에 이미 있던 것 — 그 칸에 있던 장수까지 — 중 하나여야 한다. ③은 정본 134행 「섬장이
 * 더는 갖고 있지 않은 것도 그 칸의 일부로 남는다」이고, 장수 상한이 갖지 않은 스티커 한 장을 열 장으로 늘리는 것을 막는다.
 * 섬장이 바뀌어도 새 섬장이 불러온 칸을 그대로 실을 수 있다(계획 P27).
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
    private final IslandPromotionRepository promotions;
    private final MagazineAssetMetaRepository assetMetas;
    private final OwnedProductRepository ownedProducts;
    private final BannedWords bannedWords;
    private final Clock clock;

    /** 기능 스위치 — 꺼져 있으면 신청·고치기가 receipt·잠금보다 먼저 503 {@code MAGAZINE_NOT_READY} 다. 읽기는 막지 않는다. */
    @Value("${magazine.enabled:false}")
    private boolean enabled;

    /**
     * 홍보 신청 — 섬장만(비주민·일반 주민은 403 {@code NOT_OWNER}). 같은 키·같은 요청의 재생도 <b>지금</b> 섬장이어야
     * 원 결과를 돌려준다(상점 구매의 재생 인가와 같은 규칙). 게스트는 컨트롤러가 이 앞에서 막는다.
     */
    @Transactional
    public IslandPromotionViews.Created promote(UUID userId, UUID islandId, UUID key, PromotionContent content) {
        requireEnabled();
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "POST:/islands/" + islandId + "/promotions", key, InternalJson.tree(content));
        JsonNode data = publicCommands.run(command,
                () -> users.getCallerForUpdate(userId),
                ignored -> requireHost(userId, islandId),
                () -> place(userId, islandId, content)).value().data();
        return InternalJson.decode(data, IslandPromotionViews.Created.class);
    }

    private PublicCommandResult place(UUID userId, UUID islandId, PromotionContent content) {
        membershipLocks.lockGroup(islandId);
        Group island = requireHost(userId, islandId);
        if (island.isPrivate()) {
            throw new MagazineException(MagazineErrorCode.PROMOTION_PRIVATE_ISLAND);
        }
        Instant now = clock.instant();
        if (!MagazineCalendar.isWindowOpen(now)) {
            throw new MagazineException(MagazineErrorCode.PROMOTION_WINDOW_CLOSED);
        }
        LocalDate issueDate = MagazineCalendar.windowIssueDate(now);
        // 이 키의 원장 행이 곧 «이 호에 이미 신청했다» 의 증거다 — 「하루 한 번」 과 신청 창이 같은 호 날짜를 본다.
        String ledgerKey = "promotion:" + islandId + ":" + issueDate;
        if (ledger.existsByIslandIdAndTypeAndIdempotencyKey(
                islandId, IslandWalletTransactionType.PROMOTION_FEE, ledgerKey)) {
            throw new GroupException(GroupErrorCode.PROMOTION_ALREADY_REQUESTED_TODAY);
        }
        PromotionContent valid = validate(userId, content, retainedAssets(previous(islandId, issueDate)));
        int balanceAfter = wallets.debitForPromotion(islandId, PROMOTION_FEE_FISH, ledgerKey);
        IslandPromotion promotion = promotions.save(new IslandPromotion(islandId, issueDate, userId, valid, now));
        IslandNews item = newsItems.save(new IslandNews(islandId, IslandNews.KIND_PROMOTION, NEWS_BODY, now));
        EventEnvelope walletUpdated = walletEvents.changed(islandId, userId, "PROMOTION_FEE");
        return new PublicCommandResult(201,
                InternalJson.tree(new IslandPromotionViews.Created(promotion.getId(), issueDate, PROMOTION_FEE_FISH,
                        balanceAfter, item.getId())),
                InternalJson.tree(List.of(walletUpdated)));
    }

    /**
     * 홍보 고치기 — 섬장만, 그 홍보의 신청 창(전날 07시~24시) 안에서만(밖이면 409 {@code PROMOTION_LOCKED}). 돈은 다시
     * 빼지 않고 지면 순서({@code applied_at})도 그대로다. PUT 이라 같은 내용을 여러 번 보내도 결과가 같다 — 명령 키가 없다.
     * 비공개 여부는 보지 않는다 — 신청 뒤 비공개로 바뀐 섬의 칸은 발행·읽기가 뺀다(SAFE-03).
     */
    @Transactional
    public IslandPromotionViews.Updated update(UUID userId, UUID islandId, UUID promotionId,
                                               PromotionContent content) {
        requireEnabled();
        membershipLocks.lockGroup(islandId);
        requireHost(userId, islandId);
        IslandPromotion promotion = promotions.findByIdAndIslandId(promotionId, islandId)
                .orElseThrow(() -> new MagazineException(MagazineErrorCode.PROMOTION_NOT_FOUND));
        Instant now = clock.instant();
        if (!MagazineCalendar.isWindowOpen(now)
                || !MagazineCalendar.windowIssueDate(now).equals(promotion.getIssueDate())) {
            throw new MagazineException(MagazineErrorCode.PROMOTION_LOCKED);
        }
        // 고치는 칸 자신에 이미 있던 재료도 «직전 칸» 처럼 남길 수 있다 — 불러온 칸을 신청한 뒤 다시 고치는 경우다.
        Map<String, Integer> retained = retainedAssets(previous(islandId, promotion.getIssueDate()));
        PromotionContent.assetCounts(promotion.getLayout())
                .forEach((assetId, count) -> retained.merge(assetId, count, Math::max));
        PromotionContent valid = validate(userId, content, retained);
        promotion.edit(valid, now);
        return new IslandPromotionViews.Updated(promotion.getId(), promotion.getIssueDate(), valid.body(),
                valid.layout(), now);
    }

    /**
     * 쓰기 화면 불러오기 — 섬장만(게스트 섬장은 컨트롤러가 403 {@code SOCIAL_LOGIN_REQUIRED} 로 막아 꾸민 뒤에 막히지
     * 않게 한다). {@code next} 는 아직 발행되지 않은 이 섬의 칸, {@code latest} 는 그보다 앞선 가장 최근 칸이다.
     */
    public IslandPromotionViews.Editor editor(UUID userId, UUID islandId) {
        Group island = requireHost(userId, islandId);
        Instant now = clock.instant();
        boolean open = MagazineCalendar.isWindowOpen(now);
        LocalDate windowIssue = MagazineCalendar.windowIssueDate(now);
        LocalDate upcoming = MagazineCalendar.upcomingIssueDate(now);
        IslandPromotionViews.Next next = promotions.findByIslandIdAndIssueDate(islandId, upcoming)
                .map(p -> new IslandPromotionViews.Next(p.getId(), p.getIssueDate(), p.getBody(), p.getLayout(),
                        p.getAppliedAt(), open && p.getIssueDate().equals(windowIssue)))
                .orElse(null);
        IslandPromotionViews.Latest latest = previous(islandId, upcoming)
                .map(p -> new IslandPromotionViews.Latest(p.getId(), p.getIssueDate(),
                        p.isRemoved() ? "" : p.getBody(), p.getLayout()))
                .orElse(null);
        return new IslandPromotionViews.Editor(
                new IslandPromotionViews.Window(open, windowIssue, MagazineCalendar.opensAt(windowIssue),
                        MagazineCalendar.closesAt(windowIssue)),
                next, latest, PROMOTION_FEE_FISH, wallets.balanceOf(islandId), island.isPrivate());
    }

    /**
     * 꾸미기 재료 목록 — 로그인한 누구나(게스트도 본다). {@code owned} 는 퇴역하지 않은 무료 재료이거나 보유 행이 있는
     * 것이고, 퇴역한 재료는 보유 행이 있을 때만 목록에 남는다.
     */
    public IslandPromotionViews.Assets assets(UUID userId) {
        users.getCaller(userId);
        List<MagazineAssetMeta> catalog = assetMetas.findAll(Sort.by("sortOrder", "productId"));
        Set<String> owned = ownedOf(userId, catalog.stream().map(MagazineAssetMeta::getProductId).toList());
        List<IslandPromotionViews.Asset> frames = new ArrayList<>();
        List<IslandPromotionViews.Sticker> stickers = new ArrayList<>();
        List<IslandPromotionViews.Asset> tapes = new ArrayList<>();
        for (MagazineAssetMeta meta : catalog) {
            boolean hasRow = owned.contains(meta.getProductId());
            if (meta.getRetiredAt() != null && !hasRow) {
                continue;
            }
            boolean usable = meta.isFreeForAll() || hasRow;
            switch (meta.getKind()) {
                case CatalogAsset.KIND_AD_FRAME ->
                        frames.add(new IslandPromotionViews.Asset(meta.getProductId(), meta.getBundle(), usable));
                case CatalogAsset.KIND_AD_STICKER -> stickers.add(new IslandPromotionViews.Sticker(
                        meta.getProductId(), meta.getDrawerTab(), meta.getBundle(), usable));
                default -> tapes.add(new IslandPromotionViews.Asset(meta.getProductId(), meta.getBundle(), usable));
            }
        }
        return new IslandPromotionViews.Assets(frames, stickers, tapes);
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

    /**
     * 글·배치 모양 → 금칙어 → 재료 종류 → 보유. 카탈로그에 없거나 자리에 맞지 않는 종류의 재료는 400
     * {@code PROMOTION_LAYOUT_INVALID}, 쓸 수 없는 재료는 403 {@code PROMOTION_ASSET_NOT_OWNED} 다.
     *
     * @param retained 직전 칸에 있던 재료 id → 장수 — 그 장수까지는 보유와 무관하게 다시 실을 수 있다
     */
    private PromotionContent validate(UUID userId, PromotionContent content, Map<String, Integer> retained) {
        PromotionContent valid = content.validated();
        bannedWords.requireClean(valid.body());
        PromotionContent.Layout layout = valid.layout();
        // ponytail: 수십 행짜리 운영 카탈로그를 통째로 읽어 메모리에서 찾는다. 수천 행이 되면 쓰인 id 만 IN 으로 읽는다.
        Map<String, MagazineAssetMeta> catalog = assetMetas.findAll().stream()
                .collect(Collectors.toMap(MagazineAssetMeta::getProductId, Function.identity()));
        requireKind(catalog, layout.frameId(), CatalogAsset.KIND_AD_FRAME);
        layout.stickers().forEach(sticker -> requireKind(catalog, sticker.assetId(), CatalogAsset.KIND_AD_STICKER));
        if (layout.tape() != null) {
            requireKind(catalog, layout.tape().assetId(), CatalogAsset.KIND_AD_TAPE);
        }
        Map<String, Integer> counts = PromotionContent.assetCounts(layout);
        Set<String> owned = ownedOf(userId, List.copyOf(counts.keySet()));
        counts.forEach((assetId, count) -> {
            boolean usable = catalog.get(assetId).isFreeForAll() || owned.contains(assetId)
                    || retained.getOrDefault(assetId, 0) >= count;
            if (!usable) {
                throw new MagazineException(MagazineErrorCode.PROMOTION_ASSET_NOT_OWNED);
            }
        });
        return valid;
    }

    private static void requireKind(Map<String, MagazineAssetMeta> catalog, String assetId, String kind) {
        MagazineAssetMeta meta = catalog.get(assetId);
        if (meta == null || !kind.equals(meta.getKind())) {
            throw new MagazineException(MagazineErrorCode.PROMOTION_LAYOUT_INVALID);
        }
    }

    private Set<String> ownedOf(UUID userId, List<String> productIds) {
        if (productIds.isEmpty()) {
            return new HashSet<>();
        }
        return new HashSet<>(ownedProducts.findProductIdsByUserIdAndProductIdIn(userId, productIds));
    }

    /** {@code issueDate} 호보다 앞선 이 섬의 가장 최근 칸 — 「지난번에 실은 칸」. */
    private Optional<IslandPromotion> previous(UUID islandId, LocalDate issueDate) {
        return promotions.findFirstByIslandIdAndIssueDateLessThanOrderByIssueDateDesc(islandId, issueDate);
    }

    private static Map<String, Integer> retainedAssets(Optional<IslandPromotion> previous) {
        return previous.map(p -> new HashMap<>(PromotionContent.assetCounts(p.getLayout())))
                .orElseGet(HashMap::new);
    }

    private void requireEnabled() {
        if (!enabled) {
            throw new MagazineException(MagazineErrorCode.MAGAZINE_NOT_READY);
        }
    }

    /** 살아 있는 섬의 현재 섬장 — 비주민도 «섬장이 아니다» 라 {@code NOT_OWNER} 다(방명록 삭제·섬 관리와 같다). */
    private Group requireHost(UUID userId, UUID islandId) {
        User caller = users.getCaller(userId);
        Group island = groups.getGroup(islandId);
        IslandMovementGuards.requireAlive(island);
        groups.findMembership(caller, island)
                .filter(member -> member.getRole() == GroupMemberRole.OWNER)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_OWNER));
        return island;
    }
}
