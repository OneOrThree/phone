import React, { useEffect, useRef } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { semanticTokens } from '@/design-system/tokens';
import { T } from '@/screens/island/sceneKit';
import { MAGAZINE_FRAMES } from '@/constants/magazineAssets';
import { AdCell, AdCellData } from './AdCell';
import { CELL_ASPECT, PromotionLayout } from './layout';

/**
 * 개발 전용 — 틀 11개 × 글(짧은 글 · 60자 한글 · 띄어쓰기 없는 60자 · 이모지 섞인 60자) × 스티커·테이프를
 * 한 화면에 늘어놓아 글이 칸을 넘치는지 눈으로 본다. 웹은 `?magazine`, 네이티브 개발 빌드는
 * `EXPO_PUBLIC_MAGAZINE_PREVIEW=1` 로 Metro 를 띄우면 앱 대신 이 화면이 뜬다. 제품 화면에서는 쓰지 않는다.
 * `EXPO_PUBLIC_MAGAZINE_PREVIEW=auto` 면 5초마다 다음 틀로 저절로 넘겨 시뮬레이터 화면 캡처만으로 전부 훑는다.
 */
const AUTO = process.env.EXPO_PUBLIC_MAGAZINE_PREVIEW === 'auto';
const TEXTS = [
  '같이 공부해요!',
  '같이 아침 공부하실 분 환영해요! 조용한 섬이라 집중이 잘 되고 저녁엔 모닥불에서 다 같이 쉬어요 놀러 와요',
  '집중하는고양이섬'.repeat(8).slice(0, 60),
  '🐟🐱 물고기 잡으러 오세요! 매일 아침 7시 같이 집중 ☀️ 도서관 축음기 다 있어요 WWW 🎉 주민 모집!',
];
const NAMES = ['소다', '별고래섬', '아주아주길고긴이름을가진고양이들의작은섬마을'];
const STICKERS: PromotionLayout['stickers'] = [
  { assetId: 'mag.sticker.cat-ginger-fish', x: 0.85, y: 0.22, scale: 0.2, rotation: -10 },
  { assetId: 'mag.sticker.heart', x: 0.9, y: 0.82, scale: 0.09, rotation: 12 },
  { assetId: 'mag.sticker.star', x: 0.08, y: 0.1, scale: 0.08, rotation: -8 },
];
const cellOf = (frameId: string, i: number): AdCellData => ({
  name: NAMES[i % NAMES.length],
  buildingCount: i % 8,
  memberCount: 1 + (i % 15),
  maxMembers: 15,
  averageFocusMinutesPerDay: i % 5 === 4 ? null : 37 + ((i * 41) % 600),
  body: TEXTS[i % TEXTS.length],
  layout: {
    v: 1,
    frameId,
    stickers: i % 2 ? STICKERS : STICKERS.slice(0, 1),
    tape: i % 4 === 0 ? { assetId: 'mag.tape.yellowcheck', x: 0.5, y: 0.04, rotation: -4 } : null,
  },
});

export function MagazinePreview() {
  const { width } = useWindowDimensions();
  const W = Math.min(width, 520) - 32;
  const frames = Object.keys(MAGAZINE_FRAMES);
  const scroll = useRef<ScrollView>(null);
  const tops = useRef<number[]>([]);
  useEffect(() => {
    if (!AUTO) return;
    // 틀마다 두 번 — 칸 4개가 한 화면에 다 안 들어가 위 두 칸·아래 두 칸으로 나눠 멈춘다
    const half = 2 * (W * CELL_ASPECT + 18);
    let page = 0;
    const id = setInterval(() => {
      page = (page + 1) % (frames.length * 2 + 1);
      const top = page ? tops.current[(page - 1) >> 1] + ((page - 1) % 2) * half : 0;
      scroll.current?.scrollTo({ y: top, animated: false });
    }, 5000);
    return () => clearInterval(id);
  }, [frames.length, W]);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: semanticTokens.color.canvas }}>
        <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 28 }}>
          <T style={{ fontSize: 18, fontWeight: '700' }}>잡지 칸 미리보기 · 같은 칸 너비 4가지</T>
          <View style={{ gap: 16, alignItems: 'flex-start' }}>
            {[W, 300, 200, 120].map((w) => (
              <AdCell key={w} width={w} cell={cellOf('mag.frame.catear', 1)} corner="scope" />
            ))}
          </View>
          {frames.map((frameId, f) => (
            <View
              key={frameId}
              style={{ gap: 18 }}
              onLayout={(ev) => (tops.current[f] = ev.nativeEvent.layout.y)}
            >
              <T
                style={{ fontSize: 15, fontWeight: '700' }}
              >{`${f + 1}/${frames.length} ${frameId}`}</T>
              {TEXTS.map((_, i) => (
                <AdCell
                  key={i}
                  width={W}
                  cell={cellOf(frameId, f * TEXTS.length + i)}
                  corner={i === 1 ? 'ours' : i === 3 ? 'scope' : null}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
