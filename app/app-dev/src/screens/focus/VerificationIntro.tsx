import { Modal, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { NavBtn, Overlay } from '@/design-system/patterns';
import { Text } from '@/design-system/typography';
import { useScreenInsets } from '@/design-system/primitives';
import {
  componentTokens as c,
  primitiveTokens as p,
  semanticTokens as s,
} from '@/design-system/tokens';
import { useGowun } from '@/screens/island/sceneKit';
import { t } from '@/i18n';

export type VerificationControlAnchor = { x: number; y: number; width: number; height: number };

/** 안내를 보는 것만으로 촬영하거나 카메라 권한을 요청하지 않는다. */
export function VerificationIntro({
  onClose,
  anchor,
}: {
  onClose: () => void;
  anchor?: VerificationControlAnchor;
}) {
  const insets = useScreenInsets();
  const font = { fontFamily: useGowun() };
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Overlay
        close={onClose}
        maxWidth={ui.maxWidth}
        contentStyle={{ gap: 0, padding: s.spacing.section }}
        frameStyle={{
          transform: [{ translateY: (insets.bottom - insets.top) / 2 }],
          borderRadius: s.radius.modal,
          boxShadow: c.modal.shadow,
        }}
      >
        <View accessibilityViewIsModal testID="verification-intro">
          <NavBtn close label={t('common.close')} onPress={onClose} style={styles.close} />
          <Text accessibilityRole="header" style={[styles.title, font]}>
            {t('verification.intro.title')}
          </Text>
          <View style={styles.controls}>
            <View style={styles.control}>
              <Svg
                width={c.verificationSetup.buttonSize}
                height={c.verificationSetup.buttonSize}
                viewBox="0 0 46 44"
                fill="none"
                accessible={false}
              >
                <Rect
                  x="1"
                  y="8"
                  width="44"
                  height="28"
                  rx="14"
                  fill={p.color.pink}
                  stroke={p.color.brown}
                />
                <Circle cx="32" cy="22" r="10" fill={p.color.paper} />
              </Svg>
              <Text style={[styles.controlTitle, font]}>{t('verification.switchLabel')}</Text>
              <Text style={[styles.controlHint, font]}>
                {t('verification.intro.measurementHint')}
              </Text>
            </View>
            <View style={styles.control}>
              <Svg
                width={c.verificationSetup.buttonSize}
                height={c.verificationSetup.buttonSize}
                viewBox="-10 -10 44 44"
                fill="none"
                accessible={false}
              >
                <Path
                  d="M4 8h3l2-3h6l2 3h3v11H4z"
                  stroke={p.color.ink}
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <Circle cx="12" cy="13" r="3.5" stroke={p.color.ink} strokeWidth="2" />
              </Svg>
              <Text style={[styles.controlTitle, font]}>
                {t('verification.intro.previewLabel')}
              </Text>
              <Text style={[styles.controlHint, font]}>{t('verification.intro.previewHint')}</Text>
            </View>
          </View>
          <Text style={[styles.body, font]}>{t('verification.intro.preview')}</Text>
          <Text style={[styles.precheck, font]}>{t('verification.intro.precheckHint')}</Text>
          <View style={styles.privacy}>
            <Svg
              width={p.space[4]}
              height={p.space[6]}
              viewBox="0 0 20 24"
              fill="none"
              accessible={false}
            >
              <Path d="M5 10V7a5 5 0 0 1 10 0v3" stroke={p.color.ink} strokeWidth="1.6" />
              <Rect
                x="2"
                y="10"
                width="16"
                height="12"
                rx="4"
                stroke={p.color.ink}
                strokeWidth="1.6"
              />
              <Circle cx="10" cy="15" r="1.5" fill={p.color.ink} />
              <Path d="M10 16v2" stroke={p.color.ink} strokeWidth="1.6" />
            </Svg>
            <Text style={[styles.privacyText, font]} numberOfLines={1} adjustsFontSizeToFit>
              {t('verification.intro.privacy')}
            </Text>
          </View>
        </View>
      </Overlay>
      <View
        pointerEvents="none"
        accessible={false}
        style={[
          styles.spotlight,
          anchor
            ? { left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height }
            : { top: insets.top + s.spacing.control, right: insets.right + s.spacing.page },
        ]}
      >
        <Svg
          width={c.verificationSetup.buttonSize}
          height={c.verificationSetup.buttonSize}
          viewBox="0 0 46 44"
          fill="none"
        >
          <Rect
            x="1"
            y="8"
            width="44"
            height="28"
            rx="14"
            fill={p.color.pink}
            stroke={p.color.brown}
          />
          <Circle cx="32" cy="22" r="10" fill={p.color.paper} />
        </Svg>
        <Svg
          width={c.verificationSetup.buttonSize}
          height={c.verificationSetup.buttonSize}
          viewBox="-10 -10 44 44"
          fill="none"
        >
          <Path
            d="M4 8h3l2-3h6l2 3h3v11H4z"
            stroke={p.color.ink}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <Circle cx="12" cy="13" r="3.5" stroke={p.color.ink} strokeWidth="2" />
        </Svg>
      </View>
      <Svg
        pointerEvents="none"
        accessible={false}
        width={ui.arrowWidth}
        height={ui.arrowHeight}
        viewBox="0 0 42 54"
        style={{
          position: 'absolute',
          ...(anchor
            ? {
                left: anchor.x + anchor.width / 2 - ui.arrowWidth / 2,
                top: anchor.y + anchor.height + s.spacing.page,
              }
            : {
                right: insets.right + s.spacing.page + p.space[4],
                top:
                  insets.top + s.spacing.control + c.verificationSetup.buttonSize + s.spacing.page,
              }),
        }}
      >
        <Path
          d="M26 3C28 25 10 22 10 47"
          stroke={p.color.paper}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="3 5"
          fill="none"
        />
        <Path
          d="m5 41 5 7 5-7"
          stroke={p.color.paper}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </Modal>
  );
}
const ui = c.verificationIntro;
const styles = StyleSheet.create({
  close: { alignSelf: 'flex-end', marginTop: -s.spacing.control, marginRight: -s.spacing.control },
  controls: { flexDirection: 'row', gap: s.spacing.component, marginTop: s.spacing.component },
  control: { flex: 1, alignItems: 'center', gap: p.space[1] },
  controlTitle: {
    fontSize: s.typography.label,
    color: s.color.text,
    fontWeight: s.typography.bold,
    textAlign: 'center',
  },
  controlHint: { fontSize: s.typography.label, color: s.color.textMuted, textAlign: 'center' },
  title: {
    fontSize: s.typography.heading,
    lineHeight: ui.titleLineHeight,
    fontWeight: s.typography.bold,
    textAlign: 'center',
    color: s.color.text,
  },
  body: {
    marginTop: s.spacing.component,
    fontSize: s.typography.body,
    lineHeight: ui.bodyLineHeight,
    textAlign: 'center',
    color: s.color.text,
  },
  precheck: {
    marginTop: s.spacing.control,
    fontSize: s.typography.label,
    lineHeight: ui.privacyLineHeight,
    textAlign: 'center',
    color: s.color.text,
  },
  privacy: {
    flexDirection: 'row',
    gap: p.space[2],
    borderTopWidth: s.stroke.subtle,
    borderTopColor: s.color.divider,
    paddingTop: s.spacing.component,
    marginTop: s.spacing.page,
  },
  privacyText: {
    flex: 1,
    fontSize: s.typography.label,
    lineHeight: ui.privacyLineHeight,
    color: s.color.textMuted,
  },
  spotlight: {
    position: 'absolute',
    width: c.verificationSetup.buttonSize * 2 + s.spacing.control,
    height: c.verificationSetup.buttonSize,
    flexDirection: 'row',
    gap: s.spacing.control,
    borderRadius: s.radius.full,
    backgroundColor: p.color.paper,
    borderWidth: s.stroke.strong,
    borderColor: s.color.outline,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0px 0px 0px ${p.space[2]}px ${p.color.paper}`,
  },
});
