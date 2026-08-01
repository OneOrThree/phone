// 가로 집중 화면용 플립(split-flap) 시계 — 카드가 한 장씩 접혀 넘어가는 스플릿플랩 방식(GROMO-973).
// New Architecture에서 옛 flip 라이브러리(MatrixMath deep import)가 깨져 Reanimated로 자작한다.
// 각 자리(FlipDigit)는 값이 바뀔 때만 rotateX로 접히고, 바뀌지 않은 자리는 애니메이션하지 않는다.
import { memo, useEffect, useRef, useState, Fragment } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Extrapolation,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { T, withAlpha } from '@/constants/theme';

const FLIP_MS = 320;

// 초 → 자리 문자열. hhmmss=6자리(HHMMSS), mmss=4자리(MMSS, 분 단위 뽀모도로용).
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
function digitsFor(seconds: number, format: 'hhmmss' | 'mmss'): string {
  const s = Math.max(0, Math.floor(seconds));
  if (format === 'mmss') {
    return pad2(Math.floor(s / 60)) + pad2(s % 60);
  }
  return pad2(Math.floor(s / 3600)) + pad2(Math.floor((s % 3600) / 60)) + pad2(s % 60);
}

interface DigitProps {
  char: string;
  size: number;
}

// 한 자리 카드 — 정적 위/아래 반쪽 + 접히는 잎(윗잎=옛값, 아랫잎=새값).
// 값이 바뀌면 progress 0→1: 윗잎이 접혀 내려가며 새 윗면이 드러나고, 아랫잎이 펼쳐지며 마무리.
const FlipDigit = memo(function FlipDigit({ char, size }: DigitProps) {
  const width = Math.round(size * 0.64);
  const half = size / 2;
  const radius = Math.round(size * 0.09);
  const fontSize = Math.round(size * 0.72);

  const [pair, setPair] = useState({ prev: char, next: char });
  const prevRef = useRef(char);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (char === prevRef.current) return;
    const prev = prevRef.current;
    prevRef.current = char;
    setPair({ prev, next: char });
    progress.value = 0;
    progress.value = withTiming(
      1,
      { duration: FLIP_MS, easing: Easing.inOut(Easing.quad) },
      (fin) => {
        // 완료 시 두 반쪽 모두 새 값으로 안착 → 다음 변경까지 정지 상태 유지
        if (fin) runOnJS(setPair)({ prev: char, next: char });
      },
    );
  }, [char, progress]);

  const topLeafStyle = useAnimatedStyle(() => ({
    opacity: progress.value < 0.5 ? 1 : 0,
    transform: [
      { perspective: 500 },
      { rotateX: `${interpolate(progress.value, [0, 0.5], [0, -90], Extrapolation.CLAMP)}deg` },
    ],
  }));
  const bottomLeafStyle = useAnimatedStyle(() => ({
    opacity: progress.value < 0.5 ? 0 : 1,
    transform: [
      { perspective: 500 },
      { rotateX: `${interpolate(progress.value, [0.5, 1], [90, 0], Extrapolation.CLAMP)}deg` },
    ],
  }));

  const glyphTop = [g.glyph, { height: size, lineHeight: size, fontSize, top: 0 }];
  const glyphBottom = [g.glyph, { height: size, lineHeight: size, fontSize, bottom: 0 }];
  const topBox = [
    g.half,
    { height: half, top: 0, borderTopLeftRadius: radius, borderTopRightRadius: radius },
    g.topBg,
  ];
  const bottomBox = [
    g.half,
    { height: half, bottom: 0, borderBottomLeftRadius: radius, borderBottomRightRadius: radius },
    g.bottomBg,
  ];

  return (
    <View style={[g.digit, { width, height: size }]}>
      {/* 정적 윗면(새 값) — 윗잎이 접히면 드러난다 */}
      <View style={topBox}>
        <Text style={glyphTop}>{pair.next}</Text>
      </View>
      {/* 정적 아랫면(옛 값) — 아랫잎이 덮을 때까지 남는다 */}
      <View style={bottomBox}>
        <Text style={glyphBottom}>{pair.prev}</Text>
      </View>
      {/* 접히는 윗잎(옛 값) */}
      <Animated.View style={[topBox, g.leafTop, topLeafStyle]}>
        <Text style={glyphTop}>{pair.prev}</Text>
      </Animated.View>
      {/* 펼쳐지는 아랫잎(새 값) */}
      <Animated.View style={[bottomBox, g.leafBottom, bottomLeafStyle]}>
        <Text style={glyphBottom}>{pair.next}</Text>
      </Animated.View>
    </View>
  );
});

interface FlipClockProps {
  seconds: number;
  format?: 'hhmmss' | 'mmss';
  size?: number;
}

// 시:분:초(또는 분:초) 플립 시계. 그룹(HH·MM·SS) 사이에 콜론.
export function FlipClock({ seconds, format = 'hhmmss', size = 92 }: FlipClockProps) {
  const str = digitsFor(seconds, format);
  const groups =
    format === 'mmss'
      ? [
          [0, 1],
          [2, 3],
        ]
      : [
          [0, 1],
          [2, 3],
          [4, 5],
        ];
  const gap = Math.round(size * 0.06);
  const colonSize = Math.round(size * 0.42);

  return (
    <View style={[g.row, { gap }]}>
      {groups.map((group, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <Text style={[g.colon, { fontSize: colonSize }]}>:</Text>}
          {group.map((idx) => (
            <FlipDigit key={idx} char={str[idx]} size={size} />
          ))}
        </Fragment>
      ))}
    </View>
  );
}

const g = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  colon: {
    color: withAlpha(T.white, 0.5),
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginHorizontal: 2,
  },
  digit: { position: 'relative' },
  half: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  // 검정 카드(위가 살짝 밝고 아래가 더 검다) + 중앙 접힘선
  topBg: {
    backgroundColor: T.dark,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.black,
  },
  bottomBg: { backgroundColor: T.black },
  glyph: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: T.paperLight,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  leafTop: { transformOrigin: '50% 100%', backfaceVisibility: 'hidden', zIndex: 2 },
  leafBottom: { transformOrigin: '50% 0%', backfaceVisibility: 'hidden', zIndex: 2 },
});
