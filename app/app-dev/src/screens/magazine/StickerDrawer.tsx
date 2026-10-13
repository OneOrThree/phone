import React from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { Chips, Txt } from '@/design-system/patterns';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { MAGAZINE_STICKERS, MAGAZINE_TAPES, StickerTab } from '@/constants/magazineAssets';

const TABS: StickerTab[] = ['cat', 'sea', 'friends', 'deco'];
/** 재료 이름(접근성) — id 의 "mag." 뒤가 번역 키다. */
export const assetName = (id: string) => t(`magazine.asset.${id.replace(/^mag\./, '')}`);

/**
 * 스티커 서랍(C1 아래) — 탭 넷(고양이 · 바다 · 친구들 · 꾸미기), 꾸미기 탭 첫 줄은 마스킹테이프(1개, 다시 고르면 바꿔 끼움).
 * 칸을 누르면 붙는다(가운데 · 맨 위). 10개가 차면 스티커 칸이 흐려지고 누르면 안내만 뜬다(owned 아닌 재료도 흐리게 잠근다).
 */
export function StickerDrawer({
  tab,
  onTab,
  full,
  owned,
  tapeId,
  onSticker,
  onTape,
  onFull,
}: {
  tab: StickerTab;
  onTab: (tab: StickerTab) => void;
  full: boolean;
  owned: (id: string) => boolean;
  tapeId: string | null;
  onSticker: (id: string) => void;
  onTape: (id: string) => void;
  onFull: () => void;
}) {
  const labels = TABS.map((x) => t(`magazine.editor.tabs.${x}`));
  const stickers = Object.entries(MAGAZINE_STICKERS).filter(([, s]) => s.tab === tab);
  return (
    <View style={{ flex: 1, gap: semanticTokens.spacing.control }}>
      {/* 탭은 44pt(large), 좁은 화면(320pt)에서는 두 줄로 감긴다 */}
      <Chips
        large
        wrap
        items={labels}
        value={labels[TABS.indexOf(tab)]}
        onChange={(label: string) => onTab(TABS[labels.indexOf(label)])}
      />
      <ScrollView
        testID="sticker-drawer"
        // 쓰기 화면 본문도 세로 스크롤이라 Android 에서는 안쪽 서랍이 제스처를 받게 따로 켠다
        nestedScrollEnabled
        contentContainerStyle={{
          gap: semanticTokens.spacing.control,
          paddingBottom: primitiveTokens.space[2],
        }}
        showsVerticalScrollIndicator={false}
      >
        {tab === 'deco' && (
          <>
            <Txt kind="meta">{t('magazine.editor.tapes')}</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: primitiveTokens.space[2] }}>
              {Object.entries(MAGAZINE_TAPES).map(([id, tape]) => (
                <Tile
                  key={id}
                  id={id}
                  wide
                  source={tape.source}
                  selected={tapeId === id}
                  locked={!owned(id)}
                  onPress={() => onTape(id)}
                />
              ))}
            </View>
          </>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: primitiveTokens.space[2] }}>
          {stickers.map(([id, s]) => (
            <Tile
              key={id}
              id={id}
              source={s.source}
              dim={full}
              locked={!owned(id)}
              onPress={() => (full ? onFull() : onSticker(id))}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Tile({
  id,
  source,
  wide = false,
  selected = false,
  dim = false,
  locked,
  onPress,
}: {
  id: string;
  source: any;
  wide?: boolean;
  selected?: boolean;
  dim?: boolean;
  locked: boolean;
  onPress: () => void;
}) {
  const name = assetName(id);
  const tile = componentTokens.promotionEditor;
  return (
    <Pressable
      testID={`drawer-${id}`}
      accessibilityRole="button"
      accessibilityLabel={locked ? t('magazine.editor.lockedAsset', { name }) : name}
      accessibilityState={{ selected, disabled: locked }}
      disabled={locked}
      onPress={onPress}
      style={{
        width: wide ? tile.tapeTileWidth : tile.stickerTile,
        height: wide ? semanticTokens.size.tapMin : tile.stickerTile,
        borderRadius: semanticTokens.radius.control,
        borderWidth: selected ? semanticTokens.stroke.strong : semanticTokens.stroke.default,
        borderColor: selected ? semanticTokens.color.outline : primitiveTokens.color.controlIdle,
        backgroundColor: selected ? semanticTokens.color.selected : semanticTokens.color.surface,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: locked || dim ? componentTokens.button.disabledOpacity : 1,
      }}
    >
      <Image
        source={source}
        resizeMode="contain"
        style={wide ? tile.tapeArt : { width: tile.stickerArt, height: tile.stickerArt }}
      />
    </Pressable>
  );
}
