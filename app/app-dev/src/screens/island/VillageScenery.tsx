import React, { memo, useEffect, useRef } from 'react';
import { Animated, AppState, Easing, Image, View, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { villageAssets } from '@/constants/village-assets';
import { assets } from '@/constants/assets';
import { villageMap, VillageScene } from '@/utils/village-world';
import { VillageBoardIndicator } from '@/components/village-motion/VillageBoardIndicator';
import { VillageHallMotion } from '@/components/village-motion/VillageHallMotion';
import { Txt } from '@/design-system/patterns';

// UI 색상이 아니라 원화의 불꽃 색상이다. 바닥 타일은 한 장으로 합쳐 그린다.
export const VillageScenery = memo(function VillageScenery({
  scene,
  scale,
  reduce,
  mailboxLetters,
  boardStatus = null,
  hallMotionActive = false,
  hallMotionGeneration = 0,
}: {
  scene: VillageScene;
  scale: number;
  reduce: boolean;
  mailboxLetters: boolean;
  boardStatus?: 'unread' | 'new-comment' | null;
  hallMotionActive?: boolean;
  hallMotionGeneration?: number;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1450,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1450,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    const update = () => {
      loop.stop();
      if (!reduce && AppState.currentState === 'active') loop.start();
      else pulse.setValue(0);
    };
    update();
    const sub = AppState.addEventListener('change', update);
    return () => {
      loop.stop();
      sub.remove();
    };
  }, [pulse, reduce]);
  const d = villageMap.crossings.dock,
    b = villageMap.crossings.bridge;
  return (
    <>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {scene.roads.map((r) => (
          <Image
            key={r.file}
            testID={`village-road-${r.building ?? 'base'}`}
            source={villageAssets[r.file]}
            style={{
              position: 'absolute',
              left: r.x * scale,
              top: r.y * scale,
              width: r.w * scale,
              height: r.h * scale,
            }}
          />
        ))}
        <Image
          source={villageAssets['dock.png']}
          style={{
            position: 'absolute',
            left: d.x * scale,
            top: d.y * scale,
            width: d.w * scale,
            height: d.h * scale,
          }}
        />
        <Image
          source={villageAssets['bridge.png']}
          style={{
            position: 'absolute',
            left: b.x * scale,
            top: b.y * scale,
            width: b.w * scale,
            height: b.h * scale,
          }}
        />
      </View>
      {scene.objects.map((o) => (
        <View
          key={o.id}
          testID={o.building ? `village-building-${o.building}` : undefined}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: (o.x - o.w / 2) * scale,
            top: (o.y - o.h) * scale,
            width: o.w * scale,
            height: o.h * scale,
            zIndex: Math.round(o.y),
          }}
        >
          {o.building === 'hall' ? (
            <VillageHallMotion
              testID="village-hall-scene-motion"
              state={hallMotionActive ? 'arrival' : 'normal'}
              generation={hallMotionGeneration}
              highlighted={hallMotionActive}
              reduceMotion={reduce}
              tooltip={
                hallMotionActive ? <Txt kind="meta">마을 회관에 들어가는 중</Txt> : undefined
              }
              style={StyleSheet.absoluteFill}
            />
          ) : o.kind === 'mailbox' && mailboxLetters ? (
            <Image
              source={assets['characters/pelican/npc/on-mailbox.png']}
              style={{
                position: 'absolute',
                left: -47 * scale,
                top: -61 * scale,
                width: 137 * scale,
                height: 137 * scale,
              }}
            />
          ) : (
            <Animated.Image
              source={villageAssets[o.kind + '.png']}
              style={{
                width: '100%',
                height: '100%',
                transform:
                  o.layer === 'trees' && !reduce
                    ? [
                        {
                          rotate: pulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['-0.4deg', '0.4deg'],
                          }),
                        },
                      ]
                    : [],
              }}
            />
          )}
          {o.kind === 'fire' && (
            <Animated.View
              style={{
                position: 'absolute',
                left: o.w * 0.28 * scale,
                top: -0.12 * o.h * scale,
                width: o.w * 0.44 * scale,
                height: o.h * 0.78 * scale,
                transform: [
                  { scaleY: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.13] }) },
                ],
              }}
            >
              <Svg width="100%" height="100%" viewBox="0 0 50 64">
                <Path
                  d="M24 63C-8 59 8 33 20 3C19 22 44 29 46 44C50 56 38 64 24 63Z"
                  fill="#F58036"
                />
                <Path
                  d="M25 60C8 57 15 39 26 22C24 38 41 44 36 54C33 60 29 61 25 60Z"
                  fill="#FFD777"
                />
              </Svg>
            </Animated.View>
          )}
          {o.building === 'board' && (
            <VillageBoardIndicator
              testID="village-board-scene-indicator"
              showBoardImage={false}
              hasUnread={boardStatus === 'unread'}
              hasNewComment={boardStatus === 'new-comment'}
              indicatorScale={scale}
              tooltip={
                boardStatus === 'new-comment' ? (
                  <Txt kind="meta">새 댓글이 있어요</Txt>
                ) : boardStatus === 'unread' ? (
                  <Txt kind="meta">읽지 않은 새 소식이 있어요</Txt>
                ) : undefined
              }
              style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
            />
          )}
        </View>
      ))}
    </>
  );
});
