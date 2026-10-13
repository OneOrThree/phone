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

/** 섬 프로필 원 지름 대비 섬 그림 상자 크기. 가로로 긴 그림(비율 ~1.9)이 원을 거의 채운다. */
const ISLAND_ZOOM = 1.3;

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
  onReport,
  testID,
}: {
  width: number;
  cell: AdCellData;
  corner?: 'scope' | 'ours' | null;
  onScope?: () => void;
  onPress?: () => void;
  /** 신고 — 칸 길게 누르기와 스크린리더 「신고하기」 동작이 부른다. */
  onReport?: () => void;
  testID?: string;
}) {
  const font = useGowun();
  const m = componentTokens.magazineCell;
  const W = width;
  const H = W * CELL_ASPECT;
  const k = W / m.referenceWidth;
  const frame = MAGAZINE_FRAMES[cell.layout.frameId] ?? MAGAZINE_FRAMES[DEFAULT_FRAME_ID];
  const [l, top, r, b] = frame.inset;
  const fit = cellTextFit(frame);
  const s = k * fit.scale;
  const d = m.profileDiameter * s;
  const cornerSize = m.cornerSize * k;
  const scopeTouch = Math.max(cornerSize, semanticTokens.size.tapMin);
  const ours = t('magazine.cell.ours');
  const oursFont = m.metaSize * s;
  // 배지 폭 어림(한글 0.92em) — 주민/평균 줄이 배지 밑으로 들어가지 않게 그만큼 비운다
  const oursWidth = ours.length * 0.92 * oursFont + 14 * k;

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
    (corner === 'ours' ? `, ${ours}` : '');
  const text = (size: number, scale = s, lines?: number) => ({
    fontFamily: font,
    fontSize: size * scale,
    lineHeight: size * scale * m.lineHeight,
    color: semanticTokens.color.text,
    ...(lines ? { maxHeight: size * scale * m.lineHeight * lines } : null),
  });
  const Body = onPress || onReport ? Pressable : View;

  return (
    <View testID={testID} style={{ width: W, height: H }}>
      <Body
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={label}
        onPress={onPress}
        onLongPress={onReport}
        accessibilityActions={
          onReport ? [{ name: 'report', label: t('magazine.report.action') }] : undefined
        }
        onAccessibilityAction={
          onReport && ((ev) => ev.nativeEvent.actionName === 'report' && onReport())
        }
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
            // 글 맞춤이 빗나가도 틀 밖으로는 그리지 않는다
            overflow: 'hidden',
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
                {/* 섬 그림이 가로로 길어 원 안에 그대로 넣으면 위아래가 빈다 — 원보다 크게 그려 가운데를 채운다(양옆 물은 잘림) */}
                <Image
                  testID={testID && `${testID}-island`}
                  source={ISLAND_STAGE_ART[islandStage(cell.memberCount, cell.buildingCount)]}
                  resizeMode="contain"
                  style={{ width: d * ISLAND_ZOOM, height: d * ISLAND_ZOOM }}
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
              style={[text(m.bodySize, k * fit.bodyScale, fit.bodyLines), { marginTop: m.gap * s }]}
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
              {
                color: semanticTokens.color.textMuted,
                marginLeft: (frame.metaLeft ?? 0) * W,
                marginRight:
                  corner === 'ours' ? oursWidth : corner === 'scope' ? cornerSize * 0.6 : 0,
              },
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
        // 누르는 상자는 칸 안 오른쪽 아래에 44pt 이상으로 둔다 — 부모(칸) 밖으로 나간 부분은 hitSlop 으로도
        // 터치가 오지 않는다. 동그라미 그림만 상자보다 작게 그려 칸 모서리에 살짝 걸친다
        <Pressable
          testID={testID && `${testID}-scope`}
          accessibilityRole="button"
          accessibilityLabel={t('magazine.cell.scope', { name })}
          onPress={onScope}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: scopeTouch,
            height: scopeTouch,
          }}
        >
          <View
            pointerEvents="none"
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
          </View>
        </Pressable>
      )}
      {corner === 'ours' && (
        // 배지는 장식 — 읽는 이름에 「우리 섬이에요」가 이미 들어 있다. 칸 안 글 상자 오른쪽 아래(주민 줄 높이)에 둔다
        <View
          testID={testID && `${testID}-ours`}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            right: r * W,
            bottom: b * H,
            paddingHorizontal: 6 * k,
            borderRadius: semanticTokens.radius.full,
            borderWidth: Math.max(1, componentTokens.badge.borderWidth * k),
            borderColor: componentTokens.badge.default.border,
            backgroundColor: componentTokens.badge.default.background,
            transform: [{ rotate: '-3deg' }],
          }}
        >
          <T
            allowFontScaling={false}
            numberOfLines={1}
            style={{
              fontFamily: font,
              fontSize: oursFont,
              lineHeight: oursFont * m.lineHeight,
              color: componentTokens.badge.default.foreground,
            }}
          >
            {ours}
          </T>
        </View>
      )}
    </View>
  );
}
