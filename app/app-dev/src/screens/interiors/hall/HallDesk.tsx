import { GOWUN } from '@/screens/island/sceneKit';
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { ease, easeInOut, reactStyle, useEased, useKeyframe } from '../shared/motion';
import { INK, exact, fill } from '../shared/styles';
import { Text } from '../shared/typography';
import { ArtifactProps } from '../types';
import { Blueprint, BuildingGrid, HallPill, useBlueprint } from './Construction';
import { IslandManagement } from './IslandManagement';
import { MUTED, hallFont, nowrap } from './hallStyles';

// ───────── 마을회관 책상 ─────────

const deskSpots = [
  {
    box: { left: '28%', top: '43%', width: '44%', height: '18%' },
    label: { left: '14%', bottom: '9%' },
  },
  {
    box: { left: '20%', top: '31%', width: '60%', height: '15%' },
    label: { left: '50%', bottom: -5 },
  },
  {
    box: { right: '7%', top: '55%', width: '27%', height: '15%' },
    label: { left: '50%', bottom: -3 },
  },
] as const;

const deskPanels = ['island', 'buildings', 'ledger'] as const;

// .hall-desk .object-choice i: @keyframes hall-hotspot 1.8s ease-in-out infinite (0%·100% 6px 링, 50% 11px 링 · 1.06배)
// 웹은 원본과 같은 CSS 애니메이션을 건다 (그림자 문자열은 Animated 보간으로 적용되지 않는다). 네이티브는 크기만 뛴다
const ring = (spread: number, alpha: string, scale: number) => ({
  transform: `translate(-50%,-50%) scale(${scale})`,
  boxShadow: `0 0 0 2px #fff9,0 0 0 ${spread}px #f4a7bb${alpha}`,
});

const deskPulse =
  Platform.OS === 'web'
    ? StyleSheet.create({
        pulse: {
          animationKeyframes: [
            { '0%': ring(6, '55', 1), '50%': ring(11, '1c', 1.06), '100%': ring(6, '55', 1) },
          ],
          animationDuration: '1.8s',
          animationTimingFunction: 'ease-in-out',
          animationIterationCount: 'infinite',
        } as any,
      }).pulse
    : null;

function DeskHotspot({ reduceMotion }: { reduceMotion: boolean }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion || Platform.OS === 'web') return;
    // 네이티브 드라이버(GROMO-2374)는 보간의 easing 을 버리므로 0.9초 easeInOut 왕복으로 같은 곡선을 만든다
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 900, easing: easeInOut, useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 900, easing: easeInOut, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, t]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const moving = !reduceMotion && Platform.OS !== 'web';
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: exact('#ffffff73'),
          boxShadow: '0 0 0 2px #ffffff70,0 0 0 6px #f4a7bb55',
          // 네이티브 드라이버 transform 은 % 이동을 못 받는다 — 네이티브는 크기(36)의 절반만큼 margin 으로 가운데를 맞춘다
          ...(moving
            ? { marginLeft: -18, marginTop: -18, transform: [{ scale }] }
            : { transform: [{ translateX: '-50%' }, { translateY: '-50%' }] }),
        },
        !reduceMotion && deskPulse,
      ]}
    >
      <View
        style={{
          position: 'absolute',
          left: 10,
          right: 10,
          top: 10,
          bottom: 10,
          borderRadius: 8,
          backgroundColor: '#f4a7bb',
        }}
      />
    </Animated.View>
  );
}

export function HallDesk({ concept, width, reduceMotion, showToast }: ArtifactProps) {
  const [pressed, setPressed] = useState(0);
  const [open, setOpen] = useState(false);
  const [reacting, setReacting] = useState(0);
  const plan = useBlueprint(showToast);
  const panel = deskPanels[pressed];
  const react = useKeyframe(reacting, 420, reduceMotion);
  // .hall-detail: transition transform .35s, opacity .2s · 열릴 때는 paper-open .45s가 transform을 덮는다
  const detailOpacity = useEased(open ? 1 : 0, 200, reduceMotion);
  const detailSlide = useEased(open ? 0 : 1, open ? 0 : 350, reduceMotion);
  const hop = useKeyframe(open ? reacting : 0, 450, reduceMotion);
  const hopAt = (outputRange: any[]) =>
    hop.interpolate({ inputRange: [0, 0.5, 1], outputRange, easing: ease });

  const choose = (i: number) => {
    setPressed(i);
    setOpen(true);
    plan.close();
    setReacting((n) => n + 1);
    showToast(`${concept.items[i][0]} 선택`);
  };

  return (
    <Animated.View style={[fill, !reduceMotion && reactStyle(react)]}>
      <View style={fill}>
        {deskSpots.map((spot, i) => (
          <Pressable
            key={i}
            testID={`hall-choice-${i}`}
            onPress={() => choose(i)}
            style={[
              { position: 'absolute', ...spot.box },
              i === 2
                ? {
                    transform:
                      pressed === 2
                        ? [{ translateY: -3 }, { rotate: '2deg' }]
                        : [{ rotate: '4deg' }],
                  }
                : pressed === i && { transform: [{ translateY: -3 }] },
            ]}
          >
            <View
              style={[
                {
                  position: 'absolute',
                  ...spot.label,
                  paddingVertical: 5,
                  paddingHorizontal: 9,
                  borderWidth: 1,
                  borderColor: '#71513d',
                  borderRadius: 99,
                  backgroundColor: pressed === i ? '#fff0ad' : exact('#fff7e9e8'),
                  boxShadow: '0 2px 5px #4c2c1d38',
                  transform: [{ translateX: '-50%' }],
                },
              ]}
            >
              <Text style={[hallFont(12, 15, '800'), { textAlign: 'center' }, nowrap()]}>
                {concept.items[i][0]}
              </Text>
            </View>
            <DeskHotspot reduceMotion={reduceMotion} />
          </Pressable>
        ))}
      </View>

      {panel !== 'island' && (
        <Animated.View
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 22,
            paddingTop: panel === 'buildings' ? 11 : 10,
            paddingBottom: panel === 'buildings' ? 12 : 10,
            paddingHorizontal: 12,
            borderWidth: 1.5,
            borderColor: '#75533d',
            borderRadius: 10,
            backgroundColor: exact('#fff2d5f5'),
            boxShadow: '0 5px 12px #4b2c1e55',
            opacity: detailOpacity,
            pointerEvents: open ? 'auto' : 'none',
            transform: [
              {
                translateY: detailSlide.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '125%'],
                }),
              },
              ...(reduceMotion
                ? []
                : [
                    { translateY: hopAt([0, -8, 0]) },
                    { rotate: hopAt(['0deg', '-1deg', '0deg']) },
                  ]),
            ],
          }}
        >
          {panel === 'buildings' ? (
            <View>
              <View style={{ rowGap: 1, marginBottom: 9 }}>
                <Text style={hallFont(20, 25, '400', INK, GOWUN)}>다음에 지을 건물</Text>
                <Text style={hallFont(12, 16.8, '400', MUTED)}>건물을 누르면 청사진을 펼쳐요</Text>
              </View>
              <BuildingGrid scaled={plan.open} onChoose={plan.choose} />
            </View>
          ) : (
            <View>
              <Text style={hallFont(15, 24)}>
                <View
                  style={{
                    marginBottom: 4,
                    paddingVertical: 2,
                    paddingHorizontal: 8,
                    borderWidth: 1,
                    borderColor: '#7f624f',
                    borderRadius: 99,
                    backgroundColor: '#fff8e9',
                  }}
                >
                  <Text style={[hallFont(7, 11.2, '800'), { letterSpacing: 0.7 }]}>
                    마을회관 책상
                  </Text>
                </View>
              </Text>
              {/* margin-bottom 5는 닫기 버튼의 margin-top 9와 겹쳐(collapse) 사라진다 */}
              <View style={{ rowGap: 1 }}>
                <Text style={hallFont(13, 16.25, '400', INK, GOWUN)}>
                  {concept.items[pressed][1]}
                </Text>
                <Text style={hallFont(8, 11.2, '400', '#79685d')}>{concept.items[pressed][2]}</Text>
              </View>
            </View>
          )}
          <HallPill
            testID="hall-close"
            onPress={() => {
              setOpen(false);
              showToast('문서를 책상 위에 다시 놓았어요');
            }}
            style={
              panel === 'buildings'
                ? { marginTop: 7, backgroundColor: '#f6e1bd' }
                : { marginTop: 9 }
            }
          >
            닫기
          </HallPill>
        </Animated.View>
      )}

      <Blueprint
        item={plan.item}
        shown={plan.open}
        isStatic={false}
        goal={plan.goal}
        reduceMotion={reduceMotion}
        onBack={plan.back}
        onGoal={plan.setGoal}
      />
      <IslandManagement
        width={width}
        isStatic={false}
        initialTab="info"
        shown={open && panel === 'island'}
        reduceMotion={reduceMotion}
        showToast={showToast}
        onClose={() => setOpen(false)}
      />
    </Animated.View>
  );
}
