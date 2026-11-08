import { Platform, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Btn, Txt } from '@/design-system/patterns';
import {
  componentTokens as c,
  primitiveTokens as p,
  semanticTokens as s,
} from '@/design-system/tokens';
import { t } from '@/i18n';
import { useGowun } from '@/screens/island/sceneKit';
import { FocusBlockingIllustration } from '@/screens/permissions/FocusBlockingIntro';
import { useAppLayout } from '@/utils/layout';
import { screenTimeNative } from '@/services/ScreenTimeModule';

export const supportsFocusSetup = () =>
  Platform.OS === 'ios' || (Platform.OS === 'android' && !!screenTimeNative?.getAndroidFocusAccess);

export function FocusBlockingIcon({ size = c.verificationSetup.iconSize }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      <Path
        d="M12 3 4 6v6c0 4 4 7 8 9 4-2 8-5 8-9V6zM9 12l2 2 4-4"
        stroke={s.color.text}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function FocusBlockingGuide({
  busy,
  error,
  onSetup,
  supportsBlocking = supportsFocusSetup(),
}: {
  busy: boolean;
  error?: string;
  onSetup: () => void;
  supportsBlocking?: boolean;
}) {
  const font = { fontFamily: useGowun() };
  const supported = supportsBlocking;
  const layout = useAppLayout();
  const artworkSize = Math.min(p.space[16] * 3, layout.height * 0.23);
  const steps = supported ? (['measurement', 'allowed'] as const) : (['measurement'] as const);
  return (
    <View style={styles.content} testID="focus-blocking-guide">
      <Txt accessibilityRole="header" style={[styles.title, font]}>
        {t(supported ? 'screenTimeSetup.title' : 'screenTimeSetup.androidTitle')}
      </Txt>
      <Txt style={[styles.subtitle, font]}>
        {t(
          supported && Platform.OS === 'ios'
            ? 'screenTimeSetup.subtitle'
            : supported
              ? 'screenTimeSetup.androidSetupSubtitle'
              : 'screenTimeSetup.androidSubtitle',
        )}
      </Txt>
      <FocusBlockingIllustration size={artworkSize} stageHeight={artworkSize} />
      <View style={styles.steps}>
        {steps.map((step, index) => (
          <View key={step} style={[styles.step, index === steps.length - 1 && styles.lastStep]}>
            <View style={[styles.number, index === 1 && styles.allowedNumber]}>
              <Txt style={[styles.numberText, font]}>{index + 1}</Txt>
            </View>
            <View style={styles.stepCopy}>
              <Txt style={[styles.stepTitle, font]}>{t(`screenTimeSetup.${step}Title`)}</Txt>
              <Txt style={[styles.body, font]}>
                {t(
                  step === 'allowed' && Platform.OS === 'android'
                    ? 'screenTimeSetup.androidAllowedBody'
                    : `screenTimeSetup.${step}Body`,
                )}
              </Txt>
            </View>
          </View>
        ))}
      </View>
      {!supported && <Txt style={[styles.body, font]}>{t('screenTimeSetup.androidBlocking')}</Txt>}
      {error && (
        <Txt accessibilityRole="alert" style={[styles.error, font]}>
          {error}
        </Txt>
      )}
      <Btn
        title={t(busy ? 'settings.permissions.gate.requesting' : 'screenTimeSetup.setup')}
        disabled={busy}
        onPress={onSetup}
        font={font.fontFamily}
        style={styles.setupAction}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  content: { gap: s.spacing.component },
  title: {
    fontSize: s.typography.title,
    lineHeight: p.space[8],
    color: s.color.text,
    paddingRight: s.size.tapMin,
    fontWeight: s.typography.bold,
  },
  subtitle: { fontSize: s.typography.label, color: s.color.textMuted, lineHeight: p.space[5] },
  steps: { gap: p.space[3] },
  step: {
    flexDirection: 'row',
    gap: p.space[3],
    paddingBottom: p.space[3],
    borderBottomWidth: s.stroke.subtle,
    borderBottomColor: s.color.divider,
  },
  lastStep: { borderBottomWidth: 0, paddingBottom: 0 },
  number: {
    width: p.space[8],
    height: p.space[8],
    borderRadius: s.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: s.color.secondary,
  },
  allowedNumber: { backgroundColor: s.color.accent },
  numberText: { fontSize: s.typography.body, fontWeight: s.typography.bold },
  stepCopy: { flex: 1, gap: p.space[1] },
  stepTitle: { fontSize: s.typography.body, fontWeight: s.typography.bold, lineHeight: p.space[6] },
  body: { fontSize: s.typography.label, lineHeight: p.space[6], color: s.color.textMuted },
  setupAction: { marginTop: p.space[2] },
  error: { fontSize: s.typography.label, color: s.color.danger },
});
