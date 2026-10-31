/**
 * 집중 인증 스파이크 — 버리는 코드. `EXPO_PUBLIC_VERIFY_SPIKE=1` 로 Metro 를 띄웠을 때만
 * 집중 화면에 작은 카메라와 인증 상태를 붙인다. 제품 화면에서는 렌더되지 않는다.
 *
 * 집중 중에는 작은 라이브 미리보기를 띄운다. 같은 세션의 프레임으로 손을 확인한다.
 */
import { useEffect, useRef, useState } from 'react';
import { readAccountGuides, saveAccountGuides } from '@/services/accountGuides';
import { getSession, sessionGeneration } from '@/services/api/session';
import { captureProductEvent } from '@/services/posthog';
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
import {
  PALM_INPUT,
  maxSigmoid,
  rgbToFloat,
  scoreTensorIndex,
} from '@/services/studyVerification/palmScore';

export { VerificationSession as VerificationSpike } from './VerificationSession';

export const VERIFY_SPIKE = process.env.EXPO_PUBLIC_VERIFY_SPIKE === '1';

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
      if (!permission.granted && permission.canAskAgain) permission = await requestPermission();
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
          <Txt
            kind="meta"
            style={{
              position: 'absolute',
              top: semanticTokens.size.tapMin,
              width: ui.buttonSize * 2,
              textAlign: 'center',
              color: primitiveTokens.color.black,
            }}
          >
            {t('verification.switchLabel')}
          </Txt>
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
          <Txt
            kind="meta"
            style={{
              position: 'absolute',
              top: semanticTokens.size.tapMin,
              width: ui.buttonSize * 2,
              textAlign: 'center',
              color: primitiveTokens.color.black,
            }}
          >
            {t('verification.intro.previewLabel')}
          </Txt>
        </View>
      </View>
      {intro && introOpen && <VerificationIntro anchor={introAnchor} onClose={consumeIntro} />}
    </>
  );
}
