package com.oneorthree.phone.shop.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.appearance.repository.CatalogAssetRepository;
import com.oneorthree.phone.appearance.repository.OwnedProductRepository;
import com.oneorthree.phone.appearance.repository.domain.CatalogAsset;
import com.oneorthree.phone.appearance.repository.domain.OwnedProduct;
import com.oneorthree.phone.appearance.service.AppearanceEvents;
import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.domain.FacilityStatus;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.construction.service.IslandWalletEvents;
import com.oneorthree.phone.construction.service.IslandWalletService;
import com.oneorthree.phone.construction.support.SharedPurchase;
import com.oneorthree.phone.currency.repository.UserFishWalletRepository;
import com.oneorthree.phone.currency.repository.domain.UserFishWallet;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.repository.AggregateVersionRepository;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersion;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersionId;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import com.oneorthree.phone.shop.dto.ShopViews;
import com.oneorthree.phone.shop.exception.ShopErrorCode;
import com.oneorthree.phone.shop.exception.ShopException;
import com.oneorthree.phone.shop.repository.ShopCatalogActivePublicationRepository;
import com.oneorthree.phone.shop.repository.ShopCatalogPublicationEntryRepository;
import com.oneorthree.phone.shop.repository.ShopCatalogPublicationRepository;
import com.oneorthree.phone.shop.repository.ShopOrderRepository;
import com.oneorthree.phone.shop.repository.ShopProductRevisionRepository;
import com.oneorthree.phone.shop.repository.domain.ShopCatalogActivePublication;
import com.oneorthree.phone.shop.repository.domain.ShopCatalogPublicationEntry;
import com.oneorthree.phone.shop.repository.domain.ShopCatalogPublicationEntryId;
import com.oneorthree.phone.shop.repository.domain.ShopOrder;
import com.oneorthree.phone.shop.repository.domain.ShopProductRevision;
import com.oneorthree.phone.shop.repository.domain.ShopProductRevisionId;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 섬 상점 (GROMO-1781, island-shop LLD §2·§4) — 지갑·카탈로그·상품 상세·구매·내역 다섯 계약의 Data 측 구현이다.
 *
 * <p><b>데이터만 넣으면 동작한다(2026-09-19 결정 N24·N25).</b> 시드·가격을 코드에 두지 않는다 — 활성 발행본이
 * 없으면 목록은 빈 배열, 상세·구매는 {@code PRODUCT_NOT_FOUND} 다. 가격이 NULL 인 revision 은 목록에
 * {@code available=false} 로 보이고 구매는 {@code STATE_CONFLICT} 다(정책 S03 — 0원으로 보지 않는다).
 *
 * <p><b>재화는 전부 섬 통장(SH-재화).</b> 개인 상품(옷·소품)도 섬 통장에서 빼고 개인 지갑은 건드리지 않는다.
 * 물건 주인은 불변 자산 정의의 ownerType 이다 — user 면 구매자, island 면 그 섬.
 *
 * <p><b>잠금 순서</b>(LLD §4 공통 계열): 사용자(배타) → receipt 선점 → 섬(groups 배타) → membership(공유) →
 * 카탈로그 활성 포인터(공유) → 섬 지갑(배타) → 보유 행 삽입 → aggregate_versions(사건). 섬 잠금이 같은 섬의
 * 구매·건설 차감을 직렬화하고, 사용자 잠금이 같은 사람의 개인 상품 구매를 섬을 가로질러 직렬화한다 — 그래서
 * 「이미 소유」 판정이 잠금 아래에서 최종이고 부분 유일 인덱스는 최후 방어선이다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ShopService {

    public static final Set<String> CATEGORIES = Set.of("personal", "island", "sound");
    private static final Set<String> SCOPES = Set.of("personal", "shared");
    private static final int MAX_PAGE = 100;
    private static final String REASON_FORBIDDEN = "FORBIDDEN";
    private static final String REASON_FACILITY_LOCKED = "FACILITY_LOCKED";
    private static final String REASON_STATE_CONFLICT = "STATE_CONFLICT";
    private static final String REASON_INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS";

    private final UserQueryService users;
    private final GroupQueryService groups;
    private final GroupMemberRepository members;
    private final GroupMembershipMutationLocks membershipLocks;
    private final ShopCatalogActivePublicationRepository activePublication;
    private final ShopCatalogPublicationRepository publications;
    private final ShopCatalogPublicationEntryRepository entries;
    private final ShopProductRevisionRepository revisions;
    private final ShopOrderRepository orders;
    private final CatalogAssetRepository assets;
    private final OwnedProductRepository ownedProducts;
    private final IslandFacilityRepository facilities;
    private final UserFishWalletRepository fishWallets;
    private final IslandWalletService islandWallets;
    private final IslandWalletEvents walletEvents;
    private final AppearanceEvents appearanceEvents;
    private final AggregateVersionRepository aggregateVersions;
    private final PublicCommandService publicCommands;
    private final Clock clock;

    // ---------------------------------------------------------------- GET wallets

    /** 본인 개인 지갑과 섬 통장을 한 스냅샷에서 읽는다(LLD §2.1). 활성 주민만. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ShopViews.Wallets wallets(UUID islandId, UUID userId) {
        requireResident(islandId, userId);
        int fish = fishWallets.findById(userId).map(UserFishWallet::getBalance).orElse(0);
        return new ShopViews.Wallets(fish, islandWallets.balanceOf(islandId), null, walletVersion(islandId));
    }

    // ---------------------------------------------------------------- GET products

    /**
     * 카탈로그 한 쪽(LLD §2.2). 첫 쪽({@code publicationVersion=null})은 활성 발행본을 읽고, 다음 쪽은 커서가
     * 고정한 발행본의 불변 항목을 이어 읽는다 — 그 사이 새 발행본이 활성화돼도 집합·순서가 바뀌지 않는다.
     * owned/available 은 매 요청 현재 상태로 계산한다(발행본은 목록 정의의 snapshot 일 뿐이다).
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ShopViews.ProductPage products(UUID islandId, UUID userId, String category, Long publicationVersion,
                                         Integer afterDisplayOrder, String afterProductId, int limit) {
        Resident resident = requireResident(islandId, userId);
        if (category == null || !CATEGORIES.contains(category) || limit < 1 || limit > MAX_PAGE
                || (afterDisplayOrder == null) != (afterProductId == null)
                || (afterDisplayOrder != null && publicationVersion == null)) {
            throw new ShopException(ShopErrorCode.OUT_OF_RANGE);
        }
        long version;
        if (publicationVersion == null) {
            ShopCatalogActivePublication active = activePublication.findCurrent().orElse(null);
            if (active == null) {
                // 활성 카탈로그 없음 — 오류가 아니라 빈 목록이다(N25).
                return new ShopViews.ProductPage(List.of(), null, false, null, null);
            }
            version = active.getPublicationVersion();
        } else {
            version = publicationVersion;
            if (publications.findById(version).filter(p -> p.getInvalidatedAt() == null).isEmpty()) {
                throw new ShopException(ShopErrorCode.CURSOR_EXPIRED);
            }
        }
        PageRequest page = PageRequest.of(0, limit + 1);
        List<ShopCatalogPublicationEntry> rows = afterDisplayOrder == null
                ? entries.findFirstPage(version, category, page)
                : entries.findPageAfter(version, category, afterDisplayOrder, afterProductId, page);
        boolean hasMore = rows.size() > limit;
        List<ShopCatalogPublicationEntry> shown = hasMore ? rows.subList(0, limit) : rows;

        Map<String, ShopProductRevision> revisionByProduct = revisions.findAllById(shown.stream()
                        .map(e -> new ShopProductRevisionId(e.getProductId(), e.getProductRevision())).toList())
                .stream().collect(Collectors.toMap(ShopProductRevision::getProductId, Function.identity()));
        Map<String, CatalogAsset> assetById = assetsOf(Stream.concat(
                shown.stream().map(ShopCatalogPublicationEntry::getProductId),
                revisionByProduct.values().stream().map(ShopProductRevision::getRequiredProductId)));
        Snapshot snapshot = snapshot(resident);
        List<ShopViews.Item> items = new ArrayList<>();
        for (ShopCatalogPublicationEntry entry : shown) {
            ShopProductRevision revision = revisionByProduct.get(entry.getProductId());
            CatalogAsset asset = assetById.get(entry.getProductId());
            boolean owned = snapshot.owns(asset);
            String reason = snapshot.blockedReason(revision, asset, assetById);
            items.add(new ShopViews.Item(asset.getProductId(), asset.getTitle(), asset.getKind(), revision.getPrice(),
                    revision.getCurrency(), asset.getOwnerType(), owned, reason == null, reason,
                    revision.getRevision()));
        }
        ShopCatalogPublicationEntry last = hasMore ? shown.get(shown.size() - 1) : null;
        return new ShopViews.ProductPage(items, version, hasMore,
                last == null ? null : last.getDisplayOrder(), last == null ? null : last.getProductId());
    }

    // ---------------------------------------------------------------- GET product

    /** 상품 상세(LLD §2.3) — 활성 발행본의 현재 판매 revision 기준. 없으면 {@code PRODUCT_NOT_FOUND}. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ShopViews.Product product(UUID islandId, UUID userId, String productId) {
        Resident resident = requireResident(islandId, userId);
        ShopCatalogActivePublication active = activePublication.findCurrent()
                .orElseThrow(() -> new ShopException(ShopErrorCode.PRODUCT_NOT_FOUND));
        Listing listing = listing(active, productId);
        Map<String, CatalogAsset> assetById = assetsOf(
                Stream.of(productId, listing.revision().getRequiredProductId()));
        CatalogAsset asset = assetById.get(productId);
        Snapshot snapshot = snapshot(resident);
        String reason = snapshot.blockedReason(listing.revision(), asset, assetById);
        String requiredId = listing.revision().getRequiredProductId();
        ShopViews.RequiredProduct required = requiredId == null ? null
                : new ShopViews.RequiredProduct(requiredId, assetById.get(requiredId).getTitle());
        // ponytail: previewUrl 은 서버 등록 media 호스트가 아직 없어 null 이다 — media 설정이 생기면
        // revision.previewMediaKey 로 URL 을 만든다(사용자 URL 을 받아 대신 가져오지 않는다, LLD §2.3).
        return new ShopViews.Product(productId, asset.getKind(), asset.getTitle(), listing.revision().getPrice(),
                listing.revision().getCurrency(), asset.getOwnerType(), listing.revision().getRevision(), null,
                snapshot.owns(asset), reason == null, reason, listing.revision().getRequiredBuilding(), required,
                asset.getTargetBuilding());
    }

    // ---------------------------------------------------------------- POST orders

    /**
     * 구매(LLD §2.4·§4) — 판정·차감·주문·지급·사건을 한 TX 에 확정한다. 같은 키·같은 본문은 멱등 계층이 먼저
     * 잡아 원 201 을 재생하고(현재 상품/지갑 버전 비교보다 먼저), 새 키라도 소유 유일성이 이중 차감을 막는다.
     * 실패는 receipt 를 남기지 않는다 — 잔액 부족 뒤 충전하고 새 키(또는 같은 키)로 다시 살 수 있다.
     */
    @Transactional
    public ShopViews.Order purchase(UUID islandId, UUID userId, String productId, long expectedWalletVersion,
                                    long expectedProductVersion, UUID idempotencyKey) {
        Map<String, Object> semantic = new LinkedHashMap<>();
        semantic.put("productId", productId);
        semantic.put("expectedWalletVersion", expectedWalletVersion);
        semantic.put("expectedProductVersion", expectedProductVersion);
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "POST:/islands/" + islandId + "/shop/orders", idempotencyKey, tree(semantic));
        JsonNode data = publicCommands.run(command,
                () -> users.getCallerForUpdate(userId),
                ignored -> requireSpender(islandId, userId),
                () -> placeOrder(islandId, userId, productId, expectedWalletVersion, expectedProductVersion))
                .value().data();
        return decode(data, ShopViews.Order.class);
    }

    private PublicCommandResult placeOrder(UUID islandId, UUID userId, String productId,
                                           long expectedWalletVersion, long expectedProductVersion) {
        users.getCallerForUpdate(userId);
        requireSpender(islandId, userId);

        // 활성 포인터 공유 잠금 — 발행(포인터 교체)이 이 구매 커밋까지 기다린다(LLD §4).
        ShopCatalogActivePublication active = activePublication.findCurrentForShare()
                .orElseThrow(() -> new ShopException(ShopErrorCode.PRODUCT_NOT_FOUND));
        ShopProductRevision revision = listing(active, productId).revision();
        if (revision.getRevision() != expectedProductVersion) {
            throw new ShopException(ShopErrorCode.VERSION_CONFLICT);
        }
        if (revision.getPrice() == null) {
            throw new ShopException(ShopErrorCode.STATE_CONFLICT);
        }
        if (revision.getRequiredBuilding() != null
                && !facilities.existsCompleted(islandId, revision.getRequiredBuilding())) {
            throw new ShopException(ShopErrorCode.FACILITY_LOCKED);
        }
        CatalogAsset asset = assets.findById(productId)
                .orElseThrow(() -> new IllegalStateException("판매 revision 에 자산 정의가 없습니다: " + productId));
        UUID ownerId = ownerOf(asset, islandId, userId);
        if (owns(asset.getOwnerType(), ownerId, productId)) {
            throw new ShopException(ShopErrorCode.STATE_CONFLICT);
        }
        String requiredId = revision.getRequiredProductId();
        if (requiredId != null) {
            CatalogAsset required = assets.findById(requiredId)
                    .orElseThrow(() -> new IllegalStateException("선행 상품 정의가 없습니다: " + requiredId));
            if (!owns(required.getOwnerType(), ownerOf(required, islandId, userId), requiredId)) {
                throw new ShopException(ShopErrorCode.STATE_CONFLICT);
            }
        }
        // 지갑 version 동의 — 섬 통장을 줄이는 경로(건설·구매)는 모두 이 섬 잠금 아래라, 여기서 읽은 version 이
        // 차감 직전까지 다른 차감으로 바뀌지 않는다. 사이에 끼는 적립(집중·퀘스트)은 잔액만 늘린다.
        if (walletVersion(islandId) != expectedWalletVersion) {
            throw new ShopException(ShopErrorCode.VERSION_CONFLICT);
        }
        // 원장 멱등 키는 (주인, 상품) — 1회 소유형이라 한 주인이 같은 상품을 두 번 살 수 없다(환불 없음, LLD §3).
        int balanceAfter = islandWallets.debitForShop(islandId, revision.getPrice(),
                        "shop:" + asset.getOwnerType() + ":" + ownerId + ":" + productId)
                .orElseThrow(() -> new ShopException(ShopErrorCode.INSUFFICIENT_FUNDS));

        EventEnvelope walletUpdated = walletEvents.changed(islandId, userId, "SHOP_PURCHASE");
        Instant now = clock.instant();
        ShopOrder order = orders.save(ShopOrder.placed(islandId, userId, asset.getOwnerType(), productId,
                revision.getRevision(), revision.getPrice(), revision.getCurrency(), walletUpdated.version(),
                balanceAfter, now));
        ownedProducts.save(OwnedProduct.granted(asset.getOwnerType(), ownerId, productId,
                order.getId().toString(), now));
        EventEnvelope inventoryUpdated = appearanceEvents.inventoryChanged(asset.getOwnerType(), ownerId, userId,
                productId);
        ShopViews.Order view = new ShopViews.Order(order.getId(), productId, revision.getPrice(),
                revision.getCurrency(), asset.getOwnerType(), true, walletUpdated.version());
        return new PublicCommandResult(201, tree(view), tree(List.of(walletUpdated, inventoryUpdated)));
    }

    // ---------------------------------------------------------------- GET orders

    /**
     * 섬 귀속 내역(LLD §2.5, BG18) — personal 은 그 섬 안의 본인 주문, shared 는 그 섬의 공동 주문이다.
     * 결제 당시 snapshot 을 그대로 돌려준다(현재 가격표와 join 하지 않는다).
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ShopViews.OrderPage orders(UUID islandId, UUID userId, String scope, Instant afterCreatedAt,
                                      UUID afterId, int limit) {
        requireResident(islandId, userId);
        if (scope == null || !SCOPES.contains(scope) || limit < 1 || limit > MAX_PAGE
                || (afterCreatedAt == null) != (afterId == null)) {
            throw new ShopException(ShopErrorCode.OUT_OF_RANGE);
        }
        PageRequest page = PageRequest.of(0, limit + 1);
        boolean personal = "personal".equals(scope);
        List<ShopOrder> rows;
        if (afterCreatedAt == null) {
            rows = personal ? orders.findPersonalFirstPage(islandId, userId, page)
                    : orders.findSharedFirstPage(islandId, page);
        } else {
            rows = personal ? orders.findPersonalPageAfter(islandId, userId, afterCreatedAt, afterId, page)
                    : orders.findSharedPageAfter(islandId, afterCreatedAt, afterId, page);
        }
        boolean hasMore = rows.size() > limit;
        return new ShopViews.OrderPage((hasMore ? rows.subList(0, limit) : rows).stream()
                .map(o -> new ShopViews.OrderItem(o.getId(), o.getProductId(), o.getPaidPrice(), o.getCurrency(),
                        o.getCreatedAt()))
                .toList(), hasMore);
    }

    // ---------------------------------------------------------------- 판정

    /** 조회 시점 안내용 현재 상태 — 구매 허가증이 아니다(LLD §2.2). 구매 TX 는 잠금 아래 다시 판정한다. */
    private Snapshot snapshot(Resident resident) {
        UUID islandId = resident.island().getId();
        Set<String> completed = new HashSet<>();
        for (IslandFacility facility : facilities.findByIslandId(islandId)) {
            if (facility.getStatus() == FacilityStatus.COMPLETED) {
                completed.add(facility.getBuildingId());
            }
        }
        Set<String> userOwned = ownedProducts.findByUserId(resident.userId()).stream()
                .map(OwnedProduct::getProductId).collect(Collectors.toSet());
        Set<String> islandOwned = ownedProducts.findByIslandId(islandId).stream()
                .map(OwnedProduct::getProductId).collect(Collectors.toSet());
        return new Snapshot(SharedPurchase.canSpend(resident.caller(), resident.member()), completed, userOwned,
                islandOwned, islandWallets.balanceOf(islandId));
    }

    /**
     * 조회 판정 스냅샷. 사유 우선순위는 구매 TX 의 검사 순서와 같다:
     * FORBIDDEN → STATE_CONFLICT(가격 미승인) → FACILITY_LOCKED → STATE_CONFLICT(이미 소유·선행 미보유) →
     * INSUFFICIENT_FUNDS.
     */
    private record Snapshot(boolean canSpend, Set<String> completed, Set<String> userOwned, Set<String> islandOwned,
                            int balance) {

        boolean owns(CatalogAsset asset) {
            return (CatalogAsset.OWNER_USER.equals(asset.getOwnerType()) ? userOwned : islandOwned)
                    .contains(asset.getProductId());
        }

        String blockedReason(ShopProductRevision revision, CatalogAsset asset, Map<String, CatalogAsset> assetById) {
            if (!canSpend) {
                return REASON_FORBIDDEN;
            }
            if (revision.getPrice() == null) {
                return REASON_STATE_CONFLICT;
            }
            if (revision.getRequiredBuilding() != null && !completed.contains(revision.getRequiredBuilding())) {
                return REASON_FACILITY_LOCKED;
            }
            if (owns(asset)) {
                return REASON_STATE_CONFLICT;
            }
            String requiredId = revision.getRequiredProductId();
            if (requiredId != null && !owns(assetById.get(requiredId))) {
                return REASON_STATE_CONFLICT;
            }
            return balance < revision.getPrice() ? REASON_INSUFFICIENT_FUNDS : null;
        }
    }

    /** 활성 발행본의 이 상품 항목과 판매 revision — 없으면 {@code PRODUCT_NOT_FOUND}(field=productId). */
    private Listing listing(ShopCatalogActivePublication active, String productId) {
        ShopCatalogPublicationEntry entry = entries.findById(
                        new ShopCatalogPublicationEntryId(active.getPublicationVersion(), productId))
                .orElseThrow(() -> new ShopException(ShopErrorCode.PRODUCT_NOT_FOUND));
        ShopProductRevision revision = revisions.findById(
                        new ShopProductRevisionId(productId, entry.getProductRevision()))
                .orElseThrow(() -> new IllegalStateException("발행본 항목의 revision 이 없습니다: " + productId));
        return new Listing(entry, revision);
    }

    private record Listing(ShopCatalogPublicationEntry entry, ShopProductRevision revision) {
    }

    private Map<String, CatalogAsset> assetsOf(Stream<String> productIds) {
        return assets.findAllById(productIds.filter(id -> id != null).distinct().toList()).stream()
                .collect(Collectors.toMap(CatalogAsset::getProductId, Function.identity()));
    }

    /** 물건 주인 — 불변 자산 정의의 ownerType 이 정한다(user 면 구매자, island 면 경로 섬). */
    private static UUID ownerOf(CatalogAsset asset, UUID islandId, UUID userId) {
        return CatalogAsset.OWNER_USER.equals(asset.getOwnerType()) ? userId : islandId;
    }

    private boolean owns(String ownerType, UUID ownerId, String productId) {
        return CatalogAsset.OWNER_USER.equals(ownerType)
                ? ownedProducts.existsByUserIdAndProductId(ownerId, productId)
                : ownedProducts.existsByIslandIdAndProductId(ownerId, productId);
    }

    // ---------------------------------------------------------------- 공통 가드

    /** {@code caller} 는 구매 권한의 게스트 축을 보려고 싣는다 — 조회 사유와 명령 거절이 같은 값을 읽어야 한다. */
    private record Resident(UUID userId, User caller, Group island, GroupMember member) {
    }

    /** 읽기 가드 — 살아 있는 섬의 활성 주민만. 비주민은 {@code MEMBER_ONLY}, 없는·끝난 섬은 {@code GROUP_NOT_FOUND}. */
    private Resident requireResident(UUID islandId, UUID userId) {
        User viewer = users.getCaller(userId);
        Group island = groups.findGroup(islandId).filter(ShopService::isAlive)
                .orElseThrow(() -> new GroupException(GroupErrorCode.GROUP_NOT_FOUND));
        GroupMember member = members.findByUserAndGroup(viewer, island)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        return new Resident(userId, viewer, island, member);
    }

    /**
     * 쓰기·재생 가드 — 섬 배타 잠금 → 활성 주민(공유 잠금) → 지출 권한(SHARED_PURCHASE).
     * 지출 권한은 「주민 누구나 섬 물고기로 상점 상품·축음기 음원을 구매할 수 있다」라 활성 주민
     * 전원이다(GROMO-2000) — 방장만인 «건설»과 갈린다. 재생도 같은 검사를 거쳐 강퇴 뒤 옛 권한을
     * 되살리지 않는다(건설과 같은 규율).
     */
    private void requireSpender(UUID islandId, UUID userId) {
        User caller = users.getCaller(userId);
        membershipLocks.lockGroup(islandId);
        Group island = groups.getGroup(islandId);
        if (!isAlive(island)) {
            throw new GroupException(GroupErrorCode.GROUP_NOT_FOUND);
        }
        GroupMember member = members.findActiveByUserIdAndGroupIdForShare(userId, islandId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        // 구매 권한의 «단일 자리» — 목록의 항목별 사유(Snapshot#canSpend)가 읽는 것과 같은 판정이다.
        // 한쪽만 좁히면 앱이 열어 둔 구매 버튼을 눌렀을 때 403 이 나는 어긋남이 생긴다.
        if (!SharedPurchase.canSpend(caller, member)) {
            throw new ShopException(ShopErrorCode.SHOP_FORBIDDEN);
        }
    }

    private static boolean isAlive(Group island) {
        return island.getDeletedAt() == null && island.getStatus() != GroupStatus.ENDED;
    }

    /** 섬 통장 version — wallet.updated 축(ISLAND_WALLET)의 마지막 발급값, 없으면 0(건설 응답과 같은 값). */
    private long walletVersion(UUID islandId) {
        return aggregateVersions.findById(new AggregateVersionId(IslandWalletEvents.AGGREGATE_TYPE,
                        islandId.toString()))
                .map(AggregateVersion::getLastVersion)
                .orElse(0L);
    }

    // ---------------------------------------------------------------- 멱등 코덱

    private static JsonNode tree(Object value) {
        try {
            return OutboxEnvelopeCodec.fromJson(OutboxEnvelopeCodec.toJson(value), JsonNode.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("상점 명령 직렬화 실패", e);
        }
    }

    private static <T> T decode(JsonNode data, Class<T> type) {
        try {
            return OutboxEnvelopeCodec.fromJson(data.toString(), type);
        } catch (JsonProcessingException e) {
            throw new OutboxException(OutboxErrorCode.IDEMPOTENT_REPLAY_FAILED);
        }
    }
}
