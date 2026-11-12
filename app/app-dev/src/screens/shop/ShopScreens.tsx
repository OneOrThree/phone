import { customizationTitle } from '@/i18n/customization';
import { localeTag } from '@/i18n/format';
import { OutfitItemArt } from '@/components/CatOutfitLayers';
import { cat } from '@/constants/assets';
import { bundledAudioSource } from '@/constants/audio';
import { Badge, Btn, C, Chips, EmptyState, Pic, Txt } from '@/design-system/patterns';
import { t } from '@/i18n';
import { Cta, IslandSheet, Preview, SheetGroup, SheetRow, st } from '@/screens/island/IslandSheet';
import { useCustomizationCatalog } from '@/services/customizationCatalog';
import { State, balance, canBuy, kstHourMinute, kstMonthDay, products } from '@/services/model';
import { type ReactNode, useState } from 'react';
import { type ImageSourcePropType, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon, shopBlockReason } from '../island/navigation/screenParts';
import type { ScreenContext } from '../island/navigation/useScreenState';

// 서버 카탈로그 kind → 카드가 아는 로컬 kind (GROMO-2017). clothes/decor 은 모두 「내 꾸미기」다.
const shopUiKind = (kind: string) =>
  kind === 'island_theme'
    ? 'island'
    : kind === 'building_theme'
      ? 'building'
      : kind === 'audio'
        ? 'audio'
        : 'clothes';

const shopCard = (p: any) => ({
  ...p,
  kind: shopUiKind(p.kind),
  building: p.targetBuilding ?? p.building,
});

const buildingArt: Record<string, string> = {
  library: 'library',
  gram: 'gramophone',
  hall: 'hall',
  board: 'notice-board',
  tower: 'observatory',
  mail: 'mailbox',
  shop: 'shop',
};

// 꾸미기 그림은 칸 높이의 이만큼 — 둥근 칸 모서리에 닿지 않게 기본 그림(92%)보다 조금 작게 둔다
const ITEM_ART_RATIO = 0.86;
// 폭은 기본 그림과 같은 92% 를 넘지 않는다 — compact(한 줄 4칸)처럼 칸이 좁으면 정사각 그림이 가로로 잘린다
const ITEM_ART_MAX_WIDTH_RATIO = 0.92;

// 섬·건물 테마가 아닌 카드(머리·목·신발 등 개인 꾸미기)는 서버 꾸미기 카탈로그의 상품 그림으로 그린다
const usesCatalogArt = (product: any) => product.kind !== 'island' && product.kind !== 'building';

// 상점 카드 그림(GROMO-2873). 섬·건물 테마는 종류별 그림, 꾸미기(머리·목·신발 등)는 서버 꾸미기
// 카탈로그의 상품 그림이다 — 먼바다 결과창과 같은 OutfitItemArt. 카탈로그에 그 상품이 없으면
// (불러오는 중·실패·데모) 예전처럼 스카프 고양이 기본 그림을 그린다. renderShopScreens 는 훅을 못 쓰는
// 함수라 카드 그림만 컴포넌트로 뺐다. 카탈로그는 모듈 캐시를 같이 써서 카드가 많아도 요청은 한 번이다.
// 그림 크기는 높이 기준값과 칸 폭(onLayout) 기준값 중 작은 쪽이다. 폭을 재기 전 첫 프레임은 높이 기준이다.
function ShopCardArt({ product, height }: { product: any; height: number }) {
  const table = useCustomizationCatalog();
  const [width, setWidth] = useState(0);
  if (!usesCatalogArt(product))
    return product.kind === 'island' ? (
      <Pic id="island/whole" w="100%" h="100%" cover />
    ) : (
      <Pic id={'bld/' + buildingArt[product.building || 'hall']} w="92%" h="92%" />
    );
  const entry = table[product.id];
  if (!entry) return <Pic id="scarf-cat" w="92%" h="92%" />;
  const byHeight = height * ITEM_ART_RATIO;
  const size = Math.round(width ? Math.min(byHeight, width * ITEM_ART_MAX_WIDTH_RATIO) : byHeight);
  return (
    <View
      testID={`shop-art-box-${product.id}`}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ alignSelf: 'stretch', flex: 1, alignItems: 'center', justifyContent: 'center' }}
    >
      <OutfitItemArt entry={entry} size={size} testID={`shop-art-${product.id}`} />
    </View>
  );
}

// 상점 목록 칸과 빈 상태(GROMO-2878). 서버 목록이고 카탈로그 표에 항목이 있으면 표에 그림이 없는 개인 꾸미기
// 카드를 뺀다 — 서버도 같은 상품을 거른다(GROMO-2877). 카탈로그를 아직 못 받았거나 처음부터 실패해 표가 비었으면
// 거르지 않고 기본 그림으로 보인다(받기 전 목록이 비어 보이지 않게). 한 번 받은 뒤 다시 읽기에 실패하면 훅이 직전
// 표를 유지해 그 표로 거른다. 섬·건물 테마는 거르지 않는다.
// renderShopScreens 는 훅을 못 쓰는 함수라 카탈로그로 거르는 목록만 컴포넌트로 뺐다.
function ShopGrid({
  items,
  filterUndrawable,
  emptyReady,
  emptyArt,
  cols,
  gap,
  card,
}: {
  items: any[];
  filterUndrawable: boolean;
  emptyReady: boolean;
  emptyArt: ImageSourcePropType;
  cols: number;
  gap: number;
  card: (product: any) => ReactNode;
}) {
  const table = useCustomizationCatalog();
  const filter = filterUndrawable && Object.keys(table).length > 0;
  const shown = filter ? items.filter((p) => !usesCatalogArt(p) || !!table[p.id]) : items;
  return (
    <>
      {/* 파는 상품이 없으면 빈 상태 한 줄. 서버는 이 탭 응답을 받은 뒤에만 — 요청 전 첫 프레임·탭을 바꾼 직후·불러오는 중·실패엔 띄우지 않는다 */}
      {!shown.length && emptyReady && (
        <EmptyState testID="shop-empty" art={emptyArt} title={t('emptyState.shop')} />
      )}
      {/* 세로 2열 · 가로 4열. 마지막 줄이 모자라면 빈칸으로 폭을 맞춘다 */}
      <View style={{ gap }}>
        {Array.from({ length: Math.ceil(shown.length / cols) }, (_, r) => (
          <View key={r} style={{ flexDirection: 'row', gap }}>
            {Array.from({ length: cols }, (_, c) => {
              const p = shown[r * cols + c];
              // 칸마다 같은 폭(카드 안쪽 여백이 폭 나누기에 끼지 않게 한 겹 감싼다)
              return (
                <View key={c} style={{ flex: 1, minWidth: 0 }}>
                  {p && card(p)}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </>
  );
}

// 날짜 "M/D"와 시각 "HH:MM"(Asia/Seoul)
const md = kstMonthDay;

const hm = kstHourMinute;

// 재생·일시정지(채운 도형)
function PlayIcon({ pause = false, size = 18 }: any) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={pause ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z'} fill={C.ink} />
    </Svg>
  );
}

// 폴더형 아이콘 타일 탭(ftabs). items = [[글자, 아이콘], ...]
function FTabs({ items, value, onChange, labelFor = (id: string) => id }: any) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {items.map(([label, icon]: string[]) => {
        const on = label === value;
        return (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={labelFor(label)}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(label)}
            style={{
              flex: 1,
              height: 54,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderWidth: 2,
              borderColor: C.brown,
              borderRadius: 16,
              backgroundColor: on ? C.pink : C.paper,
              boxShadow: on ? '0px 4px 0px ' + C.brown : 'none',
            }}
          >
            <Icon name={icon} color={on ? C.ink : C.muted} />
            <Txt
              style={{
                fontSize: 15,
                fontWeight: on ? '800' : '700',
                color: on ? C.ink : C.muted,
              }}
            >
              {labelFor(label)}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
export function renderShopScreens(context: ScreenContext) {
  const {
    route,
    tab,
    layout,
    server,
    shopApi,
    owned,
    go,
    home,
    fishStrip,
    setTab,
    serverErrorText,
    state,
    detail,
    back,
    island,
    notify,
    act,
    confirm,
    productViewRef,
    setSheetToast,
    e,
    setSheetToastSeq,
    walkTo,
    sheetToast,
    raftCat,
    previewAudio,
    player,
    setPreviewAudio,
    productTitle,
    isHostName,
  } = context;

  if (route === 'shop') {
    // 탭 2개: 내 꾸미기(옷·장신구) · 우리 섬 꾸미기(섬·건물 테마). 음원은 축음기에서 산다
    // 서버 모드는 탭이 곧 category 이고 목록은 서버 응답 그대로다(GROMO-2017).
    const mine = tab !== 'island',
      cols = layout.compact ? 4 : 2,
      artHeight = layout.compact ? 84 : 112,
      items = server
        ? shopApi.items.map(shopCard)
        : products.filter((p) =>
            mine ? p.kind === 'clothes' : p.kind === 'island' || p.kind === 'building',
          );
    const card = (p: any) => (
      <Pressable
        key={p.id}
        accessibilityRole="button"
        accessibilityLabel={`${customizationTitle(p.id, p.title)}, ${p.price == null ? t('ui.shop.comingSoon') : t('ui.hall.fishCount', { v0: p.price })}${owned(p) ? t('ui.shop.ownedSuffix') : ''}`}
        onPress={() => go('product', p.id)}
        style={{
          flex: 1,
          padding: 10,
          gap: 6,
          borderWidth: 1.5,
          borderColor: C.brown,
          borderRadius: 18,
          backgroundColor: C.paper,
        }}
      >
        <View
          style={{
            height: artHeight,
            borderRadius: 12,
            backgroundColor: mine ? '#FFF0F3' : '#E3F4FC',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <ShopCardArt product={p} height={artHeight} />
        </View>
        {owned(p) && (
          <View
            style={{
              position: 'absolute',
              left: 16,
              top: 16,
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderWidth: 1.5,
              borderColor: C.brown,
              borderRadius: 999,
              backgroundColor: C.butter,
            }}
          >
            <Txt style={{ fontSize: 11, lineHeight: 15.95, fontWeight: '700' }}>
              {t('ui.shop.owned')}
            </Txt>
          </View>
        )}
        <Txt
          style={{
            fontSize: layout.compact ? 13 : 14,
            lineHeight: layout.compact ? 18.85 : 20.3,
            fontWeight: '700',
          }}
        >
          {customizationTitle(p.id, p.title)}
        </Txt>
        <Txt kind="meta" style={{ lineHeight: 18.85 }}>
          {p.price == null ? t('ui.shop.comingSoon') : t('ui.hall.fishCount', { v0: p.price })}
        </Txt>
      </Pressable>
    );
    return (
      <>
        <IslandSheet
          bg="shop"
          sign="dog"
          signKind="npc"
          title={t('ui.shop.dogShop')}
          tall
          action={t('ui.shop.purchaseHistory')}
          actionPress={() => go('orders')}
          onClose={home}
        >
          {fishStrip}
          <Chips
            items={['personal', 'island']}
            labelFor={(id: string) => t(`shop.tab.${id}`)}
            value={mine ? 'personal' : 'island'}
            onChange={setTab}
          />
          {mine && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Pic id="dog" w={56} />
              <Txt kind="meta" style={[st.meta, { flex: 1 }]}>
                {t('ui.shop.shopGreeting')}
              </Txt>
            </View>
          )}
          {server && shopApi.error ? (
            <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
              <Txt kind="meta" style={st.meta}>
                {serverErrorText(shopApi.error) || t('ui.shop.shopFailed')}
              </Txt>
              <Btn title={t('common.retry')} onPress={shopApi.retry} />
            </View>
          ) : server && shopApi.loading ? (
            <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
              {t('account.blocked.loading')}
            </Txt>
          ) : null}
          <ShopGrid
            items={items}
            filterUndrawable={!!server}
            emptyReady={
              !server ||
              (shopApi.itemsCategory === (mine ? 'personal' : 'island') &&
                !shopApi.loading &&
                !shopApi.error)
            }
            emptyArt={cat(state.color, 'side')}
            cols={cols}
            gap={layout.compact ? 10 : 12}
            card={card}
          />
        </IslandSheet>
      </>
    );
  }

  if (route === 'product') {
    // 서버 모드는 상품 상세 계약이 정본이다(GROMO-2017) — 가격·owned·available·버전 모두
    // 서버 응답을 쓰고 목업 products/canBuy 는 건드리지 않는다.
    const sp = server
      ? ((shopApi.detail && shopApi.detail.id === detail ? shopApi.detail : null) ??
        shopApi.items.find((i) => i.id === detail) ??
        null)
      : null;
    if (server && !sp) {
      return (
        <IslandSheet
          bg="shop"
          sign="dog"
          signKind="npc"
          title={t('ui.shop.productDetails')}
          fit
          onBack={back}
          onClose={home}
        >
          <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
            {shopApi.detailLoading
              ? t('account.blocked.loading')
              : serverErrorText(shopApi.detailError) || t('ui.shop.productFailed')}
          </Txt>
        </IslandSheet>
      );
    }
    const p = sp
        ? shopCard({ ...sp, description: '' })
        : products.find((p) => p.id === detail) || products[0],
      audio = p.kind === 'audio',
      clothes = p.kind === 'clothes',
      has = server ? !!sp?.owned : owned(p),
      // 살 수 없는 이유 — 서버 모드는 available/blockedReason 응답이 정본이다
      error = has
        ? null
        : server
          ? sp!.available
            ? null
            : shopBlockReason(sp!)
          : canBuy(state, p),
      remaining = Math.max(
        0,
        (server ? (shopApi.wallets?.villagePoints ?? 0) : balance(island)) - (p.price ?? 0),
      ),
      applied =
        p.kind === 'island'
          ? (server ? shopApi.shared?.appearance.islandThemeId : island.theme) === p.id
          : p.kind === 'building'
            ? (server
                ? shopApi.shared?.appearance.buildingThemes?.[p.building || 'hall']
                : island.buildingThemes?.[p.building || 'hall']) === p.id
            : false;
    // 적용은 서버 PATCH 가 정본 — 실패하면 성공 토스트를 띄우지 않는다(false 반환).
    const apply = (value: string): Promise<boolean> => {
      if (server)
        return shopApi
          .applyTheme(
            p.kind === 'island'
              ? { islandThemeId: value }
              : { buildingThemes: { [p.building || 'hall']: value } },
          )
          .then(() => true)
          .catch((thrown) => {
            const m = serverErrorText(thrown);
            if (m) notify(m);
            return false;
          });
      act('THEME', { kind: p.kind, building: p.building || 'hall', value });
      return Promise.resolve(true);
    };
    const buy = () =>
      confirm(
        t('ui.shop.confirmTrack', { v0: customizationTitle(p.id, p.title) }),
        t('ui.shop.purchaseBalance', { v0: p.price, v1: remaining.toLocaleString(localeTag()) }) +
          (clothes ? t('ui.shop.personalOwnershipLine') : ''),
        () => {
          if (server) {
            // 응답 + 지갑·인벤토리·내역 재조회가 끝날 때만 성공 토스트 — 실패·응답 유실에는 붙지 않는다.
            const startedView = productViewRef.current;
            shopApi
              .buy({ id: p.id, productVersion: sp!.productVersion })
              .then(() => setSheetToast(t('ui.shop.purchased')))
              .catch((thrown) => {
                if (e.conversion?.offer(thrown)) return;
                const m = serverErrorText(thrown);
                if (!m) return;
                // 전역 알림(notify)은 이 상품 상세 시트 위에서 가려질 수 있어, 아직 같은 상품
                // 화면에 있으면 시트 안 토스트로 알린다(스크린리더도 한 채널만 읽는다). 그 사이
                // 다른 화면으로 옮겼다면 시트 토스트를 남의 화면에 띄우지 않고 전역 알림으로 알린다.
                if (productViewRef.current === startedView) {
                  setSheetToast(m);
                  setSheetToastSeq((n) => n + 1);
                } else {
                  notify(m);
                }
              });
            return;
          }
          act('BUY', { id: p.id });
          setSheetToast(t('ui.shop.purchased'));
        },
        { ok: t('ui.shop.buy') },
      );
    const cta = !has ? (
      <Cta
        note={
          error ??
          (audio
            ? t('ui.shop.remainingBalance', { v0: remaining.toLocaleString(localeTag()) })
            : t('ui.shop.purchaseBalance', {
                v0: p.price,
                v1: remaining.toLocaleString(localeTag()),
              }))
        }
        title={
          audio
            ? t('ui.shop.buyWithIslandFish', { v0: p.price })
            : t('ui.shop.buyForFish', { v0: p.price })
        }
        onPress={buy}
        disabled={!!error || (server && shopApi.writing)}
      />
    ) : clothes ? (
      <Cta title={t('ui.shop.changeOnRaft')} onPress={() => walkTo('wardrobe')} />
    ) : audio ? (
      <Cta title={t('ui.shop.listenAtGram')} onPress={() => go('sound')} />
    ) : (
      <Cta
        title={applied ? t('ui.shop.applied') : t('ui.shop.apply')}
        // 적용됨은 시안 모양 그대로 두고 누름만 막는다(Btn이 비활성으로 읽음)
        onPress={
          applied
            ? undefined
            : () =>
                void apply(p.id).then((ok) => {
                  if (ok) setSheetToast(t('ui.shop.appliedNotice'));
                })
        }
        ghost={t('ui.shop.resetAppearance')}
        onGhost={() => {
          const current =
            p.kind === 'island'
              ? server
                ? shopApi.shared?.appearance.islandThemeId
                : island.theme
              : server
                ? shopApi.shared?.appearance.buildingThemes?.[p.building || 'hall']
                : island.buildingThemes?.[p.building || 'hall'];
          if (!current || current === 'default') {
            setSheetToast(t('ui.shop.alreadyDefault'));
            return;
          }
          void apply('default').then((ok) => {
            if (ok) setSheetToast(t('ui.shop.restored'));
          });
        }}
      />
    );
    return (
      <IslandSheet
        bg={audio ? 'gram' : 'shop'}
        sign={audio ? 'bld/gramophone' : 'dog'}
        signKind={audio ? '' : 'npc'}
        title={audio ? t('ui.shop.buyTrack') : t('ui.shop.productDetails')}
        fit
        onBack={back}
        onClose={home}
        footer={cta}
        toast={sheetToast}
      >
        {clothes ? (
          raftCat(260)
        ) : audio ? (
          <Preview h={220} bg={C.soft}>
            <Pic id="bld/gramophone" w={170} />
            <View style={{ position: 'absolute', left: 16, bottom: 22 }}>
              <Badge soft>{t('ui.shop.preview')}</Badge>
            </View>
            {/* 미리듣기는 내 기기에서만. 섬 재생에는 영향 없음 */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={previewAudio ? t('ui.shop.stopPreview') : t('ui.shop.preview')}
              disabled={!player.playbackAllowed}
              accessibilityState={{ disabled: !player.playbackAllowed }}
              onPress={() => {
                try {
                  if (!player.playbackAllowed) return;
                  if (previewAudio) {
                    player.pause();
                    setPreviewAudio(false);
                  } else {
                    player.replace(bundledAudioSource(p.id));
                    // 미리듣기는 한 번만(끝나면 재생 종료 이벤트로 버튼을 되돌린다)
                    player.loop = false;
                    setPreviewAudio(player.play());
                  }
                } catch {
                  notify(t('ui.shop.trackFailed'));
                }
              }}
              style={{
                position: 'absolute',
                right: 16,
                bottom: 16,
                width: 52,
                height: 52,
                borderRadius: 26,
                borderWidth: 2,
                borderColor: C.brown,
                backgroundColor: C.pink,
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0px 3px 0px ' + C.brown,
              }}
            >
              <PlayIcon pause={previewAudio} />
            </Pressable>
          </Preview>
        ) : p.kind === 'island' ? (
          <Preview h={220}>
            <Pic id="island/whole" w="100%" h="100%" cover />
          </Preview>
        ) : (
          <Preview h={220}>
            <Pic id={'bld/' + buildingArt[p.building || 'hall']} w={180} />
          </Preview>
        )}
        <Txt style={st.h22}>{customizationTitle(p.id, p.title)}</Txt>
        {has && !audio && (
          <Badge>
            {t('ui.shop.ownedApplied', { v0: applied ? t('ui.shop.appliedSuffix') : '' })}
          </Badge>
        )}
        <Txt style={st.body}>
          {p.description}
          {p.kind === 'island' && applied ? t('ui.shop.appliedHint') : ''}
        </Txt>
        {clothes && (
          <Txt kind="meta" style={st.meta}>
            {t('ui.shop.personalOwnership')}
          </Txt>
        )}
        {audio && (
          <Txt kind="meta" style={st.meta}>
            {t('ui.shop.anyResidentCanBuy')}
          </Txt>
        )}
      </IslandSheet>
    );
  }

  if (route === 'orders') {
    // 내 구매 = 옷·장신구(날짜·시각), 섬 공동 구매 = 이 섬 테마·음원(날짜·구매자, 방장이면 "방장")
    // 서버 모드는 scope=personal|shared 응답이 정본 — 내역 가격은 당시 확정가 스냅숏이다(GROMO-2017).
    const shared = tab === 'shared';
    const list: State['orders'] = server
      ? shopApi.orders.map((o) => ({
          id: o.id,
          product: o.productId,
          islandId: island.id,
          currency: 'village_points',
          price: o.price,
          at: Date.parse(o.createdAt),
        }))
      : state.orders.filter((o) => {
          const kind = products.find((p) => p.id === o.product)?.kind;
          return shared ? kind !== 'clothes' && o.islandId === island.id : kind === 'clothes';
        });
    return (
      <IslandSheet
        bg="shop"
        sign="dog"
        signKind="npc"
        title={t('ui.shop.purchaseHistory')}
        tight
        onBack={back}
        onClose={home}
      >
        <FTabs
          items={[
            ['personal', 'person'],
            ['shared', 'group'],
          ]}
          value={shared ? 'shared' : 'personal'}
          labelFor={(id: string) => t(`shop.ordersTab.${id}`)}
          onChange={setTab}
        />
        {server && shopApi.ordersLoading ? (
          <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
            {t('account.blocked.loading')}
          </Txt>
        ) : server && shopApi.ordersError ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
            <Txt kind="meta" style={st.meta}>
              {serverErrorText(shopApi.ordersError) || t('ui.shop.ordersFailed')}
            </Txt>
            <Btn title={t('common.retry')} onPress={shopApi.retry} />
          </View>
        ) : list.length ? (
          <SheetGroup>
            {list.map((o) => (
              <SheetRow
                key={o.id}
                title={productTitle(o.product)}
                sub={
                  shared
                    ? [md(o.at), o.buyer && (isHostName(o.buyer) ? t('ui.shop.host') : o.buyer)]
                        .filter(Boolean)
                        .join(' · ')
                    : `${md(o.at)} · ${hm(o.at)}`
                }
                right={t('ui.hall.fishCount', { v0: o.price })}
                chevron
                onPress={() => go('product', o.product)}
              />
            ))}
          </SheetGroup>
        ) : (
          <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
            {t('ui.shop.noPurchases')}
          </Txt>
        )}
      </IslandSheet>
    );
  }
}
