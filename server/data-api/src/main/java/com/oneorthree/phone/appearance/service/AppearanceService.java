package com.oneorthree.phone.appearance.service;

import static com.oneorthree.phone.appearance.service.AppearanceEvents.AGGREGATE_ISLAND_INVENTORY;
import static com.oneorthree.phone.appearance.service.AppearanceEvents.AGGREGATE_USER_INVENTORY;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.oneorthree.phone.appearance.dto.AppearanceCommandView;
import com.oneorthree.phone.appearance.dto.IslandAppearanceView;
import com.oneorthree.phone.appearance.dto.PersonalAppearanceView;
import com.oneorthree.phone.appearance.dto.PersonalInventoryView;
import com.oneorthree.phone.appearance.dto.SharedInventoryView;
import com.oneorthree.phone.appearance.exception.AppearanceErrorCode;
import com.oneorthree.phone.appearance.exception.AppearanceException;
import com.oneorthree.phone.appearance.repository.CatalogAssetRepository;
import com.oneorthree.phone.appearance.repository.IslandAppearanceRepository;
import com.oneorthree.phone.appearance.repository.OwnedProductRepository;
import com.oneorthree.phone.appearance.repository.PersonalAppearanceRepository;
import com.oneorthree.phone.appearance.repository.domain.CatalogAsset;
import com.oneorthree.phone.appearance.repository.domain.IslandAppearance;
import com.oneorthree.phone.appearance.repository.domain.OwnedProduct;
import com.oneorthree.phone.appearance.repository.domain.PersonalAppearance;
import com.oneorthree.phone.common.port.IslandAppearancePort;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.outbox.dto.PublicCommandReceipt;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.repository.AggregateVersionRepository;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersion;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersionId;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import java.time.Clock;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 외양 도메인 — 개인 인벤토리/외양과 공동 인벤토리/외양의 네 계약을 한 서비스가 처리한다
 * (island-appearance LLD). 개인 축과 섬 축은 별개 행·별개 버전이다.
 *
 * <p>잠금 순서 — caller → receipt(command_outbox) → (섬: groups → membership(ForShare)) →
 * 카탈로그 정의(불변, 잠금 없는 읽기) → 제출 상품의 보유 행(ForShare) → 외양 행(ForUpdate).
 * 보유 행을 외양 행보다 먼저 공유로 잡아 두므로, 보유 행을 지우고 외양을 해제하는 회수 writer 와
 * 같은 순서로 줄을 서며(교착 없음) 회수가 방금 장착한 상품을 놓치는 stale-equip 창이 닫힌다.
 * 권한(멤버십 공유 잠금)은 커밋까지 유지되어 검사 후 방장 이양이 끼어드는 TOCTOU 도 없다.
 * 외양 행 잠금 뒤의 보유 확인(미제출 기존 값 재검증)은 잠금 없는 읽기다 — 역순 잠금을 만들지 않는다.
 * 변경과 사건은 같은 TX 에 쓰고, 버전은 잠긴 행이 직접 올린다 — 행 잠금이 곧 버전 발급 직렬화다.
 *
 * <p>PATCH 의 fields/values 캐리어는 tri-state(미제출·null·값)를 잃지 않고 내부 계약을
 * 통과시키는 장치다. 필드명 대소문자·공백 차이는 다른 의미 객체로 새 명령이 되므로 400 이다.
 */
@Service
@RequiredArgsConstructor
public class AppearanceService implements IslandAppearancePort {

    /** 개인 PATCH 에 허용되는 필드 집합 — 미제출 필드는 현재 값을 유지한다. */
    private static final Set<String> PERSONAL_FIELDS = Set.of("clothes", "decor", "hull", "position");
    /** 공동 PATCH 에 허용되는 필드 집합 — expectedVersion 은 캐리어 밖 별도 계약이다. */
    private static final Set<String> ISLAND_FIELDS = Set.of("islandThemeId", "buildingThemes");

    private final UserQueryService userQueryService;
    private final GroupQueryService groupQueryService;
    private final GroupMemberRepository groupMemberRepository;
    private final CatalogAssetRepository catalogAssets;
    private final OwnedProductRepository ownedProducts;
    private final PersonalAppearanceRepository personalAppearances;
    private final IslandAppearanceRepository islandAppearances;
    private final PublicCommandService publicCommands;
    private final AggregateVersionRepository aggregateVersions;
    private final AppearanceEvents events;
    private final Clock clock;

    // ---------------------------------------------------------------- GET /me/inventory

    /**
     * 개인 인벤토리 — ownerType=user 인 소유 상품을 kind 별로 나눠 productId 오름차순으로 돌려준다.
     * hulls 는 소유권 테이블이 아니라 상수 ["raft"] 다(유료 선체 폐지 — GROMO-1851).
     * REPEATABLE_READ 는 잔액·시설 스냅샷과 같은 이유다 — 목록과 equipped 가 같은 시점이어야 한다.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PersonalInventoryView myInventory(UUID userId) {
        userQueryService.getCaller(userId);
        List<OwnedProduct> owned = ownedProducts.findByUserId(userId);
        Map<String, CatalogAsset> assets = assetsOf(owned);
        List<String> clothes = new ArrayList<>();
        List<String> decor = new ArrayList<>();
        for (OwnedProduct p : owned) {
            CatalogAsset asset = assets.get(p.getProductId());
            if (asset == null) {
                continue;   // 카탈로그 정합성 오류는 조회에서 숨기지 말고 건너뛴다 — 보유 행이 정본
            }
            switch (asset.getKind()) {
                case CatalogAsset.KIND_CLOTHES -> clothes.add(p.getProductId());
                case CatalogAsset.KIND_DECOR -> decor.add(p.getProductId());
                default -> { }   // 개인 슬롯이 아닌 종류는 개인 인벤토리에 노출하지 않는다
            }
        }
        return new PersonalInventoryView(clothes, decor, List.of(PersonalAppearance.HULL_RAFT),
                inventoryVersion(AGGREGATE_USER_INVENTORY, userId),
                personalView(personalAppearances.findById(userId).orElse(null)));
    }

    // ---------------------------------------------------------------- PATCH /me/appearance

    /**
     * 개인 외양 적용 — 멱등 명령 계층(PublicCommandService)이 receipt 선점·재생을 담당하고,
     * command 본체가 병합 상태를 잠금 아래 검증·적용한다. 값 검증은 command 안에서 하므로
     * 실패 명령은 receipt 를 남기지 않는다(재시도가 다른 결과를 낼 수 있는 입력은 매번 재검증).
     */
    @Transactional
    public AppearanceCommandView<PersonalAppearanceView> patchMine(UUID userId, UUID idempotencyKey,
                                                                   List<String> fields,
                                                                   Map<String, Object> values) {
        requireCarrier(fields, values, PERSONAL_FIELDS);
        PublicCommandRequest command = new PublicCommandRequest(userId, "PATCH:/me/appearance",
                idempotencyKey, semantic(values));
        PublicCommandReceipt receipt = publicCommands.run(command,
                () -> userQueryService.getCallerForUpdate(userId),
                ignored -> userQueryService.getCallerForUpdate(userId),
                () -> applyPersonal(userId, values)).value();
        return new AppearanceCommandView<>(
                decode(receipt.data(), PersonalAppearanceView.class), receiptEvents(receipt));
    }

    // ---------------------------------------------------------------- GET /islands/{id}/inventory

    /** 공동 인벤토리 — 활성 주민만 본다. 비주민은 MEMBER_ONLY(403)다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public SharedInventoryView islandInventory(UUID islandId, UUID userId) {
        User viewer = userQueryService.getCaller(userId);
        Group island = aliveIsland(islandId);
        groupMemberRepository.findByUserAndGroup(viewer, island)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        List<OwnedProduct> owned = ownedProducts.findByIslandId(islandId);
        Map<String, CatalogAsset> assets = assetsOf(owned);
        List<String> audio = new ArrayList<>();
        List<String> islandThemes = new ArrayList<>();
        List<SharedInventoryView.BuildingThemeItem> buildingThemes = new ArrayList<>();
        for (OwnedProduct p : owned) {
            CatalogAsset asset = assets.get(p.getProductId());
            if (asset == null) {
                continue;
            }
            switch (asset.getKind()) {
                case CatalogAsset.KIND_AUDIO -> audio.add(p.getProductId());
                case CatalogAsset.KIND_ISLAND_THEME -> islandThemes.add(p.getProductId());
                case CatalogAsset.KIND_BUILDING_THEME -> buildingThemes.add(
                        new SharedInventoryView.BuildingThemeItem(
                                asset.getTargetBuilding(), p.getProductId()));
                default -> { }
            }
        }
        buildingThemes.sort(Comparator.comparing(SharedInventoryView.BuildingThemeItem::buildingId));
        return new SharedInventoryView(audio, islandThemes, buildingThemes,
                inventoryVersion(AGGREGATE_ISLAND_INVENTORY, islandId),
                islandView(islandAppearances.findById(islandId).orElse(null)));
    }

    // ---------------------------------------------------------------- PATCH /islands/{id}/appearance

    /**
     * 공동 외양 적용 — SHARED_APPEARANCE 권한(방장)만 쓴다. 비주민은 MEMBER_ONLY, 비방장 주민은
     * NOT_OWNER — 둘 다 공개 계약의 FORBIDDEN 으로 올라간다. expectedVersion 은 잠긴 행의 현재
     * 버전과 비교한다 — receipt 충돌 검사(다른 body 같은 키)와 낙관 버전 검사는 별개 실패다.
     */
    @Transactional
    public AppearanceCommandView<IslandAppearanceView> patchIsland(UUID islandId, UUID userId,
                                                                   UUID idempotencyKey,
                                                                   List<String> fields,
                                                                   Map<String, Object> values,
                                                                   Long expectedVersion) {
        requireCarrier(fields, values, ISLAND_FIELDS);
        if (expectedVersion == null) {
            throw new AppearanceException(AppearanceErrorCode.INVALID_REQUEST);
        }
        ObjectNode semantic = semantic(values);
        semantic.put("expectedVersion", expectedVersion);
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "PATCH:/islands/" + islandId + "/appearance", idempotencyKey, semantic);
        PublicCommandReceipt receipt = publicCommands.run(command,
                () -> userQueryService.getCallerForUpdate(userId),
                ignored -> requireReplayPermission(islandId, userId),
                () -> applyIsland(islandId, userId, values, expectedVersion)).value();
        return new AppearanceCommandView<>(
                decode(receipt.data(), IslandAppearanceView.class), receiptEvents(receipt));
    }

    // ---------------------------------------------------------------- 시설 완공 훅

    /**
     * 완공으로 외양 대상이 된 건물을 공동 외양 전체 맵에 추가한다 — "default" 로 시드되고
     * 버전이 올라 island.appearance.updated 가 나간다(LLD §6 완공 writer). 호출자 TX 에 붙는다.
     */
    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void buildingCompleted(UUID islandId, String buildingId, UUID actorId) {
        islandAppearances.insertIfAbsent(islandId);
        IslandAppearance appearance = islandAppearances.findByIdForUpdate(islandId)
                .orElseThrow(() -> new IllegalStateException("섬 외양을 만들 직후에 찾지 못했습니다."));
        if (appearance.addBuilding(buildingId, clock.instant())) {
            events.islandChanged(islandId, actorId, appearance);
        }
    }

    // ---------------------------------------------------------------- 개인 명령 본체

    /**
     * 제출 값 해석 → 제출 상품의 카탈로그 정의·보유(공유 잠금) → 외양 행 잠금 → 병합 순서다.
     * 병합 상태 전체를 검증한다 — 미제출 필드의 기존 값도 새 상태의 일부이므로 보유·종류 검증에서
     * 빼면 이미 장착한 상품을 근거로 한 우회가 생긴다(문서의 merged-state 규칙). 기존 값은 외양 행
     * 잠금 뒤에야 알 수 있으므로 잠금 없는 읽기로 재검증한다 — 회수 writer 는 외양 행을 늦게 잡아
     * 기존 장착을 스스로 해제하므로 이 읽기에 잠금이 필요 없다.
     */
    private PublicCommandResult applyPersonal(UUID userId, Map<String, Object> values) {
        userQueryService.getCallerForUpdate(userId);

        boolean hasClothes = values.containsKey("clothes");
        boolean hasDecor = values.containsKey("decor");
        String clothesIn = hasClothes ? nullableSlot(values.get("clothes")) : null;
        String decorIn = hasDecor ? nullableSlot(values.get("decor")) : null;
        String hullIn = values.containsKey("hull") ? hullValue(values.get("hull")) : null;
        String positionIn = values.containsKey("position") ? positionValue(values.get("position")) : null;

        if (hasClothes) {
            requirePersonalProduct(userId, clothesIn, CatalogAsset.KIND_CLOTHES, true);
        }
        if (hasDecor) {
            requirePersonalProduct(userId, decorIn, CatalogAsset.KIND_DECOR, true);
        }

        personalAppearances.insertIfAbsent(userId);
        PersonalAppearance appearance = personalAppearances.findByIdForUpdate(userId)
                .orElseThrow(() -> new IllegalStateException("개인 외양을 만들 직후에 찾지 못했습니다."));

        String clothes = hasClothes ? clothesIn : appearance.getClothes();
        String decor = hasDecor ? decorIn : appearance.getDecor();
        String hull = hullIn != null ? hullIn : appearance.getHull();
        String position = positionIn != null ? positionIn : appearance.getPosition();
        if (!hasClothes) {
            requirePersonalProduct(userId, clothes, CatalogAsset.KIND_CLOTHES, false);
        }
        if (!hasDecor) {
            requirePersonalProduct(userId, decor, CatalogAsset.KIND_DECOR, false);
        }

        boolean changed = appearance.apply(clothes, decor, hull, position, clock.instant());
        List<Map<String, Object>> envelopes = changed
                ? events.memberChanged(userId, displayIslands(userId), appearance)
                : List.of();
        return new PublicCommandResult(200, tree(personalView(appearance)), tree(envelopes));
    }

    // ---------------------------------------------------------------- 공동 명령 본체

    private PublicCommandResult applyIsland(UUID islandId, UUID userId,
                                            Map<String, Object> values, long expectedVersion) {
        userQueryService.getCallerForUpdate(userId);
        aliveIslandForUpdate(islandId);
        requireSharedAppearance(userId, islandId);
        // 낡은 expectedVersion 은 값·상품 검증보다 먼저 409 다 — 앱은 409 로 최신 상태를 다시 받는다.
        // 보유 행을 외양 행보다 먼저 잠가야 해서 확정 비교는 아래 잠긴 행이 한 번 더 한다.
        if (expectedVersion != islandAppearances.findVersion(islandId).orElse(0L)) {
            throw new AppearanceException(AppearanceErrorCode.VERSION_CONFLICT);
        }

        boolean hasTheme = values.containsKey("islandThemeId");
        String themeIn = hasTheme ? islandThemeValue(values.get("islandThemeId")) : null;
        Map<String, String> buildingIn = values.containsKey("buildingThemes")
                ? buildingThemesValue(values.get("buildingThemes")) : Map.of();

        if (hasTheme) {
            requireIslandTheme(islandId, themeIn, true);
        }
        for (Map.Entry<String, String> entry : buildingIn.entrySet()) {
            requireBuildingTheme(islandId, entry.getKey(), entry.getValue(), true);
        }

        islandAppearances.insertIfAbsent(islandId);
        IslandAppearance appearance = islandAppearances.findByIdForUpdate(islandId)
                .orElseThrow(() -> new IllegalStateException("섬 외양을 만들 직후에 찾지 못했습니다."));
        if (expectedVersion != appearance.getVersion()) {
            throw new AppearanceException(AppearanceErrorCode.VERSION_CONFLICT);
        }

        // 부분 병합 — 미등록 건물 키(현재 맵에 없는 키 = 미완공·미시드)는 422. PATCH 는 사전 시드된
        // 대상 행만 갱신한다. 키 집합은 잠긴 행에서만 알 수 있으므로 이 검사는 외양 잠금 뒤다.
        String themeId = hasTheme ? themeIn : appearance.getIslandThemeId();
        Map<String, String> buildingThemes = new LinkedHashMap<>(appearance.getBuildingThemes());
        for (Map.Entry<String, String> entry : buildingIn.entrySet()) {
            if (!buildingThemes.containsKey(entry.getKey())) {
                throw new AppearanceException(AppearanceErrorCode.OUT_OF_RANGE);
            }
            buildingThemes.put(entry.getKey(), entry.getValue());
        }

        if (!hasTheme) {
            requireIslandTheme(islandId, themeId, false);
        }
        for (Map.Entry<String, String> entry : buildingThemes.entrySet()) {
            if (!buildingIn.containsKey(entry.getKey())) {
                requireBuildingTheme(islandId, entry.getKey(), entry.getValue(), false);
            }
        }

        boolean changed = appearance.apply(themeId, buildingThemes, clock.instant());
        List<Map<String, Object>> envelopes = changed
                ? List.of(events.islandChanged(islandId, userId, appearance))
                : List.of();
        return new PublicCommandResult(200, tree(islandView(appearance)), tree(envelopes));
    }

    // ---------------------------------------------------------------- 값 해석

    /**
     * fields/values 캐리어 형식 검사 — 허용 필드 외·키 집합 불일치·중복·빈 PATCH 는 400.
     * fields 와 values 는 같은 집합을 이뤄야 하며, 내부 계약이므로 Business 가 이미 걸렀더라도
     * 신뢰 경계에서 다시 검사한다.
     */
    private static void requireCarrier(List<String> fields, Map<String, Object> values,
                                       Set<String> allowed) {
        if (fields == null || fields.isEmpty() || values == null) {
            throw new AppearanceException(AppearanceErrorCode.INVALID_REQUEST);
        }
        Set<String> seen = new HashSet<>(fields);
        if (seen.size() != fields.size() || !allowed.containsAll(seen)
                || !seen.equals(values.keySet())) {
            throw new AppearanceException(AppearanceErrorCode.INVALID_REQUEST);
        }
        // buildingThemes 빈 객체만 보낸 PATCH 는 적용할 필드가 없으므로 빈 PATCH 와 같다.
        if (seen.equals(Set.of("buildingThemes"))
                && !(values.get("buildingThemes") instanceof Map<?, ?> map && !map.isEmpty())) {
            throw new AppearanceException(AppearanceErrorCode.INVALID_REQUEST);
        }
    }

    /** null 허용 슬롯(clothes·decor) — null 은 해제, 문자열은 상품 ID, 그 외 타입은 400. */
    private static String nullableSlot(Object value) {
        return value == null ? null : textual(value);
    }

    /**
     * hull — null 은 422(LLD §4: null 불가 슬롯), "raft" 만 유효하다. 그 외 값은 상품 규칙을
     * 따른다 — 카탈로그에 없으면 404, 있으면 종류 불일치로 422(유료 선체는 카탈로그에도 없다).
     */
    private String hullValue(Object value) {
        if (value == null) {
            throw new AppearanceException(AppearanceErrorCode.OUT_OF_RANGE);
        }
        String text = textual(value);
        if (PersonalAppearance.HULL_RAFT.equals(text)) {
            return text;
        }
        throw catalogAssets.findById(text).isPresent()
                ? new AppearanceException(AppearanceErrorCode.OUT_OF_RANGE)
                : new AppearanceException(AppearanceErrorCode.PRODUCT_NOT_FOUND);
    }

    /** position — null·"front"/"back" 외 문자열은 422. */
    private static String positionValue(Object value) {
        if (value == null) {
            throw new AppearanceException(AppearanceErrorCode.OUT_OF_RANGE);
        }
        String text = textual(value);
        if (!PersonalAppearance.POSITION_FRONT.equals(text)
                && !PersonalAppearance.POSITION_BACK.equals(text)) {
            throw new AppearanceException(AppearanceErrorCode.OUT_OF_RANGE);
        }
        return text;
    }

    /** islandThemeId — null 은 422, "default" 는 해제, 문자열은 상품 ID. */
    private static String islandThemeValue(Object value) {
        if (value == null) {
            throw new AppearanceException(AppearanceErrorCode.OUT_OF_RANGE);
        }
        return textual(value);
    }

    /**
     * buildingThemes 제출 값 — null 맵·null 값은 422(null 은 허용하지 않는다), 맵이 아니거나
     * 문자열이 아닌 값은 400. 미등록 건물 키 판정은 외양 행 잠금 뒤 병합에서 한다.
     */
    private static Map<String, String> buildingThemesValue(Object value) {
        if (value == null) {
            throw new AppearanceException(AppearanceErrorCode.OUT_OF_RANGE);
        }
        if (!(value instanceof Map<?, ?> map)) {
            throw new AppearanceException(AppearanceErrorCode.INVALID_REQUEST);
        }
        Map<String, String> themes = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (entry.getValue() == null) {
                throw new AppearanceException(AppearanceErrorCode.OUT_OF_RANGE);
            }
            themes.put(entry.getKey().toString(), textual(entry.getValue()));
        }
        return themes;
    }

    // ---------------------------------------------------------------- 검증

    /**
     * 개인 슬롯 상품 — 없으면 404, 종류/소유자가 다르면 422, 미보유는 403.
     * {@code lock} 이면 보유 행을 공유로 잠근다 — 외양 행 잠금 전(제출 값)에만 true 로 부른다.
     */
    private void requirePersonalProduct(UUID userId, String productId, String kind, boolean lock) {
        if (productId == null) {
            return;
        }
        CatalogAsset asset = catalogAssets.findById(productId)
                .orElseThrow(() -> new AppearanceException(AppearanceErrorCode.PRODUCT_NOT_FOUND));
        if (!kind.equals(asset.getKind()) || !CatalogAsset.OWNER_USER.equals(asset.getOwnerType())) {
            throw new AppearanceException(AppearanceErrorCode.OUT_OF_RANGE);
        }
        boolean owned = lock
                ? ownedProducts.findUserProductForShare(userId, productId).isPresent()
                : ownedProducts.existsByUserIdAndProductId(userId, productId);
        if (!owned) {
            throw new AppearanceException(AppearanceErrorCode.FORBIDDEN);
        }
    }

    /** 섬 전체 테마 — "default" 는 항상 통과, 그 외는 island_theme + 공동 소유여야 한다. */
    private void requireIslandTheme(UUID islandId, String productId, boolean lock) {
        if (IslandAppearance.THEME_DEFAULT.equals(productId)) {
            return;
        }
        requireIslandProduct(islandId, productId, CatalogAsset.KIND_ISLAND_THEME, lock);
    }

    /** 건물 테마 — "default" 통과, building_theme 이면서 targetBuilding 이 해당 건물이어야 한다. */
    private void requireBuildingTheme(UUID islandId, String buildingId, String productId,
                                      boolean lock) {
        if (IslandAppearance.THEME_DEFAULT.equals(productId)) {
            return;
        }
        CatalogAsset asset = requireIslandProduct(islandId, productId,
                CatalogAsset.KIND_BUILDING_THEME, lock);
        if (!buildingId.equals(asset.getTargetBuilding())) {
            throw new AppearanceException(AppearanceErrorCode.OUT_OF_RANGE);
        }
    }

    /** 공동 상품 — {@code lock} 규칙은 {@link #requirePersonalProduct} 와 같다. */
    private CatalogAsset requireIslandProduct(UUID islandId, String productId, String kind,
                                              boolean lock) {
        CatalogAsset asset = catalogAssets.findById(productId)
                .orElseThrow(() -> new AppearanceException(AppearanceErrorCode.PRODUCT_NOT_FOUND));
        if (!kind.equals(asset.getKind())
                || !CatalogAsset.OWNER_ISLAND.equals(asset.getOwnerType())) {
            throw new AppearanceException(AppearanceErrorCode.OUT_OF_RANGE);
        }
        boolean owned = lock
                ? ownedProducts.findIslandProductForShare(islandId, productId).isPresent()
                : ownedProducts.existsByIslandIdAndProductId(islandId, productId);
        if (!owned) {
            throw new AppearanceException(AppearanceErrorCode.FORBIDDEN);
        }
        return asset;
    }

    // ---------------------------------------------------------------- 공통 가드

    private Group aliveIsland(UUID islandId) {
        Group island = groupQueryService.findGroup(islandId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.GROUP_NOT_FOUND));
        if (!isAlive(island)) {
            throw new GroupException(GroupErrorCode.GROUP_NOT_FOUND);
        }
        return island;
    }

    private Group aliveIslandForUpdate(UUID islandId) {
        Group island = groupQueryService.getGroupForUpdate(islandId);
        if (!isAlive(island)) {
            throw new GroupException(GroupErrorCode.GROUP_NOT_FOUND);
        }
        return island;
    }

    private static boolean isAlive(Group island) {
        return island.getDeletedAt() == null && island.getStatus() != GroupStatus.ENDED;
    }

    /** SHARED_APPEARANCE — 활성 주민이어야 하고 역할이 OWNER 여야 한다. */
    private void requireSharedAppearance(UUID userId, UUID islandId) {
        GroupMember member = groupMemberRepository.findActiveByUserIdAndGroupIdForShare(userId, islandId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        if (member.getRole() != GroupMemberRole.OWNER) {
            throw new GroupException(GroupErrorCode.NOT_OWNER);
        }
    }

    /**
     * 멱등 재생 권한 — receipt 는 원 명령 성공 시점의 결과다. 재생 시점에 섬이 끝났거나 방장이
     * 아니게 됐다면 그때의 권한을 되살리면 안 되므로 실행 경로와 같은 잠금 순서로 다시 검사한다.
     */
    private void requireReplayPermission(UUID islandId, UUID userId) {
        aliveIslandForUpdate(islandId);
        requireSharedAppearance(userId, islandId);
    }

    /** 개인 외양이 표시되는 섬 — 활성 멤버십의 섬 전부(본인 섬 포함). LLD 의 표시 대상 규칙. */
    private List<UUID> displayIslands(UUID userId) {
        return groupMemberRepository.findActiveGroupIdsByUserId(userId);
    }

    // ---------------------------------------------------------------- 조회·코덱

    private Map<String, CatalogAsset> assetsOf(List<OwnedProduct> owned) {
        Map<String, CatalogAsset> assets = new LinkedHashMap<>();
        for (CatalogAsset asset : catalogAssets.findAllById(
                owned.stream().map(OwnedProduct::getProductId).toList())) {
            assets.put(asset.getProductId(), asset);
        }
        return assets;
    }

    /** inventoryVersion 축의 마지막 발급값 — 행이 없으면 0(아직 변경 사건이 없는 축). */
    private long inventoryVersion(String type, UUID id) {
        return aggregateVersions.findById(new AggregateVersionId(type, id.toString()))
                .map(AggregateVersion::getLastVersion)
                .orElse(0L);
    }

    private static PersonalAppearanceView personalView(PersonalAppearance a) {
        if (a == null) {
            return new PersonalAppearanceView(null, null, PersonalAppearance.HULL_RAFT,
                    PersonalAppearance.POSITION_FRONT, 0);
        }
        return new PersonalAppearanceView(a.getClothes(), a.getDecor(), a.getHull(),
                a.getPosition(), a.getVersion());
    }

    private static IslandAppearanceView islandView(IslandAppearance a) {
        if (a == null) {
            return new IslandAppearanceView(IslandAppearance.THEME_DEFAULT, Map.of(), 0);
        }
        return new IslandAppearanceView(a.getIslandThemeId(), a.getBuildingThemes(), a.getVersion());
    }

    /** receipt 의 저장 봉투 배열을 내부 응답용 맵 목록으로 되살린다 — 재생 경로도 같은 모양이다. */
    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> receiptEvents(PublicCommandReceipt receipt) {
        return decode(receipt.events(), List.class);
    }

    /**
     * 명령 의미 객체 — 제출된 필드만 담은 JSON 오브젝트다. 명시 null 은 보존되어 미제출 필드와
     * 구분되고, fingerprint 가 같은 키의 다른 의미 요청을 다른 명령으로 본다.
     */
    private static ObjectNode semantic(Map<String, Object> values) {
        try {
            return (ObjectNode) OutboxEnvelopeCodec.fromJson(
                    OutboxEnvelopeCodec.toJson(values), JsonNode.class);
        } catch (JsonProcessingException e) {
            throw new AppearanceException(AppearanceErrorCode.INVALID_REQUEST);
        }
    }

    /** 문자열 값만 허용 — 숫자·불리언·객체·배열은 형식 오류(400). */
    private static String textual(Object value) {
        if (!(value instanceof String text)) {
            throw new AppearanceException(AppearanceErrorCode.INVALID_REQUEST);
        }
        return text;
    }

    private static JsonNode tree(Object value) {
        try {
            return OutboxEnvelopeCodec.fromJson(OutboxEnvelopeCodec.toJson(value), JsonNode.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("외양 명령 직렬화 실패", e);
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
