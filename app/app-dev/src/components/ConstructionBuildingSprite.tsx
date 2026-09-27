import React, { memo, useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import {
  constructionBuildingMotion,
  constructionBurstMs,
  constructionEffectFrameCount,
  constructionEffectFrameMs,
  constructionEffectRows,
  constructionEffectsAtlas,
  constructionMotionFrameMs,
  constructionMotionOffsets,
  constructionRestMs,
  type ConstructionBuildingId,
  type ConstructionPhase,
} from './constructionBuildingMotion';

export type { ConstructionBuildingId, ConstructionPhase } from './constructionBuildingMotion';

/** 공사 건물 전용 atlas viewport와 작업 진동. 완공 건물 렌더러와 별도로 마운트한다. */
export const ConstructionBuildingSprite = memo(function ConstructionBuildingSpriteView({
  building,
  phase,
  reduceMotion = false,
  testID,
}: {
  building: ConstructionBuildingId;
  phase: ConstructionPhase;
  reduceMotion?: boolean;
  testID?: string;
}) {
  const cell = constructionBuildingMotion[building][phase];
  const effectRow = constructionEffectRows[phase];
  const [motionFrame, setMotionFrame] = useState(0);
  const [effectFrame, setEffectFrame] = useState(0);
  const [burstActive, setBurstActive] = useState(!reduceMotion);

  useEffect(() => {
    setMotionFrame(0);
    setEffectFrame(0);
    setBurstActive(!reduceMotion);
    if (reduceMotion) return;

    let cancelled = false;
    let generation = 0;
    let cycle = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const schedule = (callback: () => void, delay: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!cancelled) callback();
      }, delay);
      timers.add(timer);
    };

    const startBurst = () => {
      const token = ++generation;
      let nextMotionFrame = 1;
      let nextEffectFrame = 1;
      setBurstActive(true);
      setMotionFrame(0);
      setEffectFrame(0);

      const tickMotion = () => {
        if (token !== generation) return;
        setMotionFrame(nextMotionFrame);
        nextMotionFrame = (nextMotionFrame + 1) % constructionMotionOffsets.length;
        schedule(tickMotion, constructionMotionFrameMs);
      };
      const tickEffect = () => {
        if (token !== generation) return;
        setEffectFrame(nextEffectFrame);
        nextEffectFrame = (nextEffectFrame + 1) % constructionEffectFrameCount;
        schedule(tickEffect, constructionEffectFrameMs);
      };

      schedule(tickMotion, constructionMotionFrameMs);
      schedule(tickEffect, constructionEffectFrameMs);
      schedule(() => {
        if (token !== generation) return;
        generation += 1;
        setBurstActive(false);
        setMotionFrame(0);
        setEffectFrame(0);
        const rest = constructionRestMs(building, phase, cycle);
        cycle += 1;
        schedule(startBurst, rest);
      }, constructionBurstMs[phase]);
    };

    startBurst();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, [building, phase, reduceMotion]);

  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={[
        styles.viewport,
        { transform: [{ translateX: constructionMotionOffsets[motionFrame] }] },
      ]}
    >
      <Image
        testID={`construction-sprite-${building}-${phase}`}
        source={cell.atlas}
        resizeMode="stretch"
        style={[
          styles.atlas,
          {
            left: `${cell.column * -100}%`,
            top: `${cell.row * -100}%`,
            height: `${cell.rows * 100}%`,
          },
        ]}
      />
      <Image
        testID={`construction-effect-${building}-${phase}`}
        source={constructionEffectsAtlas}
        resizeMode="stretch"
        style={[
          styles.effectsAtlas,
          burstActive ? styles.effectVisible : styles.effectHidden,
          {
            left: `${effectFrame * -100}%`,
            top: `${effectRow * -100}%`,
          },
        ]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  viewport: { width: '100%', height: '100%', overflow: 'hidden' },
  atlas: { position: 'absolute', width: '400%' },
  effectsAtlas: { position: 'absolute', width: '400%', height: '300%' },
  effectVisible: { opacity: 1 },
  effectHidden: { opacity: 0 },
});
