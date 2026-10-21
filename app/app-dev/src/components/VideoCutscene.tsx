import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { MotionContext } from '@/design-system/primitives';
import { componentTokens } from '@/design-system/tokens';

/**
 * 전체 화면 컷신 영상 한 편 — 끝(재생 종료·오류·복구 타이머·동작 줄이기 건너뛰기)을 `onFinish` 로 한 번만 알린다.
 * 한 인스턴스는 영상 한 편이다: `finished` 가 되살아나지 않으므로 다른 영상을 이어 틀려면 `source` 를 바꾸지 말고
 * `key` 로 새로 그린다. 호출부는 끝나면 보통 화면을 옮겨 이 컴포넌트를 내린다.
 */
type Props = {
  source: number;
  accessibilityLabel: string;
  onFinish: () => void;
  muted?: boolean;
  volume?: number;
  testID?: string;
  videoTestID?: string;
};

/** 컷신 영상 다섯 편은 모두 1080×1920 세로다. */
const VIDEO_ASPECT = 9 / 16;

/**
 * 영상 상자 — 화면 높이에 맞춘 9:16 을 가운데 둔다. 세로 폰(화면이 9:16 보다 길쭉)에서는 위아래를 꽉 채우고 좌우가
 * 한쪽에 최대 10%쯤 화면 밖으로 나가며(overlay 가 자른다), 태블릿·가로·웹 창처럼 납작한 화면에서는 좌우에 여백을 두고
 * 전체를 보인다. 위아래 띠를 두면 영상 가장자리에 걸친 섬·부두가 잘린 것처럼 보여서다. 상자가 이미 영상 비율이라
 * 네이티브 contentFit 에 기대지 않는다 — iOS 26 시뮬레이터에서 `contentFit="cover"` 가 무시되는 것을 실측했다.
 */
export const cutsceneVideoBox = (windowWidth: number, windowHeight: number) => {
  const width = windowHeight * VIDEO_ASPECT;
  return { width, left: (windowWidth - width) / 2 };
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // 상자는 overlay 의 실측 크기로 잡는다 — 안드로이드 비 edge-to-edge·웹 폰 프레임에서는 창 크기와 다르다. 첫 그림은 창 크기.
  const [frame, setFrame] = useState({ width: windowWidth, height: windowHeight });
  const box = cutsceneVideoBox(frame.width, frame.height);
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
      onLayout={({ nativeEvent: { layout } }) =>
        setFrame({ width: layout.width, height: layout.height })
      }
    >
      <VideoView
        player={player}
        nativeControls={false}
        playsInline
        surfaceType="textureView"
        testID={videoTestID}
        style={[styles.video, box]}
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
    // 세로 폰에서 화면 밖으로 나가는 영상 좌우를 자른다(웹에서 가로 스크롤이 생기지 않게).
    overflow: 'hidden',
    // 좌우 여백이 남는 납작한 화면(태블릿·가로)에서 그 여백을 어둡게 칠해 뒤 UI 를 누른다.
    backgroundColor: componentTokens.overlay.cinematicBackground,
  },
  // 폭·왼쪽은 `cutsceneVideoBox` 가 준다(웹의 replaced <video>는 크기를 명시해야 늘어난다).
  video: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
});
