import { GOWUN } from '@/screens/island/sceneKit';
import React, { useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { buildOptions } from '../assets';
import { Art } from '../shared/Art';
import { useEased } from '../shared/motion';
import { INK, exact, fill, webOnly } from '../shared/styles';
import { Text } from '../shared/typography';
import { ArtifactProps } from '../types';
import {
  BG,
  HALL_OUTLINE,
  MUTED,
  Option,
  PLAN_INK,
  PRIMARY,
  SURFACE,
  hallFont,
} from './hallStyles';

// .screen-hall :is(.stamp-action, .management-invite, .request-row>button, .management-confirm button)
// :active는 3px 아래로 눌리며 그림자가 1px로 준다
export function HallPill({
  testID,
  onPress,
  style,
  shadow = 4,
  children,
}: {
  testID?: string;
  onPress?: () => void;
  style?: any;
  shadow?: number;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 44,
          paddingVertical: 9,
          paddingHorizontal: 15,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          columnGap: 8,
          borderWidth: 2,
          borderColor: HALL_OUTLINE,
          borderRadius: 999,
          backgroundColor: PRIMARY,
          boxShadow: `0 ${pressed ? 1 : shadow}px 0 ${HALL_OUTLINE}`,
        },
        style,
        pressed && { transform: [{ translateY: 3 }] },
      ]}
    >
      {typeof children === 'string' ? (
        <Text style={hallFont(13, 16.25, '850')}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

// ───────── 목각 건물 목록 · 청사진 ─────────

export function BuildingGrid({
  scaled,
  onChoose,
}: {
  scaled: boolean;
  onChoose: (item: Option) => void;
}) {
  const rows = [buildOptions.slice(0, 2), buildOptions.slice(2, 4), buildOptions.slice(4)];
  return (
    <View style={[{ rowGap: 10 }, scaled && { transform: [{ scale: 0.985 }] }]}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', columnGap: 10 }}>
          {row.map((item, i) => (
            <Pressable
              key={item.id}
              testID={`building-choice-${r * 2 + i}`}
              onPress={() => onChoose(item)}
              style={({ pressed }) => [
                {
                  flex: 1,
                  minHeight: 88,
                  paddingVertical: 7,
                  paddingHorizontal: 5,
                  flexDirection: 'row',
                  alignItems: 'center',
                  columnGap: 5,
                  borderWidth: 2,
                  borderColor: HALL_OUTLINE,
                  borderRadius: 13,
                  backgroundColor: SURFACE,
                  boxShadow: `0 ${pressed ? 1 : 3}px 0 ${HALL_OUTLINE}`,
                },
                pressed && { transform: [{ translateY: 3 }] },
              ]}
            >
              <Art
                source={item.image}
                style={[
                  { width: 44, height: 54 },
                  webOnly({ filter: 'drop-shadow(0 3px 2px #68483240)' }),
                ]}
              />
              <View style={{ flex: 1, rowGap: 2 }}>
                <Text style={hallFont(14, 18.2, '850')}>
                  {item.name}
                  {item.locked ? ' ' : ''}
                  {item.locked && (
                    <View
                      style={[
                        {
                          paddingVertical: 1,
                          paddingHorizontal: 3,
                          borderRadius: 99,
                          backgroundColor: '#decfbd',
                        },
                        webOnly({ verticalAlign: '1px' }),
                      ]}
                    >
                      <Text style={hallFont(10, 13, '850', '#806e61')}>잠김</Text>
                    </View>
                  )}
                </Text>
                <Text style={hallFont(12, 16.8, '400', MUTED)}>{item.summary}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

export function Blueprint({
  item,
  shown,
  isStatic,
  goal,
  reduceMotion,
  onBack,
  onGoal,
}: {
  item: Option;
  shown: boolean;
  isStatic: boolean;
  goal: string;
  reduceMotion: boolean;
  onBack: () => void;
  onGoal: () => void;
}) {
  // transition: transform .38s ease, opacity .2s
  const move = useEased(shown ? 1 : 0, 380, reduceMotion);
  const opacity = useEased(shown ? 1 : 0, 200, reduceMotion);
  const dashed = {
    borderTopWidth: 1,
    borderStyle: 'dashed' as const,
    borderColor: exact('#dff7ffaa'),
  };
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          zIndex: 12,
          left: 8,
          right: 8,
          top: '50%',
          height: 276,
          padding: 12,
          borderWidth: 2,
          borderColor: '#d9f3f7',
          borderRadius: 12,
          backgroundColor: exact('#4f94b1f7'),
          boxShadow: 'inset 0 0 0 4px #4a899f,0 12px 26px #273c46a8',
          opacity,
          pointerEvents: shown ? 'auto' : 'none',
          transform: [
            { translateY: move.interpolate({ inputRange: [0, 1], outputRange: ['-35%', '-50%'] }) },
            { scale: move.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
          ],
        },
        webOnly({
          backgroundImage:
            'linear-gradient(#dff7ff24 1px,transparent 1px),linear-gradient(90deg,#dff7ff24 1px,transparent 1px),linear-gradient(#dff7ff12 1px,transparent 1px),linear-gradient(90deg,#dff7ff12 1px,transparent 1px)',
          backgroundSize: '32px 32px,32px 32px,8px 8px,8px 8px',
        }),
      ]}
    >
      {!isStatic && (
        <Pressable
          testID="blueprint-back"
          accessibilityLabel="건물 목록으로 돌아가기"
          onPress={onBack}
          style={{
            position: 'absolute',
            zIndex: 3,
            left: 10,
            top: 10,
            width: 26,
            height: 26,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: HALL_OUTLINE,
            borderRadius: 999,
            backgroundColor: BG,
            boxShadow: `0 3px 0 ${HALL_OUTLINE}`,
          }}
        >
          <Text style={hallFont(19, 19, '850', INK, GOWUN)}>‹</Text>
        </Pressable>
      )}
      <Text
        style={[
          hallFont(12, 19.2, '400', '#e8faff'),
          { letterSpacing: 0.48, marginBottom: 10, paddingLeft: isStatic ? 0 : 32 },
        ]}
      >
        BUILDING PLAN · 01
      </Text>
      <View style={{ flex: 1, flexDirection: 'row', columnGap: 10 }}>
        <View
          style={{
            width: '36%',
            paddingTop: 5,
            paddingHorizontal: 5,
            paddingBottom: 4,
            borderWidth: 1,
            borderColor: exact('#dff7ffaa'),
            backgroundColor: exact('#eaf8fb19'),
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              position: 'absolute',
              left: '50%',
              top: 6,
              bottom: 6,
              width: 1,
              backgroundColor: exact('#dff7ff55'),
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: '50%',
              left: 6,
              right: 6,
              height: 1,
              backgroundColor: exact('#dff7ff55'),
            }}
          />
          <Text
            style={[
              hallFont(11, 17.6, '400', exact('#dff7ffaa')),
              { position: 'absolute', zIndex: 1, right: 5, top: 3 },
            ]}
          >
            ＋
          </Text>
          <View style={{ flex: 1, zIndex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Art
              source={item.image}
              style={[
                { width: 94, maxWidth: '100%', height: 104 },
                webOnly({ filter: 'drop-shadow(0 4px 2px #244c5c80)' }),
              ]}
            />
          </View>
          <View
            style={{
              alignSelf: 'center',
              zIndex: 1,
              paddingVertical: 1,
              paddingHorizontal: 5,
              borderWidth: 1,
              borderColor: exact('#dff7ffaa'),
              borderRadius: 99,
              backgroundColor: '#4f94b1',
            }}
          >
            <Text style={hallFont(11, 17.6, '400', '#fff')}>예상 모습</Text>
          </View>
        </View>
        <View style={{ flex: 1, alignSelf: 'center' }}>
          <Text style={[hallFont(22, 24.2, '400', PLAN_INK, GOWUN), { marginBottom: 7 }]}>
            {item.name}
          </Text>
          {[
            ['가격', item.price],
            ['시간', item.time],
          ].map(([key, value]) => (
            <View
              key={key}
              style={[
                {
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  columnGap: 5,
                  paddingVertical: 3,
                },
                dashed,
              ]}
            >
              <Text style={hallFont(12, 16.2, '400', PLAN_INK)}>{key}</Text>
              <Text style={hallFont(12, 16.2, '700', PLAN_INK)}>{value}</Text>
            </View>
          ))}
          <Text
            style={[hallFont(12, 17.4, '400', PLAN_INK), { marginTop: 6, paddingTop: 6 }, dashed]}
          >
            {item.detail}
          </Text>
        </View>
      </View>
      <HallPill testID="blueprint-goal" onPress={onGoal} style={{ marginTop: 8 }}>
        {goal || '이 건물을 목표로 정하기'}
      </HallPill>
    </Animated.View>
  );
}

// 청사진 버튼 동작을 hall-desk · building-flow가 함께 쓴다
export function useBlueprint(showToast: (message: string) => void) {
  const [item, setItem] = useState<Option>(buildOptions[0]);
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState('');
  return {
    item,
    open,
    goal,
    choose: (next: Option) => {
      setItem(next);
      setOpen(true);
      showToast(`${next.name} 청사진을 펼쳤어요`);
    },
    back: () => {
      setOpen(false);
      showToast('건물 목록으로 돌아왔어요');
    },
    setGoal: () => {
      setGoal(`${item.name} 선택 완료 ✓`);
      showToast(`${item.name}을 다음 건설 목표로 정했어요`);
    },
    close: () => setOpen(false),
  };
}

export function BuildingFlow({ concept, reduceMotion, showToast }: ArtifactProps) {
  const standalone = concept.kind === 'building-blueprint';
  const plan = useBlueprint(showToast);
  const shown = standalone || plan.open;
  return (
    <View style={fill}>
      <View
        style={{
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: 22,
          minHeight: 352,
          paddingTop: 16,
          paddingHorizontal: 13,
          paddingBottom: 17,
          borderWidth: 2,
          borderColor: '#8b6248',
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          borderBottomLeftRadius: 10,
          borderBottomRightRadius: 10,
          backgroundColor: '#fff3d8',
          boxShadow: 'inset 0 0 0 4px #eed4aa,0 8px 18px #4b2d1e66',
          overflow: 'hidden',
        }}
      >
        <View style={{ rowGap: 1, marginBottom: 9 }}>
          <View
            style={{
              alignSelf: 'flex-start',
              marginBottom: 3,
              paddingVertical: 2,
              paddingHorizontal: 8,
              borderWidth: 1,
              borderColor: '#7f624f',
              borderRadius: 99,
              backgroundColor: '#fff8e9',
            }}
          >
            <Text style={hallFont(12, 16.8, '800', MUTED)}>목각 건물 고르기</Text>
          </View>
          <Text style={hallFont(20, 25, '400', INK, GOWUN)}>어떤 건물을 지을까요?</Text>
          <Text style={hallFont(12, 16.8, '400', MUTED)}>
            {standalone ? '도서관을 눌러 청사진을 펼친 상태예요' : '건물을 누르면 청사진을 펼쳐요'}
          </Text>
        </View>
        <BuildingGrid scaled={shown} onChoose={plan.choose} />
      </View>
      <Blueprint
        item={plan.item}
        shown={shown}
        isStatic={standalone}
        goal={plan.goal}
        reduceMotion={reduceMotion}
        onBack={plan.back}
        onGoal={plan.setGoal}
      />
    </View>
  );
}
