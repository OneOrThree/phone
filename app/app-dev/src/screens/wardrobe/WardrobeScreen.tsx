import { OutfitItemArt } from '@/components/CatOutfitLayers';
import { Badge, C, EmptyState, Pic, Txt } from '@/design-system/patterns';
import { t } from '@/i18n';
import { customizationTitle } from '@/i18n/customization';
import { IslandSheet, st } from '@/screens/island/IslandSheet';
import { seaLoaf } from '@/screens/sea/seaAssets';
import { products } from '@/services/model';
import { markOutfitSeen } from '@/services/unseenOutfits';
import React from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '../island/navigation/screenParts';
import type { ScreenContext } from '../island/navigation/useScreenState';

// 분홍 원 체크(퀘스트 달성·선택한 카드·착용 중)
function CheckDot({ size = 22 }: any) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: C.brown,
        backgroundColor: C.pink,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="check" size={size * 0.55} stroke={3} />
    </View>
  );
}

// 꾸미기 「기본」(장착 안 함) 칸 — 빈 박스 대신 «없음»(원+사선)을 그려 벗는 선택임을 알린다
function NoneSlot({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path
        d="M28 16a12 12 0 1 0-24 0a12 12 0 1 0 24 0"
        stroke={C.muted}
        strokeWidth={2.4}
        fill="none"
      />
      <Path d="M8.5 8.5L23.5 23.5" stroke={C.muted} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}
export function renderWardrobeScreen(context: ScreenContext) {
  const {
    route,
    state,
    unseenOutfits,
    server,
    shopApi,
    serverErrorText,
    notify,
    catalog,
    accountBg,
    back,
    home,
    raftCat,
    productTitle,
  } = context;

  if (route === 'wardrobe') {
    // 가진 장신구만 보여 주고, 누르면 바로 입는다(선택 = 적용). 슬롯은 인벤토리 그룹이 정한다.
    type WardrobeSlot = 'decor' | 'head' | 'neck' | 'shoes';
    const slotWorn = (slot: WardrobeSlot): string | null => {
      const v = state.equipped[slot];
      return v == null || v === 'default' || v === 'none' ? null : v;
    };
    const thumb = (
      slot: WardrobeSlot,
      value: string | null,
      label: string,
      picture: React.ReactNode,
      a11yLabel: string = label,
    ) => {
      const on = slotWorn(slot) === value;
      const fresh = value != null && unseenOutfits.has(value);
      return (
        <Pressable
          key={`${slot}:${value}`}
          accessibilityRole="button"
          accessibilityLabel={fresh ? `${a11yLabel} ${t('common.newBadge')}` : a11yLabel}
          accessibilityState={{ selected: on }}
          onPress={() => {
            if (fresh) markOutfitSeen(value);
            // 서버 모드는 PATCH /me/appearance 가 정본 — 실패하면 착용 표시도 바꾸지 않는다. null 은 해제.
            if (server) {
              shopApi.equip({ [slot]: value }).catch((thrown) => {
                const m = serverErrorText(thrown);
                if (m) notify(m);
              });
            }
          }}
          style={{ width: 76, gap: 5, alignItems: 'center' }}
        >
          <View
            style={{
              width: 76,
              height: 76,
              borderWidth: 2,
              borderColor: on ? C.brown : '#D9C6B8',
              borderRadius: 16,
              backgroundColor: on ? C.soft : C.paper,
              boxShadow: on ? '0px 3px 0px ' + C.brown : 'none',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {picture}
            {on && (
              <View style={{ position: 'absolute', top: -6, right: -6 }}>
                <CheckDot />
              </View>
            )}
            {fresh && (
              <Badge small style={{ position: 'absolute', top: -8, left: -6 }}>
                {t('common.newBadge')}
              </Badge>
            )}
          </View>
          <Txt
            style={{
              fontSize: 12,
              lineHeight: 17.4,
              fontWeight: on ? '700' : '600',
              color: on ? C.ink : C.muted,
            }}
          >
            {label}
          </Txt>
        </Pressable>
      );
    };
    const slotIds = (slot: WardrobeSlot): string[] =>
      server ? ((shopApi.my?.[slot] as string[] | undefined) ?? []) : [];

    const picture = (slot: WardrobeSlot, id: string) => {
      const entry = catalog[id];
      // 집중 보상 목은 원본 전체가 아니라 앞 장식만 잘라 보인다(GROMO-2382)
      if (entry) return <OutfitItemArt entry={entry} size={60} testID={`wardrobe-art-${id}`} />;
      return slot === 'decor' ? <Pic id="scarf-cat" w={60.5} /> : null;
    };
    // 퇴역 항목은 서랍에서 빼되, 이미 입고 있으면 남겨 벗을 수 있게 한다
    const shelf = (slot: WardrobeSlot) =>
      slotIds(slot).filter((id) => !catalog[id]?.retiredAt || id === slotWorn(slot));
    const slots = (['decor', 'head', 'neck', 'shoes'] as const).filter(
      (slot) => shelf(slot).length > 0 || slotWorn(slot),
    );
    // 옷장에 칸을 그리지 않는 옷(clothes)도 가졌거나 입고 있으면 «없음»이 아니다.
    // hulls 는 보유가 아니라 모두에게 같은 상수(["raft"])라 세지 않는다
    const hasClothes =
      !!shopApi.my?.clothes?.length || !['default', 'none'].includes(state.equipped.clothes);
    return (
      <IslandSheet
        bg={accountBg}
        sign="boat/raft"
        title={t('wardrobe.title')}
        tall
        tight
        onBack={back}
        onClose={home}
      >
        {raftCat(260)}
        {/* 서버는 보유품을 받은 뒤에만 «없음»을 말한다 */}
        {!slots.length && !hasClothes && (!server || shopApi.my) && (
          <EmptyState
            testID="wardrobe-empty"
            art={seaLoaf[state.color]}
            title={t('emptyState.wardrobe')}
          />
        )}
        {slots.map((slot) => {
          const ids = shelf(slot);
          return (
            <View key={slot} style={{ gap: 10 }}>
              <Txt kind="section" style={st.sec}>
                {t(`wardrobe.section.${slot}`)}
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {thumb(
                  slot,
                  null,
                  t('wardrobe.default'),
                  <NoneSlot />,
                  // 슬롯마다 같은 「기본」이 네 번 읽히지 않게 슬롯 이름을 붙인다
                  t('wardrobe.defaultFor', { slot: t(`wardrobe.section.${slot}`) }),
                )}
                {ids.map((id) =>
                  thumb(
                    slot,
                    id,
                    server
                      ? customizationTitle(id, catalog[id]?.title ?? productTitle(id))
                      : products.find((p) => p.id === id)?.title || id,
                    picture(slot, id),
                  ),
                )}
              </View>
            </View>
          );
        })}
      </IslandSheet>
    );
  }
}
