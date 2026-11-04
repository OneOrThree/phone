import { GOWUN } from '@/screens/island/sceneKit';
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { kindCopy } from '../assets';
import { easeInOut, useReact } from '../shared/motion';
import { INK, OUTLINE, exact, gradient, lh, webOnly } from '../shared/styles';
import { Text, obsFont } from '../shared/typography';
import { ArtifactProps } from '../types';

// .artifact-tag. inline이면 부모 줄 상자(15px/1.6) 안의 inline-block이라 위에 7px이 생긴다
function ObsTag({
  label,
  inline,
  color = INK,
  background = '#fff8e9',
}: {
  label: string;
  inline?: boolean;
  color?: string;
  background?: string;
}) {
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        marginTop: inline ? 7 : 0,
        marginBottom: inline ? 7 : 4,
        paddingVertical: 2,
        paddingHorizontal: 8,
        borderWidth: 1,
        borderColor: '#7f624f',
        borderRadius: 99,
        backgroundColor: background,
      }}
    >
      <Text style={[obsFont(7, 1.6, color, '800'), { letterSpacing: 0.7 }]}>{label}</Text>
    </View>
  );
}

// .selection-copy: 제목 font 16px/1.25 Gowun, 설명 line-height 1.4, 사이 1px
function Selection({
  title,
  note,
  size,
  noteSize,
  color = INK,
  noteColor = '#79685d',
  style,
}: {
  title: string;
  note: string;
  size: number;
  noteSize: number;
  color?: string;
  noteColor?: string;
  style?: any;
}) {
  return (
    <View style={[{ rowGap: 1 }, style]}>
      <Text style={{ fontFamily: GOWUN, fontSize: size, lineHeight: lh(size * 1.25), color }}>
        {title}
      </Text>
      <Text style={obsFont(noteSize, 1.4, noteColor)}>{note}</Text>
    </View>
  );
}

// .stamp-action: 버튼 글자는 세로 가운데
function Stamp({
  label,
  background,
  onPress,
}: {
  label: string;
  background: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID="stamp-action"
      onPress={onPress}
      style={{
        minHeight: 34,
        marginTop: 9,
        paddingVertical: 6,
        paddingHorizontal: 10,
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: OUTLINE,
        borderRadius: 9,
        backgroundColor: background,
        boxShadow: `0 2px 0 ${OUTLINE}`,
      }}
    >
      <Text style={[obsFont(9, 1.6, INK, '800'), { textAlign: 'center' }]}>{label}</Text>
    </Pressable>
  );
}

// .object-choice 안의 이름(span)과 짧은 막대(i)
function ChoiceLabel({ label }: { label: string }) {
  return (
    <>
      <Text style={[obsFont(8, 1.25, INK, '800'), { textAlign: 'center' }]}>{label}</Text>
      <View
        style={{
          alignSelf: 'center',
          width: 11,
          height: 3,
          marginTop: 4,
          borderRadius: 99,
          backgroundColor: exact('#7f624f55'),
        }}
      />
    </>
  );
}

// .laptop-base: 화면보다 좌우 8%씩 넓은 받침
function LaptopBase() {
  return (
    <View
      style={[
        {
          height: 19,
          marginHorizontal: '-8%',
          borderWidth: 2,
          borderColor: '#5e493d',
          borderTopLeftRadius: 2,
          borderTopRightRadius: 2,
          borderBottomLeftRadius: 10,
          borderBottomRightRadius: 10,
          boxShadow: 'inset 0 2px #c9b39c',
        },
        gradient('linear-gradient(#a78d75,#6e5849)'),
      ]}
    >
      <View
        style={{
          position: 'absolute',
          left: '38%',
          right: '38%',
          top: 4,
          height: 5,
          borderWidth: 1,
          borderColor: '#59483e',
          borderRadius: 2,
          backgroundColor: '#85705f',
        }}
      />
    </View>
  );
}

const laptopScreen = {
  borderColor: '#6b5547',
  borderTopLeftRadius: 8,
  borderTopRightRadius: 8,
  borderBottomLeftRadius: 4,
  borderBottomRightRadius: 4,
  backgroundColor: '#17243a',
  boxShadow: 'inset 0 0 0 2px #9b836d',
};

// 원본 ::after 점: @keyframes object-hotspot 1.8s ease-in-out infinite.
// 동작 줄이기 규칙(* { animation: none })은 가상 요소를 고르지 않아 원본은 동작 줄이기에서도 계속 뛴다 → 웹은 같은 CSS 애니메이션을 그대로 건다.
// 달리는 애니메이션이 있어야 크롬이 그 뒤에 그리는 요소(설명 상자·상단 UI)를 원본과 같은 방식으로 합성한다.
// animationKeyframes 는 StyleSheet.create 로만 쓸 수 있다
const hotspotFrame = (scale: number, ring: number, color: string) => ({
  transform: `translate(-50%,-50%) scale(${scale})`,
  boxShadow: `0 0 0 5px #fff9,0 0 0 ${ring}px ${color}`,
});

const hotspotWeb =
  Platform.OS === 'web'
    ? StyleSheet.create({
        dot: {
          animationKeyframes: [
            {
              '0%': hotspotFrame(1, 9, '#f3adbd33'),
              '50%': hotspotFrame(1.06, 15, '#f3adbd18'),
              '100%': hotspotFrame(1, 9, '#f3adbd33'),
            },
          ],
          animationDuration: '1.8s',
          animationTimingFunction: 'ease-in-out',
          animationIterationCount: 'infinite',
        } as any,
      }).dot
    : null;

function DeskDot({ reduceMotion }: { reduceMotion: boolean }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (Platform.OS === 'web' || reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: 900,
          easing: easeInOut,
          useNativeDriver: true,
        }),
        Animated.timing(t, {
          toValue: 0,
          duration: 900,
          easing: easeInOut,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, t]);
  const base = {
    position: 'absolute' as const,
    left: '50%' as const,
    top: '50%' as const,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#f3d16d',
    boxShadow: '0 0 0 5px #fff9,0 0 0 9px #f3adbd33',
  };
  if (Platform.OS === 'web')
    return (
      <View
        style={[base, { transform: [{ translateX: '-50%' }, { translateY: '-50%' }] }, hotspotWeb]}
      />
    );
  // 네이티브는 바깥 링 대신 크기만 뛴다
  return (
    <Animated.View
      style={[
        base,
        // 네이티브 드라이버 transform 은 % 이동을 못 받는다 — 크기(9)의 절반만큼 margin 으로 가운데를 맞춘다(GROMO-2374)
        {
          marginLeft: -4.5,
          marginTop: -4.5,
          transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
        },
      ]}
    />
  );
}

export function ObservatoryDesk({ concept, reduceMotion, showToast }: ArtifactProps) {
  const [selected, setSelected] = useState(0);
  const [reactTransform, react] = useReact(reduceMotion);
  const item = concept.items[selected];
  const rows = [
    ['1', '라임 섬', '42h 20m'],
    ['2', '소다 섬', '38h 45m'],
    ['3', '구름 섬', '34h 10m'],
  ];
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        transform: reactTransform,
      }}
    >
      <View
        style={[
          { position: 'absolute', left: '24%', top: '46%', width: '52%' },
          webOnly({ filter: 'drop-shadow(0 7px 6px #1a172088)' }),
        ]}
      >
        <View
          style={[
            laptopScreen,
            {
              paddingTop: 9,
              paddingHorizontal: 9,
              paddingBottom: 8,
              borderWidth: 6,
              borderBottomWidth: 8,
            },
          ]}
        >
          <Text style={[obsFont(6, 1.6, '#d8b86c'), { marginBottom: 6, letterSpacing: 0.48 }]}>
            이번 주 다른 섬 랭킹
          </Text>
          {rows.map(([rank, name, time], i) => (
            <View
              key={rank}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                columnGap: 4,
                paddingVertical: 4,
                paddingHorizontal: 3,
                borderTopWidth: 1,
                borderTopColor: exact('#6f7b8755'),
                backgroundColor: i === 1 ? exact('#b98d4950') : undefined,
              }}
            >
              <View
                style={{
                  width: 12,
                  height: 12,
                  marginRight: 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  backgroundColor: '#c59d55',
                }}
              >
                <Text style={obsFont(6, 1.6, '#182439')}>{rank}</Text>
              </View>
              <Text style={[obsFont(6, 1.6, '#e8e0c8', '700'), { flex: 1 }]}>{name}</Text>
              <Text style={[obsFont(5, 1.6, '#e8e0c8'), { fontVariant: ['tabular-nums'] }]}>
                {time}
              </Text>
            </View>
          ))}
        </View>
        <LaptopBase />
      </View>
      {concept.items.map((choice, i) => {
        const on = selected === i;
        return (
          <Pressable
            key={choice[0]}
            testID={`choice-${i}`}
            onPress={() => {
              setSelected(i);
              react();
              showToast(`${choice[0]} 선택`);
            }}
            style={[
              { position: 'absolute' },
              i === 0
                ? {
                    left: '24%',
                    top: '45%',
                    width: '52%',
                    height: '25%',
                    transform: on ? [{ translateY: -3 }] : undefined,
                  }
                : {
                    right: '4%',
                    top: '57%',
                    width: '32%',
                    height: '18%',
                    transform: [{ rotate: '5deg' }],
                  },
            ]}
          >
            <View
              style={{
                position: 'absolute',
                left: '50%',
                bottom: -4,
                paddingVertical: 3,
                paddingHorizontal: 7,
                transform: [{ translateX: '-50%' }],
                borderWidth: 1,
                borderColor: '#b79256',
                borderRadius: 99,
                backgroundColor: on ? '#d2a95e' : exact('#16243ad9'),
              }}
            >
              <Text
                style={[
                  obsFont(6, 1.25, on ? '#17243a' : '#fff2cb', '800'),
                  webOnly({ whiteSpace: 'nowrap' }),
                ]}
              >
                {choice[0]}
              </Text>
            </View>
            <DeskDot reduceMotion={reduceMotion} />
          </Pressable>
        );
      })}
      <View
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 22,
          paddingVertical: 9,
          paddingHorizontal: 11,
          borderWidth: 1,
          borderColor: '#b79256',
          borderRadius: 7,
          backgroundColor: exact('#17243ae8'),
          boxShadow: '0 6px 14px #111a2b88',
        }}
      >
        <ObsTag label={kindCopy[concept.kind]} inline color="#fff5dd" />
        <Selection
          title={item[1]}
          note={item[2]}
          size={12}
          noteSize={7}
          color="#fff5dd"
          noteColor="#cbd4df"
        />
      </View>
    </Animated.View>
  );
}

export function IslandRanking({ concept, reduceMotion, showToast }: ArtifactProps) {
  const [selected, setSelected] = useState(0);
  const [reactTransform, react] = useReact(reduceMotion);
  const item = concept.items[selected];
  return (
    <Animated.View style={{ transform: reactTransform }}>
      <View
        style={[
          laptopScreen,
          {
            paddingTop: 13,
            paddingHorizontal: 12,
            paddingBottom: 11,
            borderWidth: 9,
            borderBottomWidth: 11,
          },
        ]}
      >
        <View style={{ marginBottom: 8 }}>
          <Text style={[obsFont(6, 1.6, '#d8b86c'), { letterSpacing: 0.72 }]}>WEEK 37</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <Text
              style={{
                flex: 1,
                fontFamily: GOWUN,
                fontSize: 15,
                lineHeight: lh(15 * 1.25),
                color: '#e8e0c8',
              }}
            >
              다른 섬 랭킹
            </Text>
            <Text style={obsFont(6, 1.6, '#e8e0c8')}>주간 집중 평균</Text>
          </View>
        </View>
        <View style={{ rowGap: 5 }}>
          {concept.items.map((choice, i) => (
            <Pressable
              key={choice[0]}
              testID={`choice-${i}`}
              onPress={() => {
                setSelected(i);
                react();
                showToast(`${choice[0]} 선택`);
              }}
              style={[
                {
                  minHeight: 39,
                  paddingVertical: 7,
                  paddingHorizontal: 3,
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: '#8291a0',
                  borderRadius: 3,
                  backgroundColor: i === 1 ? '#725d3e' : '#243750',
                },
                selected === i && {
                  transform: [{ translateX: 4 }],
                  outlineWidth: 2,
                  outlineStyle: 'solid',
                  outlineColor: '#e6c86f',
                },
              ]}
            >
              <Text style={[obsFont(8, 1.25, '#edf3f4', '800'), { width: 34 }]}>{choice[0]}</Text>
            </Pressable>
          ))}
        </View>
        <Selection
          title={item[1]}
          note={item[2]}
          size={10}
          noteSize={6}
          color="#e8e0c8"
          noteColor="#cbd4df"
          style={{
            marginTop: 8,
            marginHorizontal: 3,
            paddingTop: 7,
            borderTopWidth: 1,
            borderTopColor: '#718095',
          }}
        />
      </View>
      <LaptopBase />
    </Animated.View>
  );
}

export function OldMap({ concept, reduceMotion, showToast }: ArtifactProps) {
  const [selected, setSelected] = useState(0);
  const [reactTransform, react] = useReact(reduceMotion, '0.6deg');
  const item = concept.items[selected];
  // 가상 요소에는 * { box-sizing: border-box } 가 닿지 않아 width 20px에 테두리 2px씩이 더해진다
  const roller = {
    position: 'absolute' as const,
    top: -3,
    bottom: -3,
    width: 24,
    borderWidth: 2,
    borderColor: '#8b623f',
    borderRadius: '50%' as const,
    backgroundColor: '#c99e68',
  };
  return (
    <Animated.View
      style={{
        paddingVertical: 18,
        paddingHorizontal: 22,
        borderRadius: 8,
        backgroundColor: '#ead3a4',
        boxShadow: '0 8px 16px #10192b88',
        transform: reactTransform,
      }}
    >
      <View style={[roller, { left: -9 }]} />
      <View style={[roller, { right: -9 }]} />
      <ObsTag label={kindCopy[concept.kind]} inline />
      <Selection
        title={item[1]}
        note={item[2]}
        size={16}
        noteSize={8}
        style={{ marginBottom: 9 }}
      />
      <View
        style={[
          {
            height: 104,
            marginHorizontal: 4,
            marginBottom: 10,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: '#866b4e',
            borderRadius: '45%',
            backgroundColor: exact('#76b7c755'),
          },
          webOnly({
            backgroundImage:
              'radial-gradient(circle at 24% 56%,#799f67 0 14px,transparent 15px),radial-gradient(circle at 51% 29%,#799f67 0 11px,transparent 12px),radial-gradient(circle at 77% 61%,#799f67 0 15px,transparent 16px)',
          }),
        ]}
      >
        {/* 네이티브는 radial-gradient 섬 대신 원 */}
        {Platform.OS !== 'web' &&
          [
            [24, 56, 14.5],
            [51, 29, 11.5],
            [77, 61, 15.5],
          ].map(([x, y, r]) => (
            <View
              key={x}
              style={{
                position: 'absolute',
                left: `${x}%`,
                top: `${y}%`,
                width: r * 2,
                height: r * 2,
                marginLeft: -r,
                marginTop: -r,
                borderRadius: r,
                backgroundColor: '#799f67',
              }}
            />
          ))}
        {[
          [24, 43],
          [51, 22],
          [77, 50],
        ].map(([x, y]) => (
          <View
            key={x}
            style={{
              position: 'absolute',
              left: `${x}%`,
              top: `${y}%`,
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: '#c86c5a',
            }}
          />
        ))}
        <View
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            top: 12,
            bottom: 12,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: '#866b4e',
            borderRadius: '45%',
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', columnGap: 6 }}>
        {concept.items.map((choice, i) => (
          <Pressable
            key={choice[0]}
            testID={`choice-${i}`}
            onPress={() => {
              setSelected(i);
              react();
              showToast(`${choice[0]} 선택`);
            }}
            style={{
              flex: 1,
              minHeight: 40,
              paddingVertical: 7,
              paddingHorizontal: 3,
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: OUTLINE,
              borderRadius: 8,
              backgroundColor: '#f5e5bf',
              boxShadow: `0 2px 0 ${OUTLINE}`,
              transform: selected === i ? [{ translateY: -3 }] : undefined,
            }}
          >
            <ChoiceLabel label={choice[0]} />
          </Pressable>
        ))}
      </View>
      <Stamp
        label="선택한 섬 구경하기"
        background="#d5a85e"
        onPress={() => showToast(`${item[0]} 지도를 펼쳤어요`)}
      />
    </Animated.View>
  );
}
