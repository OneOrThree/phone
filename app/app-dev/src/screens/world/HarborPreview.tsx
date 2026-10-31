import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { MotionContext } from '@/design-system/primitives';
import { Btn, Txt } from '@/design-system/patterns';
import { componentTokens as c, primitiveTokens as p } from '@/design-system/tokens';
import { colors, type Color } from '@/services/model';
import { t } from '@/i18n';
import { HarborCutscene } from './HarborCutscene';
import { cutsceneVideoBox } from '@/components/VideoCutscene';
import type { HarborDirection } from './harborMotion';

const ORIGINALS = {
  departure: require('@/assets/ota/cutscenes/departure.mp4'),
  arrival: require('@/assets/ota/cutscenes/arrival.mp4'),
  'pelican-mail': require('@/assets/ota/cutscenes/pelican-mail.mp4'),
  'golden-fish': require('@/assets/ota/cutscenes/golden-fish.mp4'),
};
type PreviewKind = HarborDirection | 'golden-fish';
const SCENES: readonly PreviewKind[] = ['departure', 'arrival', 'pelican-mail', 'golden-fish'];
const SCENE_NAMES: Record<PreviewKind, string> = {
  departure: '출항',
  arrival: '도착',
  'pelican-mail': '펠리컨 배달',
  'golden-fish': '황금 물고기(원본)',
};
const FORMATS = {
  phone: { label: '아이폰 세로', width: 402, height: 874 },
  tablet: { label: '아이패드 세로', width: 1024, height: 1366 },
  landscape: { label: '아이패드 가로', width: 1366, height: 1024 },
};
type Format = keyof typeof FORMATS;
const label = (direction: PreviewKind) =>
  direction === 'pelican-mail'
    ? t('magazine.delivery.seaCutscene')
    : direction === 'golden-fish'
      ? '여러 고양이가 힘을 모아 황금 물고기를 낚아 올렸어요'
      : direction === 'arrival'
        ? t('arrivalCutscene.label', { destination: '별빛섬' })
        : t('departureStory.label', { destination: '먼바다' });

/** 원본 MP4와 실제 RN 분리 장면 비교. canvas 인자는 종전 전체 화면 검토를 유지한다. */
export function HarborPreview() {
  const query = new URLSearchParams(window.location.search);
  const requested = query.get('harbor') as PreviewKind;
  const direction = SCENES.includes(requested) ? requested : 'departure';
  const selected = query.get('color') as Color;
  const color = colors.includes(selected) ? selected : 'gray';
  return query.has('canvas') && direction !== 'golden-fish' ? (
    <MotionContext.Provider value={false}>
      <View style={styles.fill}>
        <HarborCutscene
          color={color}
          direction={direction}
          accessibilityLabel={label(direction)}
          onFinish={() => {}}
        />
      </View>
    </MotionContext.Provider>
  ) : (
    <Comparison key={direction} initialDirection={direction} initialColor={color} />
  );
}

function Comparison({
  initialDirection,
  initialColor,
}: {
  initialDirection: PreviewKind;
  initialColor: Color;
}) {
  const [direction, setDirection] = useState(initialDirection);
  const originalOnly = direction === 'golden-fish';
  const [color, setColor] = useState(initialColor);
  const [format, setFormat] = useState<Format>('phone');
  const [replay, setReplay] = useState(0);
  const [newPaused, setNewPaused] = useState(true);
  const [newReady, setNewReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [newDone, setNewDone] = useState(false);
  const [videoDone, setVideoDone] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const together = useRef(true);
  const { width, height } = useWindowDimensions();
  const sideBySide = width >= c.harborPreview.twoColumnMinWidth;
  const availableWidth =
    (width - p.space[5] * 2 - (sideBySide && !originalOnly ? p.space[5] : 0)) /
    (sideBySide && !originalOnly ? 2 : 1);
  const shape = FORMATS[format];
  const frameWidth = Math.min(
    availableWidth,
    (Math.max(height * c.harborPreview.frameWindowHeight, c.harborPreview.minFrameHeight) *
      shape.width) /
      shape.height,
  );
  const frameHeight = (frameWidth * shape.height) / shape.width;
  const player = useVideoPlayer(ORIGINALS[direction], (video) => {
    video.loop = false;
    video.muted = true;
  });
  useEffect(() => {
    if (player.status === 'readyToPlay') setVideoReady(true);
  }, [player]);
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay') setVideoReady(true);
    if (status === 'error') {
      setVideoError(true);
      together.current = false;
      setNewPaused(false);
    }
  });
  useEventListener(player, 'playToEnd', () => setVideoDone(true));
  useEffect(() => {
    if (!together.current || !videoReady || (!originalOnly && !newReady)) return;
    together.current = false;
    setNewPaused(false);
    player.play();
  }, [player, videoReady, newReady, originalOnly]);
  const resetNew = (paused: boolean) => {
    setNewDone(false);
    setNewReady(false);
    setNewPaused(paused);
    setReplay((value) => value + 1);
  };
  const restartBoth = () => {
    player.pause();
    player.currentTime = 0;
    setVideoDone(false);
    // 원본 전용 모드는 새 장면의 준비 신호가 없으므로 직접 재생한다.
    if (originalOnly) {
      together.current = false;
      player.play();
      return;
    }
    together.current = true;
    resetNew(true);
  };
  const selectDirection = (next: PreviewKind) => {
    if (next === direction) return restartBoth();
    player.pause();
    together.current = true;
    setVideoReady(false);
    setVideoDone(false);
    setVideoError(false);
    resetNew(true);
    setDirection(next);
  };
  return (
    <MotionContext.Provider value={false}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <Txt kind="h">컷신 비교</Txt>
        <Txt>같은 화면 비율에서 기존 영상의 액션·카메라 움직임과 새 장면을 비교해 보세요.</Txt>
        <View style={styles.controls}>
          {SCENES.map((value) => (
            <Btn
              key={value}
              title={SCENE_NAMES[value]}
              kind={direction === value ? 'primary' : 'ghost'}
              onPress={() => selectDirection(value)}
            />
          ))}
          {(Object.keys(FORMATS) as Format[]).map((value) => (
            <Btn
              key={value}
              title={FORMATS[value].label}
              kind={format === value ? 'primary' : 'ghost'}
              onPress={() => setFormat(value)}
            />
          ))}
        </View>
        <View style={styles.controls}>
          <Btn title={originalOnly ? '처음부터' : '함께 처음부터'} onPress={restartBoth} />
          <Btn
            title={originalOnly ? '일시정지' : '함께 일시정지'}
            kind="ghost"
            onPress={() => {
              together.current = false;
              player.pause();
              setNewPaused(true);
            }}
          />
          <Btn
            title={originalOnly ? '이어 재생' : '함께 이어 재생'}
            kind="ghost"
            onPress={() => {
              if (newDone || videoDone) return restartBoth();
              together.current = true;
              if (videoReady && (originalOnly || newReady)) {
                together.current = false;
                setNewPaused(false);
                player.play();
              }
            }}
          />
        </View>
        <View
          style={[
            styles.panels,
            {
              flexDirection: sideBySide ? 'row' : 'column',
              alignItems: sideBySide ? 'flex-start' : 'center',
            },
          ]}
        >
          <View style={[styles.panel, { width: frameWidth }]}>
            <Txt kind="h17">기존 영상{videoDone ? ' · 재생 완료' : ''}</Txt>
            <Txt kind="meta">기존 회색 고양이 · 원본 MP4</Txt>
            <View
              testID="harbor-original-frame"
              style={[styles.frame, { width: frameWidth, height: frameHeight }]}
            >
              <VideoView
                player={player}
                nativeControls
                contentFit="contain"
                playsInline
                testID="harbor-original-video"
                style={{
                  position: 'absolute',
                  top: 0,
                  height: frameHeight,
                  ...cutsceneVideoBox(frameWidth, frameHeight),
                }}
              />
            </View>
            {videoError && <Txt>원본 영상을 읽지 못했어요. 페이지를 새로고침해 주세요.</Txt>}
            <Btn
              title="원본 다시 재생"
              kind="ghost"
              onPress={() => {
                together.current = false;
                player.currentTime = 0;
                setVideoDone(false);
                player.play();
              }}
            />
          </View>
          {direction !== 'golden-fish' && (
            <View style={[styles.panel, { width: frameWidth }]}>
              <Txt kind="h17">새 분리 애니메이션{newDone ? ' · 재생 완료' : ''}</Txt>
              <Txt kind="meta">내 고양이 색 반영 · 바다 전체 화면</Txt>
              <View
                testID="harbor-new-frame"
                style={[styles.frame, { width: frameWidth, height: frameHeight }]}
              >
                <HarborCutscene
                  key={`${direction}-${color}-${replay}`}
                  color={color}
                  direction={direction}
                  accessibilityLabel={label(direction)}
                  paused={newPaused}
                  onReady={() => setNewReady(true)}
                  onFinish={() => setNewDone(true)}
                />
              </View>
              <Btn
                title="새 장면 다시 재생"
                kind="ghost"
                onPress={() => {
                  together.current = false;
                  resetNew(false);
                }}
              />
              <View style={styles.controls}>
                {colors.map((value) => (
                  <Btn
                    key={value}
                    title={t(`color.${value}`)}
                    kind={value === color ? 'primary' : 'ghost'}
                    onPress={() => {
                      setColor(value);
                      restartBoth();
                    }}
                  />
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </MotionContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { flex: 1, backgroundColor: p.color.paper },
  content: { padding: p.space[5], gap: p.space[3] },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: p.space[2] },
  panels: { gap: p.space[5], justifyContent: 'center' },
  panel: { gap: p.space[2], alignItems: 'center', minWidth: 0 },
  frame: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: c.overlay.cinematicBackground,
  },
});
