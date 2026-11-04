import { cat } from '@/constants/assets';
import { bundledAudioSource } from '@/constants/audio';
import { Badge, Btn, C, Chips, EmptyState, Pic, Txt } from '@/design-system/patterns';
import { t } from '@/i18n';
import { Cta, IslandSheet, Preview, SheetGroup, SheetRow, st } from '@/screens/island/IslandSheet';
import { State, balance, canBuy, kstHourMinute, kstMonthDay, products } from '@/services/model';
import { Pressable, View } from 'react-native';
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
function FTabs({ items, value, onChange }: any) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {items.map(([label, icon]: string[]) => {
        const on = label === value;
        return (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
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
              {label}
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
    const mine = tab !== '우리 섬 꾸미기',
      cols = layout.compact ? 4 : 2,
      items = server
        ? shopApi.items.map(shopCard)
        : products.filter((p) =>
            mine ? p.kind === 'clothes' : p.kind === 'island' || p.kind === 'building',
          );
    const card = (p: any) => (
      <Pressable
        key={p.id}
        accessibilityRole="button"
        accessibilityLabel={`${p.title}, ${p.price == null ? '준비 중' : `${p.price}마리`}${owned(p) ? ', 보유 중' : ''}`}
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
            height: layout.compact ? 84 : 112,
            borderRadius: 12,
            backgroundColor: mine ? '#FFF0F3' : '#E3F4FC',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {p.kind === 'island' ? (
            <Pic id="island/whole" w="100%" h="100%" cover />
          ) : (
            <Pic
              id={p.kind === 'building' ? 'bld/' + buildingArt[p.building || 'hall'] : 'scarf-cat'}
              w="92%"
              h="92%"
            />
          )}
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
            <Txt style={{ fontSize: 11, lineHeight: 15.95, fontWeight: '700' }}>보유 중</Txt>
          </View>
        )}
        <Txt
          style={{
            fontSize: layout.compact ? 13 : 14,
            lineHeight: layout.compact ? 18.85 : 20.3,
            fontWeight: '700',
          }}
        >
          {p.title}
        </Txt>
        <Txt kind="meta" style={{ lineHeight: 18.85 }}>
          {p.price == null ? '준비 중' : `${p.price}마리`}
        </Txt>
      </Pressable>
    );
    return (
      <>
        <IslandSheet
          bg="shop"
          sign="dog"
          signKind="npc"
          title="강아지 상점"
          tall
          action="구매 내역"
          actionPress={() => go('orders')}
          onClose={home}
        >
          {fishStrip}
          <Chips
            items={['내 꾸미기', '우리 섬 꾸미기']}
            value={mine ? '내 꾸미기' : '우리 섬 꾸미기'}
            onChange={setTab}
          />
          {mine && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Pic id="dog" w={56} />
              <Txt kind="meta" style={[st.meta, { flex: 1 }]}>
                어서 와, 기다렸어! 물고기로 사는 건 내 뗏목에서 입어.
              </Txt>
            </View>
          )}
          {server && shopApi.error ? (
            <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
              <Txt kind="meta" style={st.meta}>
                {serverErrorText(shopApi.error) || '상점을 불러오지 못했어요.'}
              </Txt>
              <Btn title="다시 시도" onPress={shopApi.retry} />
            </View>
          ) : server && shopApi.loading ? (
            <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
              불러오는 중…
            </Txt>
          ) : null}
          {/* 파는 상품이 없으면 빈 상태 한 줄. 서버는 이 탭 응답을 받은 뒤에만 — 요청 전 첫 프레임·탭을 바꾼 직후·불러오는 중·실패엔 띄우지 않는다 */}
          {!items.length &&
            (!server ||
              (shopApi.itemsCategory === (mine ? 'personal' : 'island') &&
                !shopApi.loading &&
                !shopApi.error)) && (
              <EmptyState
                testID="shop-empty"
                art={cat(state.color, 'side')}
                title={t('emptyState.shop')}
              />
            )}
          {/* 세로 2열 · 가로 4열. 마지막 줄이 모자라면 빈칸으로 폭을 맞춘다 */}
          <View style={{ gap: layout.compact ? 10 : 12 }}>
            {Array.from({ length: Math.ceil(items.length / cols) }, (_, r) => (
              <View key={r} style={{ flexDirection: 'row', gap: layout.compact ? 10 : 12 }}>
                {Array.from({ length: cols }, (_, c) => {
                  const p = items[r * cols + c];
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
          title="상품 상세"
          fit
          onBack={back}
          onClose={home}
        >
          <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
            {shopApi.detailLoading
              ? '불러오는 중…'
              : serverErrorText(shopApi.detailError) || '상품을 불러오지 못했어요.'}
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
        p.title + '를 살까요?',
        `섬 물고기 ${p.price}마리 사용 · 구매 후 ${remaining.toLocaleString()}마리` +
          (clothes ? '\n산 사람의 보유품이라 섬을 떠나도 남아요.' : ''),
        () => {
          if (server) {
            // 응답 + 지갑·인벤토리·내역 재조회가 끝날 때만 성공 토스트 — 실패·응답 유실에는 붙지 않는다.
            const startedView = productViewRef.current;
            shopApi
              .buy({ id: p.id, productVersion: sp!.productVersion })
              .then(() => setSheetToast('구매했어요.'))
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
          setSheetToast('구매했어요.');
        },
        { ok: '구매' },
      );
    const cta = !has ? (
      <Cta
        note={
          error ??
          (audio
            ? `구매 후 ${remaining.toLocaleString()}마리`
            : `섬 물고기 ${p.price}마리 사용 · 구매 후 ${remaining.toLocaleString()}마리`)
        }
        title={audio ? `섬 물고기 ${p.price}마리로 구매` : `${p.price}마리로 구매`}
        onPress={buy}
        disabled={!!error || (server && shopApi.writing)}
      />
    ) : clothes ? (
      <Cta title="내 뗏목에서 갈아입기" onPress={() => walkTo('wardrobe')} />
    ) : audio ? (
      <Cta title="축음기에서 듣기" onPress={() => go('sound')} />
    ) : (
      <Cta
        title={applied ? '우리 섬에 적용됨' : '우리 섬에 적용'}
        // 적용됨은 시안 모양 그대로 두고 누름만 막는다(Btn이 비활성으로 읽음)
        onPress={
          applied
            ? undefined
            : () =>
                void apply(p.id).then((ok) => {
                  if (ok) setSheetToast('우리 섬에 적용했어요.');
                })
        }
        ghost="기본 외양으로 해제"
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
            setSheetToast('이미 기본 외양이에요');
            return;
          }
          void apply('default').then((ok) => {
            if (ok) setSheetToast('기본 외양으로 되돌렸어요.');
          });
        }}
      />
    );
    return (
      <IslandSheet
        bg={audio ? 'gram' : 'shop'}
        sign={audio ? 'bld/gramophone' : 'dog'}
        signKind={audio ? '' : 'npc'}
        title={audio ? '음원 사기' : '상품 상세'}
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
              <Badge soft>나만 미리듣기</Badge>
            </View>
            {/* 미리듣기는 내 기기에서만. 섬 재생에는 영향 없음 */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={previewAudio ? '미리듣기 멈춤' : '나만 미리듣기'}
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
                  notify('음원을 불러오지 못했어요.');
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
        <Txt style={st.h22}>{p.title}</Txt>
        {has && !audio && <Badge>보유 중{applied ? ' · 적용됨' : ''}</Badge>}
        <Txt style={st.body}>
          {p.description}
          {p.kind === 'island' && applied ? ' 지금 우리 섬에 적용돼 있어요.' : ''}
        </Txt>
        {clothes && (
          <Txt kind="meta" style={st.meta}>
            산 사람의 보유품이라 섬을 떠나도 남아요.
          </Txt>
        )}
        {audio && (
          <Txt kind="meta" style={st.meta}>
            주민 누구나 살 수 있어요. 사면 섬 전체가 함께 들어요.
          </Txt>
        )}
      </IslandSheet>
    );
  }

  if (route === 'orders') {
    // 내 구매 = 옷·장신구(날짜·시각), 섬 공동 구매 = 이 섬 테마·음원(날짜·구매자, 방장이면 "방장")
    // 서버 모드는 scope=personal|shared 응답이 정본 — 내역 가격은 당시 확정가 스냅숏이다(GROMO-2017).
    const shared = tab === '섬 공동 구매';
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
        title="구매 내역"
        tight
        onBack={back}
        onClose={home}
      >
        <FTabs
          items={[
            ['내 구매', 'person'],
            ['섬 공동 구매', 'group'],
          ]}
          value={shared ? '섬 공동 구매' : '내 구매'}
          onChange={setTab}
        />
        {server && shopApi.ordersLoading ? (
          <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
            불러오는 중…
          </Txt>
        ) : server && shopApi.ordersError ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
            <Txt kind="meta" style={st.meta}>
              {serverErrorText(shopApi.ordersError) || '구매 내역을 불러오지 못했어요.'}
            </Txt>
            <Btn title="다시 시도" onPress={shopApi.retry} />
          </View>
        ) : list.length ? (
          <SheetGroup>
            {list.map((o) => (
              <SheetRow
                key={o.id}
                title={productTitle(o.product)}
                sub={
                  shared
                    ? [md(o.at), o.buyer && (isHostName(o.buyer) ? '섬장' : o.buyer)]
                        .filter(Boolean)
                        .join(' · ')
                    : `${md(o.at)} · ${hm(o.at)}`
                }
                right={`${o.price}마리`}
                chevron
                onPress={() => go('product', o.product)}
              />
            ))}
          </SheetGroup>
        ) : (
          <Txt kind="meta" style={[st.meta, { textAlign: 'center', paddingVertical: 24 }]}>
            아직 구매한 물건이 없어요.
          </Txt>
        )}
      </IslandSheet>
    );
  }
}
