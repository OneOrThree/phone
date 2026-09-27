import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { componentTokens } from '@/design-system/tokens';

const PORTRAIT_SOURCE = require('@/assets/cutscenes/golden-fish-catch.mp4');
const LANDSCAPE_SOURCE = require('@/assets/cutscenes/golden-fish-catch-landscape.mp4');

export type GoldenFishVideoVariant = 'portrait' | 'landscape';

/** 좁은 분할 화면은 가로여도 세로 소스를 유지해 영상이 지나치게 작아지지 않게 한다. */
export function goldenFishVideoVariant(width: number, height: number): GoldenFishVideoVariant {
  return width >= 600 && width > height ? 'landscape' : 'portrait';
}

export function GoldenFishCutscene({
  onFinish,
  autoplayMuted = false,
}: {
  onFinish: () => void;
  /** 브라우저의 소리 있는 자동재생 차단을 피하는 임시 웹 검수 옵션. */
  autoplayMuted?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const variant = goldenFishVideoVariant(width, height);
  const source = variant === 'landscape' ? LANDSCAPE_SOURCE : PORTRAIT_SOURCE;
  const finished = useRef(false);
  const [started, setStarted] = useState(false);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onFinish();
  }, [onFinish]);
  const player = useVideoPlayer(source, (video) => {
    video.loop = false;
    // 웹의 실시간 사건은 사용자 제스처가 아니므로 소리 있는 자동재생이 차단된다.
    // 네이티브에서는 영상에 합쳐진 바다 소리를 그대로 재생한다.
    video.muted = autoplayMuted || Platform.OS === 'web';
    video.play();
  });
  useEventListener(player, 'playToEnd', finish);
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (!isPlaying) return;
    setStarted(true);
  });
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error') finish();
    else if (status === 'readyToPlay') player.play();
  });
  useEffect(() => {
    setStarted(false);
  }, [variant]);
  useEffect(() => {
    // 재생 전에는 로딩 여유를 주고, 재생이 시작된 뒤에는 선택한 원본이 끝날 시간을 보장한다.
    const fallback = setTimeout(finish, started ? 5000 : 8000);
    return () => clearTimeout(fallback);
  }, [finish, started]);

  return (
    <View
      pointerEvents="auto"
      accessibilityLabel="여러 고양이가 힘을 모아 황금 물고기를 낚아 올렸어요"
      accessibilityLiveRegion="assertive"
      accessibilityViewIsModal
      testID="golden-fish-cutscene"
      style={styles.overlay}
    >
      <VideoView
        player={player}
        nativeControls={false}
        contentFit="contain"
        playsInline
        surfaceType="textureView"
        testID="golden-fish-video"
        accessibilityLabel={
          variant === 'landscape' ? '가로 황금 물고기 영상' : '세로 황금 물고기 영상'
        }
        style={styles.video}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    // contain 여백의 섬은 맥락만 남기고 뒤 UI는 눌러 영상 경계가 자연스럽게 이어지게 한다.
    backgroundColor: componentTokens.overlay.cinematicBackground,
  },
  // 웹의 replaced <video>는 left/right만으로 intrinsic 720px 폭이 늘어나지 않아 크기를 명시한다.
  video: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
});
