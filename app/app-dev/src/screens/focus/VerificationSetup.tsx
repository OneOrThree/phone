import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Modal, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useCameraPermissions } from 'expo-camera';
import { Btn, Txt } from '@/design-system/patterns';
import { useScreenInsets } from '@/design-system/primitives';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { VerificationCamera, type VerificationDetection } from './VerificationCamera';

import type { VerificationCameraPosition } from '@/services/studyVerification/types';
export type { VerificationCameraPosition } from '@/services/studyVerification/types';

type Props = {
  on: boolean;
  inSession?: boolean;
  cameraPosition: VerificationCameraPosition;
  onChange: (on: boolean, position: VerificationCameraPosition) => void;
  onClose: () => void;
};

/** 기존 화면 위 작은 카메라에서 권한과 각도를 확인한 뒤 인증을 시작한다. */
export function VerificationSetup({
  on,
  cameraPosition,
  onChange,
  onClose,
  inSession = false,
}: Props) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const permissionKnown = permission != null;
  const hasPermission = permission?.granted === true;
  const canRequestPermission = permission?.canAskAgain === true;
  const [position, setPosition] = useState(cameraPosition);
  const [appState, setAppState] = useState(AppState.currentState);
  const [requesting, setRequesting] = useState(
    !permissionKnown || (!hasPermission && canRequestPermission),
  );
  const [previewReady, setPreviewReady] = useState(false);
  const [detection, setDetection] = useState<VerificationDetection>('checking');
  const [error, setError] = useState('');
  const insets = useScreenInsets();
  const ui = componentTokens.verificationSetup;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppState(state);
      if (state !== 'active') {
        setPreviewReady(false);
        setDetection('checking');
      } else getPermission().catch(() => setError(t('verification.setup.permissionError')));
    });
    return () => subscription.remove();
  }, [getPermission]);

  useEffect(() => {
    if (!permissionKnown) {
      setRequesting(true);
      return;
    }
    if (hasPermission || !canRequestPermission) {
      setRequesting(false);
      return;
    }
    let cancelled = false;
    setRequesting(true);
    requestPermission()
      .catch(() => {
        if (!cancelled) setError(t('verification.setup.permissionError'));
      })
      .finally(() => {
        if (!cancelled) setRequesting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [permissionKnown, hasPermission, canRequestPermission, requestPermission]);

  const foreground = appState === 'active';
  const ready = hasPermission && previewReady && foreground && !error;
  const visibleDetection = ready ? detection : 'checking';
  const pause = useCallback(() => {
    setPreviewReady(false);
    setDetection('checking');
  }, []);
  const fail = (cameraError: unknown) => {
    if (__DEV__) console.warn('[verification-camera]', String(cameraError));
    setPreviewReady(false);
    setDetection('checking');
    setError(t('verification.setup.cameraError'));
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View
        testID="verification-camera-screen"
        style={{
          flex: 1,
          backgroundColor: componentTokens.overlay.sheetBackground,
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: insets.top + semanticTokens.spacing.page,
          paddingBottom: insets.bottom + semanticTokens.spacing.page,
          paddingHorizontal: semanticTokens.spacing.page,
        }}
      >
        <Pressable
          accessible={false}
          onPress={onClose}
          style={{ position: 'absolute', inset: 0 }}
        />
        <View
          testID="verification-camera-card"
          style={{
            width: '100%',
            maxWidth: ui.previewMaxWidth,
            gap: semanticTokens.spacing.control,
          }}
        >
          <View
            testID="verification-preview"
            style={{
              width: '100%',
              aspectRatio: ui.previewAspectRatio,
              overflow: 'hidden',
              borderRadius: semanticTokens.radius.preview,
              borderWidth: semanticTokens.stroke.strong,
              borderColor: semanticTokens.color.outline,
              backgroundColor: ui.previewBackground,
            }}
          >
            {hasPermission ? (
              <VerificationCamera
                key={position}
                position={position}
                active={foreground && !error}
                onReady={() => setPreviewReady(true)}
                onPaused={pause}
                onDetection={setDetection}
                onError={fail}
              />
            ) : (
              <View
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  alignItems: 'center',
                  padding: semanticTokens.spacing.page,
                }}
              >
                {requesting ? (
                  <ActivityIndicator
                    accessibilityLabel={t('verification.setup.requesting')}
                    color={ui.overlayForeground}
                  />
                ) : (
                  <Txt style={{ color: ui.overlayForeground, textAlign: 'center' }}>
                    {t('verification.setup.denied')}
                  </Txt>
                )}
              </View>
            )}
            <View
              style={{
                position: 'absolute',
                top: semanticTokens.spacing.control,
                left: semanticTokens.spacing.control,
                right: semanticTokens.spacing.control,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Btn small kind="sec" title={t('common.close')} onPress={onClose} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('verification.setup.flip')}
                accessibilityState={{ disabled: !hasPermission || !foreground }}
                disabled={!hasPermission || !foreground}
                onPress={() => {
                  setPreviewReady(false);
                  setDetection('checking');
                  setError('');
                  setPosition((previous) => (previous === 'back' ? 'front' : 'back'));
                }}
                style={({ pressed }) => ({
                  width: ui.buttonSize,
                  height: ui.buttonSize,
                  borderRadius: semanticTokens.radius.full,
                  backgroundColor: semanticTokens.color.surface,
                  borderColor: semanticTokens.color.outline,
                  borderWidth: semanticTokens.stroke.strong,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? componentTokens.button.disabledOpacity : 1,
                })}
              >
                <Svg
                  width={ui.iconSize}
                  height={ui.iconSize}
                  viewBox="0 0 24 24"
                  fill="none"
                  accessible={false}
                >
                  <Path
                    d="M19 9a7 7 0 0 0-12-4L4 8m0-5v5h5M5 15a7 7 0 0 0 12 4l3-3m0 5v-5h-5"
                    stroke={semanticTokens.color.text}
                    strokeWidth={semanticTokens.stroke.strong}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </Pressable>
            </View>
          </View>
          <View
            testID="verification-camera-actions"
            style={{
              gap: semanticTokens.spacing.control,
            }}
          >
            {hasPermission && foreground && !error ? (
              <>
                <View
                  testID="verification-detection-status"
                  accessible
                  accessibilityRole="text"
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={t(`verification.setup.detection.${visibleDetection}`)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: semanticTokens.spacing.control,
                    padding: semanticTokens.spacing.control,
                    borderRadius: semanticTokens.radius.control,
                    backgroundColor: ui.statusBackground,
                  }}
                >
                  <View
                    testID="verification-detection-light"
                    style={{
                      width: ui.statusDotSize,
                      height: ui.statusDotSize,
                      borderRadius: semanticTokens.radius.full,
                      backgroundColor:
                        visibleDetection === 'focused' ? ui.readyColor : ui.waitingColor,
                    }}
                  />
                  <Txt>{t(`verification.setup.detection.${visibleDetection}`)}</Txt>
                </View>
                <Txt kind="meta" style={{ textAlign: 'center' }}>
                  {t(
                    visibleDetection === 'focused'
                      ? 'verification.setup.detectedHint'
                      : 'verification.setup.hint',
                  )}
                </Txt>
              </>
            ) : null}
            {error ? (
              <Txt accessibilityRole="alert" style={{ color: semanticTokens.color.danger }}>
                {error}
              </Txt>
            ) : null}
            {!hasPermission && !requesting ? (
              <Btn
                kind="sec"
                title={t('verification.setup.openSettings')}
                onPress={() => {
                  Linking.openSettings().catch(() =>
                    setError(t('verification.setup.settingsError')),
                  );
                }}
              />
            ) : null}
            <Btn
              title={t(inSession ? 'verification.session.enable' : 'verification.setup.enable')}
              disabled={!ready}
              onPress={() => {
                onChange(true, position);
                onClose();
              }}
            />
            {on ? (
              <Btn
                kind="ghost"
                title={t('verification.setup.disable')}
                onPress={() => {
                  onChange(false, position);
                  onClose();
                }}
              />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
