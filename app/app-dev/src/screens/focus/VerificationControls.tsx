import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Pressable, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import Svg, { Circle, Path } from 'react-native-svg';
import { Txt } from '@/design-system/patterns';
import { C, componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { readAccountGuides, saveAccountGuides } from '@/services/accountGuides';
import { getSession, sessionGeneration } from '@/services/api/session';
import { captureProductEvent } from '@/services/posthog';
import { t } from '@/i18n';
import { VerificationIntro, type VerificationControlAnchor } from './VerificationIntro';

/** 측정은 안내·카메라 권한 확인 뒤 자동으로 시작하고, 버튼은 미리보기만 바꾼다. */
export function VerificationControls({
  inSession = false,
  intro,
  onMeasurementChange,
  onPreviewChange,
}: {
  inSession?: boolean;
  intro?: 'automatic';
  onMeasurementChange: (enabled: boolean) => void;
  onPreviewChange: (open: boolean) => void;
}) {
  const owner = getSession()?.userId;
  const generation = sessionGeneration();
  const [, requestPermission, getPermission] = useCameraPermissions();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [open, setOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [revision, setRevision] = useState(0);
  const previewRequest = useRef<number | null>(null);
  const pendingPermission = useRef<ReturnType<typeof requestPermission> | null>(null);
  const [access, setAccess] = useState<{ owner: string; generation: number } | null>(null);
  const [education, setEducation] = useState<{
    owner: string;
    generation: number;
    seen: boolean;
  } | null>(null);
  const checked = !!owner && education?.owner === owner && education.generation === generation;
  const seen = checked && education.seen;
  const introOpen = !!intro && checked && !seen;
  const enabled =
    foreground && seen && access?.owner === owner && access?.generation === generation;
  const controlsRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<VerificationControlAnchor>();

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state !== 'active') setAccess(null);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setOpen(false);
    setAccess(null);
    previewRequest.current = null;
    if (owner)
      readAccountGuides(owner)
        .then((guides) => {
          if (!cancelled && getSession()?.userId === owner && sessionGeneration() === generation)
            setEducation({ owner, generation, seen: !!guides.verificationIntroSeen });
        })
        .catch(() => {
          if (!cancelled && getSession()?.userId === owner && sessionGeneration() === generation)
            setEducation({ owner, generation, seen: false });
        });
    return () => {
      cancelled = true;
    };
  }, [owner, generation]);
  useEffect(() => {
    if (!introOpen) return;
    controlsRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) setAnchor({ x, y, width, height });
    });
  }, [introOpen]);

  useEffect(() => {
    if (!owner || !seen || !foreground) return;
    let cancelled = false;
    const current = () =>
      !cancelled && getSession()?.userId === owner && sessionGeneration() === generation;
    const showPreview = previewRequest.current === revision;
    setRequesting(true);
    void (async () => {
      try {
        let permission = await getPermission();
        if (!current()) return;
        // 자동 요청은 미선택 권한만 대상으로 한다. 거절 후 재요청은 미리보기 조작에 한정한다.
        if (
          !permission.granted &&
          permission.canAskAgain &&
          (permission.status === 'undetermined' || showPreview)
        ) {
          const pending = pendingPermission.current ?? requestPermission();
          pendingPermission.current = pending;
          try {
            permission = await pending;
          } finally {
            if (pendingPermission.current === pending) pendingPermission.current = null;
          }
        }
        if (!current()) return;
        previewRequest.current = null;
        setAccess(permission.granted ? { owner, generation } : null);
        if (permission.granted && showPreview) {
          previewRequest.current = null;
          setOpen(true);
        } else if (!permission.granted) {
          setOpen(false);
          if (showPreview)
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
        }
      } catch {
        if (current()) {
          previewRequest.current = null;
          setAccess(null);
          setOpen(false);
          if (showPreview) Alert.alert(t('verification.setup.permissionError'));
        }
      } finally {
        if (current()) setRequesting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, generation, seen, foreground, revision, getPermission, requestPermission]);

  useEffect(() => {
    onMeasurementChange(
      enabled && getSession()?.userId === owner && sessionGeneration() === generation,
    );
  }, [enabled, owner, generation, onMeasurementChange]);
  useEffect(() => {
    onPreviewChange(
      open && enabled && getSession()?.userId === owner && sessionGeneration() === generation,
    );
  }, [open, enabled, owner, generation, onPreviewChange]);
  useEffect(
    () => () => {
      onMeasurementChange(false);
      onPreviewChange(false);
    },
    [onMeasurementChange, onPreviewChange],
  );

  const previousUsage = useRef<{
    owner: string;
    generation: number;
    enabled: boolean;
    open: boolean;
    inSession: boolean;
  } | null>(null);
  useEffect(() => {
    if (!owner || !checked || getSession()?.userId !== owner || sessionGeneration() !== generation)
      return;
    const visible = open && enabled;
    const previous = previousUsage.current;
    const sameAccount = previous?.owner === owner && previous.generation === generation;
    if (
      sameAccount &&
      previous.enabled === enabled &&
      previous.open === visible &&
      previous.inSession === inSession
    )
      return;
    previousUsage.current = { owner, generation, enabled, open: visible, inSession };
    captureProductEvent('focus_verification_state_observed', {
      analytics_schema_version: 1,
      measurement_mode: 'automatic',
      focus_location: 'fishing_island',
      focus_phase: inSession ? 'focusing' : 'before_focus',
      measurement_state: enabled ? 'on' : 'off',
      preview_state: visible ? 'open' : 'closed',
      measurement_changed: sameAccount && previous.enabled !== enabled ? 1 : 0,
      preview_changed: sameAccount && previous.open !== visible ? 1 : 0,
      observation_reason:
        !sameAccount || previous.inSession !== inSession ? 'screen_opened' : 'state_changed',
    });
  }, [owner, generation, checked, enabled, open, inSession]);

  const consumeIntro = () => {
    if (!owner || getSession()?.userId !== owner || sessionGeneration() !== generation) return;
    setEducation({ owner, generation, seen: true });
    void saveAccountGuides(owner, { verificationIntroSeen: true }).catch(() => {});
  };
  const showPreview = () => {
    if (open) setOpen(false);
    else if (enabled) setOpen(true);
    else {
      previewRequest.current = revision + 1;
      setRevision((value) => value + 1);
    }
  };
  const busy = !checked || (!seen && !intro) || (seen && requesting);
  const ui = componentTokens.verificationSetup;
  return (
    <>
      <View
        ref={controlsRef}
        collapsable={false}
        style={{ alignItems: 'center', minHeight: semanticTokens.size.tapMin }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('verification.button')}
          accessibilityHint={t('verification.setup.openHint')}
          accessibilityState={{ expanded: open && enabled, disabled: busy, busy }}
          disabled={busy}
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
      {introOpen && <VerificationIntro anchor={anchor} onClose={consumeIntro} />}
    </>
  );
}
