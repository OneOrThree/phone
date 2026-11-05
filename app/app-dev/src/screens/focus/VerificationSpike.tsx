/** 낚시섬 AI집중측정 스위치·미리보기 제어. 제품 노출에 개발용 환경변수는 사용하지 않는다. */
import { useEffect, useRef, useState } from 'react';
import { readAccountGuides, saveAccountGuides } from '@/services/accountGuides';
import { getSession, sessionGeneration } from '@/services/api/session';
import { captureProductEvent } from '@/services/posthog';
import { duringSystemPrompt } from './focusLeave';
import { VerificationIntro, type VerificationControlAnchor } from './VerificationIntro';
import { Alert, Linking, Pressable, View } from 'react-native';
import { Toggle, Txt } from '@/design-system/patterns';
import { useCameraPermissions } from 'expo-camera';
import Svg, { Circle, Path } from 'react-native-svg';
import { C, componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { type VerificationCameraPosition } from '@/services/studyVerification/types';
import { loadTensorflowModel } from 'react-native-fast-tflite';
import {
  OBJECT_INPUT,
  objectScoreIndex,
  studyObjectScores,
} from '@/services/studyVerification/studyObjects';
import { PALM_INPUT, maxSigmoid, scoreTensorIndex } from '@/services/studyVerification/palmScore';

export { VerificationSession as VerificationSpike } from './VerificationSession';

/** 스파이크 점검용: 번들된 .tflite 가 로드되는지, 텐서 모양이 맞는지 Metro 콘솔에 찍는다. */
export async function probeModel(): Promise<void> {
  const t0 = Date.now();
  try {
    const m = await loadTensorflowModel(require('../../assets/ml/palm_detection_lite.tflite'), []);
    console.log('[verify-spike] model loaded', Date.now() - t0, 'ms', {
      inputs: m.inputs.map((x) => `${x.name} ${x.dataType} [${x.shape.join(',')}]`),
      outputs: m.outputs.map((x) => `${x.name} ${x.dataType} [${x.shape.join(',')}]`),
      scoreIdx: scoreTensorIndex(m.outputs),
    });
    // 검은 프레임 한 장으로 추론 1회 — 지연과 점수 범위 확인(손 없음 → 0.5 미만이어야 함)
    const t1 = Date.now();
    const out = await m.run([new Float32Array(PALM_INPUT * PALM_INPUT * 3).buffer]);
    console.log(
      '[verify-spike] blank frame score',
      maxSigmoid(new Float32Array(out[scoreTensorIndex(m.outputs)]!)).toFixed(3),
      Date.now() - t1,
      'ms',
    );
  } catch (e) {
    console.log('[verify-spike] model load failed', String(e));
  }
  if (!__DEV__) return;
  try {
    const objectModel = await loadTensorflowModel(
      require('../../assets/ml/efficientdet_lite0_int8.tflite'),
      [],
    );
    const index = objectScoreIndex(objectModel.inputs, objectModel.outputs);
    if (index < 0) throw new Error('Unexpected object model tensor layout');
    const started = Date.now();
    const output = await objectModel.run([new Uint8Array(OBJECT_INPUT * OBJECT_INPUT * 3).buffer]);
    console.log(
      '[verify-spike] object model ready',
      JSON.stringify({
        elapsedMs: Date.now() - started,
        blankFrameScores: studyObjectScores(new Float32Array(output[index]!)),
      }),
    );
  } catch (error) {
    console.warn('[verify-spike] object model unavailable', String(error));
  }
}

/** 스위치는 인증 온오프, 카메라 버튼은 미리보기만 담당한다. */
export function VerificationToggle({
  on,
  cameraPosition = 'back',
  onChange,
  inSession = false,
  intro,
  onPreviewChange,
}: {
  on: boolean;
  inSession?: boolean;
  onPreviewChange?: (open: boolean) => void;
  intro?: 'automatic' | 'onPress';
  cameraPosition?: VerificationCameraPosition;
  onChange: (next: boolean, position: VerificationCameraPosition) => void;
}) {
  const [open, setOpen] = useState(false);
  const measurementOn = useRef(on);
  measurementOn.current = on;
  const [, requestPermission, getPermission] = useCameraPermissions();
  const [requesting, setRequesting] = useState(false);
  const owner = getSession()?.userId;
  const generation = sessionGeneration();
  const lastUsage = useRef<{
    owner: string;
    generation: number;
    on: boolean;
    open: boolean;
    inSession: boolean;
  } | null>(null);
  const [education, setEducation] = useState<{
    owner: string | undefined;
    generation: number;
    seen: boolean;
  } | null>(null);
  const [introOpen, setIntroOpen] = useState(false);
  const controlsRef = useRef<View>(null);
  const [introAnchor, setIntroAnchor] = useState<VerificationControlAnchor>();
  useEffect(() => {
    if (!introOpen) return;
    controlsRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) setIntroAnchor({ x, y, width, height });
    });
  }, [introOpen]);
  useEffect(() => {
    setIntroOpen(false);
    setOpen(false);
    onPreviewChange?.(false);
  }, [owner, generation, onPreviewChange]);
  useEffect(() => () => onPreviewChange?.(false), [onPreviewChange]);
  useEffect(() => {
    if (!owner) {
      lastUsage.current = null;
      return;
    }
    const previous = lastUsage.current;
    const sameAccount = previous?.owner === owner && previous.generation === generation;
    // 계정 전환 직후에는 위 효과가 이전 미리보기를 닫은 다음 새 계정 상태를 관측한다.
    if (previous && !sameAccount && open) return;
    if (
      sameAccount &&
      previous.on === on &&
      previous.open === open &&
      previous.inSession === inSession
    )
      return;
    lastUsage.current = { owner, generation, on, open, inSession };
    // OFF로 유지한 사용자도 분모에 포함한다. 영상·판정·인증 시간은 보내지 않는다.
    captureProductEvent('focus_verification_state_observed', {
      analytics_schema_version: 1,
      focus_location: 'fishing_island',
      focus_phase: inSession ? 'focusing' : 'before_focus',
      measurement_state: on ? 'on' : 'off',
      preview_state: open ? 'open' : 'closed',
      measurement_changed: sameAccount && previous.on !== on ? 1 : 0,
      preview_changed: sameAccount && previous.open !== open ? 1 : 0,
      observation_reason:
        !sameAccount || previous.inSession !== inSession ? 'screen_opened' : 'state_changed',
    });
  }, [owner, generation, on, open, inSession]);
  const checked = education?.owner === owner && education?.generation === generation;
  useEffect(() => {
    if (!intro) return;
    let cancelled = false;
    const accept = (seen: boolean) => {
      if (!cancelled && sessionGeneration() === generation && getSession()?.userId === owner)
        setEducation({ owner, generation, seen });
    };
    if (!owner) accept(false);
    else
      readAccountGuides(owner)
        .then((guides) => accept(!!guides.verificationIntroSeen))
        .catch(() => accept(false));
    return () => {
      cancelled = true;
    };
  }, [intro, owner, generation]);
  useEffect(() => {
    if (intro === 'automatic' && checked && !education?.seen) setIntroOpen(true);
  }, [intro, checked, education?.seen]);
  useEffect(() => {
    if (__DEV__ && introOpen) console.log('[verification-intro] shown');
  }, [introOpen]);
  const consumeIntro = () => {
    setIntroOpen(false);
    setEducation({ owner, generation, seen: true });
    if (owner)
      void saveAccountGuides(owner, { verificationIntroSeen: true }).catch((error) => {
        if (__DEV__) console.warn('[verification-intro] 안내 이력 저장 실패', String(error));
      });
  };
  const changeVerification = async (next: boolean, previewOnly = false) => {
    if (!next) {
      if (previewOnly) {
        setOpen(false);
        onPreviewChange?.(false);
      } else onChange(false, cameraPosition);
      return;
    }
    if (intro && !education?.seen) {
      setIntroOpen(true);
      return;
    }
    setRequesting(true);
    try {
      let permission = await getPermission();
      // 권한 창은 Android 에서 앱을 나간 것처럼 보인다 — 그동안 이탈 폴백을 멈춘다(GROMO-2635)
      if (!permission.granted && permission.canAskAgain)
        permission = await duringSystemPrompt(requestPermission);
      if (getSession()?.userId !== owner || sessionGeneration() !== generation) return;
      if (previewOnly && !measurementOn.current) return;
      if (permission.granted) {
        if (previewOnly) {
          setOpen(true);
          onPreviewChange?.(true);
        } else onChange(true, cameraPosition);
      } else
        Alert.alert(t('verification.setup.denied'), undefined, [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('verification.setup.openSettings'),
            onPress: () => {
              Linking.openSettings().catch(() =>
                Alert.alert(t('verification.setup.settingsError')),
              );
            },
          },
        ]);
    } catch {
      if (getSession()?.userId === owner && sessionGeneration() === generation)
        Alert.alert(t('verification.setup.permissionError'));
    } finally {
      setRequesting(false);
    }
  };
  const showPreview = () => {
    if (open) void changeVerification(false, true);
    else if (!on) Alert.alert(t('verification.setup.enableMeasurement'));
    else if (intro && !education?.seen) setIntroOpen(true);
    else void changeVerification(true, true);
  };
  const busy = requesting || (!!intro && !checked && !(inSession && on));
  const ui = componentTokens.verificationSetup;
  // 두 라벨은 각 컨트롤 가운데 아래에 붙는다. 두 컨트롤의 중심 간격(스위치 46/2 + 간격 + 버튼 44/2)보다
  // 넓으면 큰 글씨·영어·태블릿에서 서로 겹치므로, 폭을 버튼 + 간격으로 묶고 한 줄 안에서 줄여 맞춘다.
  const controlLabel = {
    kind: 'meta',
    numberOfLines: 1,
    adjustsFontSizeToFit: true,
    maxFontSizeMultiplier: semanticTokens.typography.largeTextThreshold,
    style: {
      position: 'absolute',
      top: semanticTokens.size.tapMin,
      width: ui.buttonSize + semanticTokens.spacing.control,
      textAlign: 'center',
      color: primitiveTokens.color.black,
    },
  } as const;
  return (
    <>
      <View
        ref={controlsRef}
        collapsable={false}
        style={{ flexDirection: 'row', alignItems: 'center', gap: semanticTokens.spacing.control }}
      >
        <View
          style={{
            minHeight: semanticTokens.size.tapMin,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Toggle
            value={on}
            onChange={changeVerification}
            label={t('verification.switch')}
            accessibilityHint={t(
              on ? 'verification.session.turnOff' : 'verification.session.turnOn',
            )}
            disabled={requesting || (!!intro && !checked && !on)}
            activeColor={C.pink}
          />
          <Txt {...controlLabel}>{t('verification.switchLabel')}</Txt>
        </View>
        <View
          style={{
            minHeight: semanticTokens.size.tapMin,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('verification.button')}
            accessibilityHint={t('verification.setup.openHint')}
            accessibilityState={{ expanded: open || introOpen, disabled: busy, busy }}
            disabled={busy}
            accessibilityValue={{ text: t(on ? 'verification.on' : 'verification.off') }}
            onPress={showPreview}
            style={({ pressed }) => ({
              width: ui.buttonSize,
              height: ui.buttonSize,
              borderRadius: semanticTokens.radius.full,
              borderWidth: semanticTokens.stroke.strong,
              borderColor: C.brown,
              backgroundColor: C.paper,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? componentTokens.button.disabledOpacity : 1,
            })}
          >
            <Svg width={ui.iconSize} height={ui.iconSize} viewBox="0 0 24 24" fill="none">
              <Path
                d="M4 8h3l2-3h6l2 3h3v11H4z"
                stroke={C.ink}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              <Circle cx={12} cy={13} r={3.5} stroke={C.ink} strokeWidth={2} />
            </Svg>
          </Pressable>
          <Txt {...controlLabel}>{t('verification.intro.previewLabel')}</Txt>
        </View>
      </View>
      {intro && introOpen && <VerificationIntro anchor={introAnchor} onClose={consumeIntro} />}
    </>
  );
}
