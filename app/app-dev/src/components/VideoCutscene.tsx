import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { MotionContext } from '@/design-system/primitives';
import { componentTokens } from '@/design-system/tokens';

type Props = {
  source: number;
  accessibilityLabel: string;
  onFinish: () => void;
  muted?: boolean;
  volume?: number;
  testID?: string;
  videoTestID?: string;
};

/** 동작 줄이기에서는 영상을 건너뛰고 바로 끝낸다. */
export function VideoCutscene(props: Props) {
  const finished = useRef(false);
  const onFinishRef = useRef(props.onFinish);
  onFinishRef.current = props.onFinish;
  // 어느 경로(재생 종료·오류·복구 타이머·동작 줄이기 건너뛰기)로 끝나든, 재생 중 동작 줄이기가
  // 바뀌어 분기가 갈려도 호출부에는 한 번만 알린다 — 호출부는 화면 전환이라 두 번 불리면 안 된다.
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onFinishRef.current();
  }, []);
  return useContext(MotionContext) ? (
    <Skipped finish={finish} />
  ) : (
    <Playing {...props} finish={finish} />
  );
}

function Skipped({ finish }: { finish: () => void }) {
  useEffect(() => {
    finish();
  }, [finish]);
  return null;
}

function Playing({
  source,
  accessibilityLabel,
  finish,
  muted = false,
  volume = 1,
  testID = 'video-cutscene',
  videoTestID = 'video-cutscene-video',
}: Omit<Props, 'onFinish'> & { finish: () => void }) {
  const lastProgress = useRef({ at: Date.now(), time: 0 });
  const stallRetries = useRef(0);
  const [started, setStarted] = useState(false);
  const player = useVideoPlayer(source, (video) => {
    video.loop = false;
    // 웹의 실시간 사건은 사용자 제스처가 아니므로 소리 있는 자동재생이 차단된다.
    // 컷신 영상은 무음이지만 muted·volume 은 호출부 설정을 그대로 따른다.
    video.muted = muted || Platform.OS === 'web';
    video.volume = Math.max(0, Math.min(1, volume));
    video.timeUpdateEventInterval = 0.5;
    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') {
      video.play();
    }
  });
  useEventListener(player, 'playToEnd', finish);
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (!isPlaying) return;
    lastProgress.current.at = Date.now();
    setStarted(true);
  });
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (currentTime <= lastProgress.current.time + 0.05) return;
    lastProgress.current = { at: Date.now(), time: currentTime };
    stallRetries.current = 0;
  });
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error') finish();
    else if (
      status === 'readyToPlay' &&
      AppState.currentState !== 'background' &&
      AppState.currentState !== 'inactive'
    )
      player.play();
  });
  useEffect(() => {
    // 재생이 시작된 뒤에는 버퍼링·백그라운드 중 wall-clock으로 조기 종료하지 않는다.
    // 정상 종료는 playToEnd가 맡고, 이 타이머는 포그라운드에서 재생 자체가 시작되지 못한 경우만 복구한다.
    if (started) return;
    let remaining = 8_000;
    let activeSince = Date.now();
    let fallback: ReturnType<typeof setTimeout> | null = null;
    const suspended = () =>
      AppState.currentState === 'background' || AppState.currentState === 'inactive';
    const pause = () => {
      if (!fallback) return;
      remaining = Math.max(0, remaining - (Date.now() - activeSince));
      clearTimeout(fallback);
      fallback = null;
    };
    const resume = () => {
      pause();
      activeSince = Date.now();
      fallback = setTimeout(finish, remaining);
    };
    if (!suspended()) resume();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') resume();
      else pause();
    });
    return () => {
      pause();
      subscription.remove();
    };
  }, [finish, started]);
  useEffect(() => {
    const syncPlayback = (state: string | null) => {
      if (state === 'background' || state === 'inactive') {
        player.pause();
        return;
      }
      lastProgress.current.at = Date.now();
      player.play();
    };
    if (AppState.currentState === 'background' || AppState.currentState === 'inactive') {
      player.pause();
    }
    const subscription = AppState.addEventListener('change', (state) => {
      syncPlayback(state);
    });
    return () => subscription.remove();
  }, [player]);
  useEffect(() => {
    if (!started) return;
    const watchdog = setInterval(() => {
      if (
        AppState.currentState === 'background' ||
        AppState.currentState === 'inactive' ||
        Date.now() - lastProgress.current.at < 10_000
      )
        return;
      if (stallRetries.current === 0) {
        stallRetries.current = 1;
        lastProgress.current.at = Date.now();
        player.play();
        return;
      }
      finish();
    }, 2_000);
    return () => clearInterval(watchdog);
  }, [finish, player, started]);

  return (
    <View
      pointerEvents="auto"
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="assertive"
      accessibilityViewIsModal
      testID={testID}
      style={styles.overlay}
    >
      <VideoView
        player={player}
        nativeControls={false}
        contentFit="contain"
        playsInline
        surfaceType="textureView"
        testID={videoTestID}
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
