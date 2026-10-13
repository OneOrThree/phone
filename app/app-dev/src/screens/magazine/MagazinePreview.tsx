import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { semanticTokens } from '@/design-system/tokens';
import { T } from '@/screens/island/sceneKit';
import { MAGAZINE_FRAMES } from '@/constants/magazineAssets';
import { AdCell, AdCellData } from './AdCell';
import { CELL_ASPECT, PromotionLayout } from './layout';
import { EditorDriver, PromotionEditor } from './PromotionEditor';
import { createTouchDriver } from './touchDriver';
import { CANVAS_PAD } from './useStickerGestures';
import { demoState } from '@/services/model';

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
  { assetId: 'mag.cat-ginger-fish', x: 0.85, y: 0.22, scale: 0.2, rotation: -10 },
  { assetId: 'mag.heart', x: 0.9, y: 0.82, scale: 0.09, rotation: 12 },
  { assetId: 'mag.star', x: 0.08, y: 0.1, scale: 0.08, rotation: -8 },
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
    tape: i % 4 === 0 ? { assetId: 'mag.tape-yellowcheck', x: 0.5, y: 0.04, rotation: -4 } : null,
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
              <AdCell key={w} width={w} cell={cellOf('mag.frame-catear', 1)} corner="scope" />
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

/**
 * 개발 전용 — 홍보 쓰기 화면(PromotionEditor)을 목업 서버(EXPO_PUBLIC_DEMO=1 · EXPO_PUBLIC_MAGAZINE_MOCK)로 띄우고, 손가락 없이
 * 대본대로 판의 PanResponder 에 진짜 터치 모양 이벤트(touchDriver)와 버튼 동작을 5초마다 하나씩 넣는다. 위 띠에 단계 이름이
 * 보여 시뮬레이터 캡처만으로 끌기 · 두 손가락 크기·회전 · 손잡이 · 맨 앞으로 · 지우기 · 10개 제한 · 테이프 · 접수 완료를 훑는다.
 * `EXPO_PUBLIC_MAGAZINE_PREVIEW=editor` 로 Metro 를 띄운다.
 */
export function MagazineEditorPreview() {
  const driver = useRef<EditorDriver | null>(null);
  const [step, setStep] = useState('불러오는 중');
  const [toast, setToast] = useState<string | null>(null);
  const [e] = useState(() => ({
    state: demoState(),
    back: () => {},
    go: () => {},
    notify: (message: string) => {
      setToast(message);
      setTimeout(() => setToast(null), 4500);
    },
  }));
  useEffect(() => {
    let alive = true;
    const at = (x: number, y: number) => {
      const w = driver.current!.cellW;
      return { x: (CANVAS_PAD + x) * w, y: (CANVAS_PAD + y) * w * CELL_ASPECT };
    };
    const touch = () => createTouchDriver(driver.current!.canvas);
    const steps: [string, () => void | Promise<void>][] = [
      ['1 지난번 칸으로 열림', () => {}],
      [
        '2 한 줄 글 60자',
        () =>
          driver.current!.body(
            '같이 아침 공부하실 분 환영해요! 조용한 섬이라 집중이 잘 되고 저녁엔 모닥불에서 다 같이 쉬어요 놀러 와요',
          ),
      ],
      ['3 틀 고르기 · 파란 티켓', () => driver.current!.frame('mag.frame-ticket')],
      ['4 스티커 붙이기(가운데·골라짐)', () => driver.current!.sticker('mag.cat-gray-cheer')],
      ['5 한 손가락 끌기 → 왼쪽 아래', () => touch().drag(at(0.5, 0.5), at(0.22, 0.68))],
      [
        '6 두 손가락 벌리고 30도 돌리기',
        () => {
          const d = touch();
          d.down(at(0.17, 0.68));
          d.second(at(0.27, 0.68));
          for (let i = 1; i <= 6; i++) {
            const a = (Math.PI / 6) * (i / 6);
            const r = 0.05 + 0.04 * (i / 6);
            d.move(
              {
                x: at(0.22, 0.68).x - Math.cos(a) * r * driver.current!.cellW,
                y: at(0.22, 0.68).y - Math.sin(a) * r * driver.current!.cellW,
              },
              {
                x: at(0.22, 0.68).x + Math.cos(a) * r * driver.current!.cellW,
                y: at(0.22, 0.68).y + Math.sin(a) * r * driver.current!.cellW,
              },
            );
          }
          d.up();
        },
      ],
      ['7 다른 스티커 위로 겹치기(별)', () => driver.current!.sticker('mag.star')],
      ['8 별을 고양이 위로 끌기', () => touch().drag(at(0.5, 0.5), at(0.26, 0.62))],
      [
        '9 고양이 고르고 맨 앞으로',
        () => {
          const d = touch();
          d.down(at(0.17, 0.74));
          d.up();
          driver.current!.op('front');
        },
      ],
      [
        '10 손잡이로 크기·회전(한 손가락)',
        () => {
          const h = driver.current!.handle();
          if (h) touch().drag(h, { x: h.x + 26, y: h.y - 18 });
        },
      ],
      ['11 고른 것 지우기', () => driver.current!.op('delete')],
      [
        '12 스티커 10개 채우고 11번째(안내)',
        async () => {
          // 실제 탭처럼 한 번 붙일 때마다 화면이 다시 그려지게 사이를 둔다
          for (let i = 0; i < 9; i++) {
            driver.current!.sticker(i % 2 ? 'mag.heart' : 'mag.fish');
            await new Promise((r) => setTimeout(r, 60));
          }
        },
      ],
      ['13 테이프 붙이기(분홍)', () => driver.current!.tape('mag.tape-pink')],
      [
        '14 테이프 끌어 놓기 → 오른쪽 테두리에 붙음',
        () => touch().drag(at(0.5, 0.04), at(0.8, 0.45)),
      ],
      ['15 다른 테이프로 바꿔 끼우기(민트)', () => driver.current!.tape('mag.tape-mint')],
      ['16 잡지에 싣기 → 접수 완료', () => driver.current!.submit()],
      ['17 확인 → 고치기 모드', () => driver.current!.closeDone()],
    ];
    (async () => {
      await new Promise((r) => setTimeout(r, 3000));
      for (const [name, run] of steps) {
        if (!alive || !driver.current) return;
        setStep(name);
        try {
          await run();
        } catch (err) {
          setStep(`${name} — 실패 ${String(err)}`);
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1 }}>
        <PromotionEditor e={e} driver={driver} />
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, right: 0, top: 44, alignItems: 'center' }}
        >
          <T style={{ fontSize: 12, backgroundColor: '#ffffffdd', paddingHorizontal: 8 }}>{step}</T>
        </View>
        {toast && (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 20, right: 20, bottom: 140, alignItems: 'center' }}
          >
            <T
              style={{
                color: semanticTokens.color.surface,
                backgroundColor: semanticTokens.color.text,
                padding: 10,
                borderRadius: 12,
              }}
            >
              {toast}
            </T>
          </View>
        )}
      </View>
    </SafeAreaProvider>
  );
}
