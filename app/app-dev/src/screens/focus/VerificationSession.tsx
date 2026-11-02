import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, View, type TextStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Btn, Txt } from '@/design-system/patterns';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { useKeepAwake } from 'expo-keep-awake';
import { openVerificationCapture } from '@/services/studyVerification/sessionResult';
import {
  MEASUREMENT_STALE_MS,
  type VerificationCadence,
} from '@/services/studyVerification/cadence';
import { VerificationCamera, type VerificationDetection } from './VerificationCamera';
import type { VerificationCameraPosition } from '@/services/studyVerification/types';
import type { StudyObjectPresence } from '@/services/studyVerification/studyObjects';

/** 설정을 꺼도 이 컴포넌트는 유지해 이미 확인한 인증 시간을 보존한다. */
export function VerificationSession({
  sessionId,
  enabled = true,
  previewVisible = false,
  onCameraPositionChange,
  cameraPosition = 'back',
  textStyle,
}: {
  sessionId?: string;
  enabled?: boolean;
  previewVisible?: boolean;
  onCameraPositionChange?: (position: VerificationCameraPosition) => void;
  cameraPosition?: VerificationCameraPosition;
  textStyle?: TextStyle;
}) {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setForeground(state === 'active'),
    );
    return () => subscription.remove();
  }, []);
  if ((!enabled && !previewVisible) || !foreground) return null;
  return (
    <SessionCamera
      key={`${cameraPosition}:${enabled}:${attempt}`}
      sessionId={enabled ? sessionId : undefined}
      measurementEnabled={enabled}
      previewVisible={previewVisible}
      showFeedback={enabled && !sessionId}
      onRetry={() => setAttempt((previous) => previous + 1)}
      cadence={sessionId || !previewVisible ? 'periodic' : 'live'}
      onCameraPositionChange={onCameraPositionChange}
      position={cameraPosition}
      textStyle={textStyle}
    />
  );
}

/** 프리뷰와 판정은 하나의 촬영 세션만 사용한다. 꺼진 동안의 구간은 합산하지 않는다. */
function SessionCamera({
  sessionId,
  measurementEnabled,
  previewVisible,
  showFeedback,
  cadence,
  onCameraPositionChange,
  position,
  textStyle,
  onRetry,
}: {
  sessionId?: string;
  measurementEnabled: boolean;
  position: VerificationCameraPosition;
  previewVisible: boolean;
  showFeedback: boolean;
  cadence: VerificationCadence;
  onCameraPositionChange?: (position: VerificationCameraPosition) => void;
  textStyle?: TextStyle;
  onRetry: () => void;
}) {
  useKeepAwake('verification-spike');
  const [ready, setReady] = useState(false);
  const [detection, setDetection] = useState<VerificationDetection>('checking');
  const [error, setError] = useState(false);
  const [objects, setObjects] = useState<StudyObjectPresence | null>(null);
  const capture = useRef<ReturnType<typeof openVerificationCapture> | null>(null);
  const frameReady = useRef(false);
  const mounted = useRef(true);
  const failed = useRef(false);
  const previewShown = useRef(previewVisible);
  previewShown.current = previewVisible;
  const verificationSeconds = useRef(0);
  const receive = useCallback((next: VerificationDetection) => {
    if (!mounted.current || failed.current) return;
    const seconds = capture.current?.observe(frameReady.current && next === 'focused');
    if (seconds != null) {
      if (__DEV__ && seconds !== verificationSeconds.current && seconds % 5 === 0)
        console.log(
          '[verification-session] verified seconds',
          seconds,
          'preview visible',
          previewShown.current,
        );
      verificationSeconds.current = seconds;
    }
    setDetection(next);
  }, []);
  const readyForFrames = useCallback(() => {
    if (!mounted.current || failed.current) return;
    frameReady.current = true;
    setReady(true);
  }, []);
  const pause = useCallback(() => {
    if (!mounted.current) return;
    frameReady.current = false;
    capture.current?.pause();
    setReady(false);
    setObjects(null);
    receive('checking');
  }, [receive]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      frameReady.current = false;
    };
  }, []);
  useEffect(() => {
    const activeCapture = sessionId
      ? openVerificationCapture(sessionId, { holdMs: MEASUREMENT_STALE_MS })
      : null;
    capture.current = activeCapture;
    return () => {
      activeCapture?.close();
    };
  }, [sessionId]);
  const ui = componentTokens.verificationSetup;
  const visibleDetection = ready && !error ? detection : 'checking';
  const measuring = ready && detection !== 'unavailable';
  return (
    <View
      testID="verification-session"
      style={
        measurementEnabled || previewVisible || error
          ? { width: ui.sessionPreviewWidth, alignItems: 'center', gap: primitiveTokens.space[1] }
          : { width: 0, height: 0 }
      }
    >
      {measurementEnabled && !error && (
        <View
          testID="verification-measurement-indicator"
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          accessibilityLabel={t(
            measuring
              ? 'verification.session.measurementActiveA11y'
              : 'verification.session.measurementPreparing',
          )}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-start',
            gap: primitiveTokens.space[1],
            backgroundColor: ui.statusBackground,
            paddingHorizontal: ui.statusPaddingHorizontal,
            paddingVertical: ui.statusPaddingVertical,
            borderRadius: semanticTokens.radius.control,
            maxWidth: '100%',
          }}
        >
          <Txt kind="meta" style={{ flexShrink: 1 }}>
            {t(
              measuring
                ? 'verification.session.measurementActive'
                : 'verification.session.measurementPreparing',
            )}
          </Txt>
          <View
            testID="verification-measurement-dot"
            style={{
              width: ui.statusDotSize,
              height: ui.statusDotSize,
              borderRadius: semanticTokens.radius.full,
              backgroundColor: measuring ? ui.measurementColor : ui.waitingColor,
            }}
          />
        </View>
      )}
      <View
        testID={previewVisible ? 'verification-session-preview' : undefined}
        style={
          previewVisible
            ? {
                width: ui.sessionPreviewWidth,
                aspectRatio: ui.previewAspectRatio,
                borderRadius: semanticTokens.radius.control,
                overflow: 'hidden',
                backgroundColor: ui.previewBackground,
                borderWidth: semanticTokens.stroke.strong,
                borderColor: semanticTokens.color.outline,
              }
            : undefined
        }
      >
        <VerificationCamera
          position={position}
          active={!error}
          measurementEnabled={measurementEnabled}
          previewVisible={previewVisible}
          cadence={cadence}
          onReady={readyForFrames}
          onPaused={pause}
          onDetection={receive}
          onStudyObjects={setObjects}
          onError={() => {
            if (!mounted.current || failed.current) return;
            failed.current = true;
            pause();
            setError(true);
          }}
        />
        {previewVisible && onCameraPositionChange && (
          <Pressable
            pointerEvents="auto"
            accessibilityRole="button"
            accessibilityLabel={t('verification.setup.flip')}
            onPress={() => onCameraPositionChange(position === 'back' ? 'front' : 'back')}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: ui.buttonSize,
              height: ui.buttonSize,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Svg width={ui.iconSize} height={ui.iconSize} viewBox="0 0 24 24" fill="none">
              <Path
                d="M4 8h3l2-3h6l2 3h3v11H4z M9 12h6m-2-2 2 2-2 2"
                stroke={semanticTokens.color.surface}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
        )}
      </View>
      {error && (
        <View
          style={{
            width: '100%',
            gap: primitiveTokens.space[1],
            backgroundColor: ui.statusBackground,
            paddingHorizontal: ui.statusPaddingHorizontal,
            paddingVertical: ui.statusPaddingVertical,
            borderRadius: semanticTokens.radius.control,
          }}
        >
          <Txt
            kind="meta"
            accessibilityLiveRegion="polite"
            style={[textStyle, { textAlign: 'center' }]}
          >
            {t('verification.session.cameraError')}
          </Txt>
          <Btn
            small
            kind="sec"
            title={t('common.retry')}
            accessibilityLabel={t('verification.session.retryCamera')}
            font={textStyle?.fontFamily}
            onPress={onRetry}
          />
        </View>
      )}
      {previewVisible && showFeedback && !error && (
        <>
          <View
            accessible
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            accessibilityLabel={t(
              error
                ? 'verification.setup.cameraError'
                : `verification.setup.detection.${visibleDetection}`,
            )}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: primitiveTokens.space[1],
              backgroundColor: ui.statusBackground,
              paddingHorizontal: ui.statusPaddingHorizontal,
              paddingVertical: ui.statusPaddingVertical,
              borderRadius: semanticTokens.radius.control,
              maxWidth: '100%',
            }}
          >
            <View
              testID="verification-session-light"
              style={{
                width: ui.statusDotSize,
                height: ui.statusDotSize,
                borderRadius: semanticTokens.radius.full,
                backgroundColor: visibleDetection === 'focused' ? ui.readyColor : ui.waitingColor,
              }}
            />
            <Txt kind="meta" style={[textStyle, { flexShrink: 1 }]}>
              {t(
                error
                  ? 'verification.setup.cameraError'
                  : `verification.setup.detection.${visibleDetection}`,
              )}
            </Txt>
          </View>
          {ready &&
            !error &&
            visibleDetection !== 'focused' &&
            objects &&
            Object.values(objects).some(Boolean) && (
              <Txt kind="meta" style={[textStyle, { textAlign: 'center' }]}>
                {t('verification.setup.objects.detected', {
                  objects: (['book', 'laptop', 'keyboard'] as const)
                    .filter((key) => objects[key])
                    .map((key) => t(`verification.setup.objects.${key}`))
                    .join(' · '),
                })}
              </Txt>
            )}
        </>
      )}
    </View>
  );
}
