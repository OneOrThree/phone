import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { formatDuration } from '@/i18n/format';
import { T, useGowun } from '@/screens/island/sceneKit';
import {
  DEFAULT_FRAME_ID,
  ISLAND_STAGE_ART,
  MAGAZINE_FRAMES,
  MAGAZINE_STICKERS,
  MAGAZINE_TAPES,
  MAGAZINE_TELESCOPE_ICON,
  islandStage,
} from '@/constants/magazineAssets';
import { CELL_ASPECT, PromotionLayout, cellTextFit, stickerRect } from './layout';
import { islandTitle } from './islandTitle';

/** 칸 하나에 그리는 값 — 서버 홍보 칸(snapshot + body + layout)과 같은 모양. */
export type AdCellData = {
  name: string;
  buildingCount: number;
  memberCount: number;
  maxMembers: number;
  /** null = 아직 집계 전(0분과 구분) */
  averageFocusMinutesPerDay: number | null;
  body: string;
  layout: PromotionLayout;
};

/**
 * 고양이 잡지 홍보 칸 공용 렌더러(GROMO-2289). 쓰기 화면·잡지 지면·크게 보기·망원경 말풍선 미리보기가 모두 이것으로
 * 칸을 그려 섬장이 꾸민 모양이 어디서나 같다. 모든 치수는 width 에 비례하고(componentTokens.magazineCell),
 * 글자는 기기 글자 크기 설정을 따르지 않는다 — 스티커가 글 위에 겹쳐 붙으므로 줄바꿈이 바뀌면 섬장이 본 모양과
 * 달라진다(P12). 대신 칸 전체가 접근성 요소 하나로 섬 이름·주민·평균·글을 읽는다.
 *
 * 그리는 순서(아래 → 위): 틀 → 섬 프로필·이름·한 줄 글·주민/평균 → 스티커(배열 순) → 테이프 → 오른쪽 아래 corner.
 * corner: 'scope' = 망원경 동그라미(바다판만 — 섬에서 본 잡지에는 없다, 10/14) · 'ours' = 「우리 섬이에요」 · null = 없음.
 * 이 앱 버전이 모르는 재료 id(새 시즌)는 건너뛰고, 모르는 틀은 기본 틀로 그린다.
 */
export function AdCell({
  width,
  cell,
  corner = null,
  onScope,
  onPress,
  onLongPress,
  testID,
}: {
  width: number;
  cell: AdCellData;
  corner?: 'scope' | 'ours' | null;
  onScope?: () => void;
  onPress?: () => void;
  onLongPress?: () => void;
  testID?: string;
}) {
  const font = useGowun();
  const m = componentTokens.magazineCell;
  const W = width;
  const H = W * CELL_ASPECT;
  const k = W / m.referenceWidth;
  const frame = MAGAZINE_FRAMES[cell.layout.frameId] ?? MAGAZINE_FRAMES[DEFAULT_FRAME_ID];
  const [l, top, r, b] = frame.inset;
  const fit = cellTextFit(frame.inset);
  const s = k * fit.scale;
  const d = m.profileDiameter * s;
  const cornerSize = m.cornerSize * k;

  const name = islandTitle(cell.name);
  const residents = t('magazine.cell.residents', {
    count: cell.memberCount,
    max: cell.maxMembers,
  });
  const average =
    cell.averageFocusMinutesPerDay == null
      ? t('magazine.cell.averageUnknown')
      : t('magazine.cell.average', { time: formatDuration(cell.averageFocusMinutesPerDay * 60) });
  const label =
    t('magazine.cell.a11y', { name, residents, average, body: cell.body }) +
    (corner === 'ours' ? `, ${t('magazine.cell.ours')}` : '');
  const text = (size: number, lines?: number) => ({
    fontFamily: font,
    fontSize: size * s,
    lineHeight: size * s * m.lineHeight,
    color: semanticTokens.color.text,
    ...(lines ? { maxHeight: size * s * m.lineHeight * lines } : null),
  });
  const Body = onPress || onLongPress ? Pressable : View;

  return (
    <View testID={testID} style={{ width: W, height: H }}>
      <Body
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={label}
        onPress={onPress}
        onLongPress={onLongPress}
      >
        <Image
          source={frame.source}
          resizeMode="stretch"
          style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: l * W,
            top: top * H,
            width: (1 - l - r) * W,
            height: (1 - top - b) * H,
            justifyContent: 'space-between',
          }}
        >
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.gap * s }}>
              <View
                style={{
                  width: d,
                  height: d,
                  borderRadius: d / 2,
                  backgroundColor: semanticTokens.color.secondary,
                  borderWidth: Math.max(1, semanticTokens.stroke.default * k),
                  borderColor: semanticTokens.color.outline,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                <Image
                  testID={testID && `${testID}-island`}
                  source={ISLAND_STAGE_ART[islandStage(cell.memberCount, cell.buildingCount)]}
                  resizeMode="contain"
                  style={{ width: d * 0.86, height: d * 0.86 }}
                />
              </View>
              <T
                allowFontScaling={false}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                style={[text(m.nameSize), { flex: 1 }]}
              >
                {name}
              </T>
            </View>
            <T
              allowFontScaling={false}
              numberOfLines={fit.bodyLines}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={[text(m.bodySize, fit.bodyLines), { marginTop: m.gap * s }]}
            >
              {cell.body}
            </T>
          </View>
          <T
            allowFontScaling={false}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[
              text(m.metaSize),
              { color: semanticTokens.color.textMuted, marginRight: corner ? cornerSize * 0.6 : 0 },
            ]}
          >
            {`${residents} · ${average}`}
          </T>
        </View>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {cell.layout.stickers.map((st, i) => {
            const art = MAGAZINE_STICKERS[st.assetId];
            if (!art) return null;
            return (
              <Image
                key={`${i}-${st.assetId}`}
                testID={testID && `${testID}-sticker`}
                source={art.source}
                resizeMode="stretch"
                style={{
                  position: 'absolute',
                  ...stickerRect(st, art.aspect, W),
                  transform: [{ rotate: `${st.rotation}deg` }],
                }}
              />
            );
          })}
          {cell.layout.tape && MAGAZINE_TAPES[cell.layout.tape.assetId] && (
            <Image
              testID={testID && `${testID}-tape`}
              source={MAGAZINE_TAPES[cell.layout.tape.assetId].source}
              resizeMode="stretch"
              style={{
                position: 'absolute',
                ...stickerRect(
                  { ...cell.layout.tape, scale: m.tapeWidthRatio },
                  MAGAZINE_TAPES[cell.layout.tape.assetId].aspect,
                  W,
                ),
                transform: [{ rotate: `${cell.layout.tape.rotation}deg` }],
              }}
            />
          )}
        </View>
      </Body>
      {corner === 'scope' && (
        <Pressable
          testID={testID && `${testID}-scope`}
          accessibilityRole="button"
          accessibilityLabel={t('magazine.cell.scope', { name })}
          onPress={onScope}
          hitSlop={Math.max(0, (semanticTokens.size.tapMin - cornerSize) / 2)}
          style={{
            position: 'absolute',
            right: -cornerSize * 0.15,
            bottom: -cornerSize * 0.15,
            width: cornerSize,
            height: cornerSize,
            borderRadius: cornerSize / 2,
            backgroundColor: semanticTokens.color.surface,
            borderWidth: Math.max(1, semanticTokens.stroke.strong * k),
            borderColor: semanticTokens.color.outline,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Image
            source={MAGAZINE_TELESCOPE_ICON}
            resizeMode="contain"
            style={{ width: cornerSize * 0.66, height: cornerSize * 0.66 }}
          />
        </Pressable>
      )}
      {corner === 'ours' && (
        // 배지는 장식 — 읽는 이름에 「우리 섬이에요」가 이미 들어 있다
        <View
          testID={testID && `${testID}-ours`}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            right: -4 * k,
            bottom: -6 * k,
            paddingHorizontal: 8 * k,
            paddingVertical: 2 * k,
            borderRadius: semanticTokens.radius.full,
            borderWidth: Math.max(1, componentTokens.badge.borderWidth * k),
            borderColor: componentTokens.badge.default.border,
            backgroundColor: componentTokens.badge.default.background,
            transform: [{ rotate: '-4deg' }],
          }}
        >
          <T
            allowFontScaling={false}
            style={{
              fontFamily: font,
              fontSize: 12 * k,
              lineHeight: 12 * k * m.lineHeight,
              color: componentTokens.badge.default.foreground,
            }}
          >
            {t('magazine.cell.ours')}
          </T>
        </View>
      )}
    </View>
  );
}
