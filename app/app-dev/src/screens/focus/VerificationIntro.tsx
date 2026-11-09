import { Image, Modal, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Btn, NavBtn, Overlay } from '@/design-system/patterns';
import { Text } from '@/design-system/typography';
import { useScreenInsets } from '@/design-system/primitives';
import {
  componentTokens as c,
  primitiveTokens as p,
  semanticTokens as s,
} from '@/design-system/tokens';
import { useGowun } from '@/screens/island/sceneKit';
import { t } from '@/i18n';

/** 안내를 보는 것만으로 촬영하거나 카메라 권한을 요청하지 않는다. */
export function VerificationIntro({
  onClose,
  onNext,
}: {
  onClose: () => void;
  onNext?: () => void;
}) {
  const insets = useScreenInsets();
  const { width, fontScale } = useWindowDimensions();
  const compact = width < ui.compactWidth;
  const largeText = fontScale >= s.typography.largeTextThreshold;
  const font = { fontFamily: useGowun() };
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Overlay
        close={onClose}
        maxWidth={ui.maxWidth}
        contentStyle={{ gap: 0, padding: s.spacing.page }}
        frameStyle={{
          transform: [{ translateY: (insets.bottom - insets.top) / 2 }],
          borderRadius: s.radius.modal,
          boxShadow: c.modal.shadow,
        }}
      >
        <View accessibilityViewIsModal testID="verification-intro">
          <View style={styles.header}>
            <Svg
              width={p.space[6]}
              height={p.space[6]}
              viewBox="0 0 24 24"
              fill="none"
              accessible={false}
            >
              <Path d="M7 10V7a5 5 0 0 1 10 0v3" stroke={p.color.ink} strokeWidth="1.6" />
              <Rect
                x="4"
                y="10"
                width="16"
                height="12"
                rx="4"
                stroke={p.color.ink}
                strokeWidth="1.6"
              />
              <Circle cx="12" cy="15" r="1.5" fill={p.color.ink} />
              <Path d="M12 16v2" stroke={p.color.ink} strokeWidth="1.6" />
            </Svg>
            <NavBtn close label={t('common.close')} onPress={onClose} />
          </View>
          <View
            accessible
            accessibilityRole="header"
            accessibilityLabel={t('verification.intro.title')}
          >
            {t('verification.intro.title')
              .split('\n')
              .map((line) => (
                <Text
                  key={line}
                  numberOfLines={largeText ? undefined : 1}
                  adjustsFontSizeToFit={!largeText}
                  style={[
                    styles.title,
                    font,
                    { fontSize: compact ? ui.compactTitleSize : ui.titleSize },
                  ]}
                >
                  {line}
                </Text>
              ))}
          </View>
          <View style={styles.art}>
            <Image
              source={require('../../assets/verification/study-hands-book-laptop.png')}
              accessibilityLabel={t('verification.intro.studyToolsImage')}
              accessible
              resizeMode="contain"
              style={{ width: '100%', height: '100%' }}
            />
          </View>
          <Text style={[styles.emphasis, font]}>{t('verification.intro.studyTools')}</Text>
          <Text style={[styles.body, font]}>{t('verification.intro.studyToolsHint')}</Text>
          <View style={styles.preview}>
            <Svg
              width={p.space[6]}
              height={p.space[6]}
              viewBox="0 0 24 24"
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
            <View style={{ flex: 1, gap: s.spacing.control }}>
              <Text
                style={[styles.previewTitle, font, compact && { fontSize: s.typography.label }]}
              >
                {t('verification.intro.previewHint')}
              </Text>
              <Text style={[styles.previewBody, font]}>{t('verification.intro.preview')}</Text>
            </View>
          </View>
          <View style={compact && { marginHorizontal: -s.spacing.component }}>
            <Text
              style={[styles.privacy, font]}
              numberOfLines={largeText ? undefined : 1}
              adjustsFontSizeToFit={!largeText}
            >
              {t('verification.intro.privacy')}
            </Text>
          </View>
          {onNext && (
            <View style={{ alignItems: 'flex-end', marginTop: s.spacing.component }}>
              <Btn
                title=">"
                accessibilityLabel={t('focusBlocking.next')}
                style={{ width: c.button.height }}
                onPress={onNext}
              />
            </View>
          )}
        </View>
      </Overlay>
    </Modal>
  );
}
const ui = c.verificationIntro;
const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -s.spacing.control,
  },
  title: { lineHeight: ui.titleLineHeight, fontWeight: s.typography.bold, color: s.color.text },
  art: { width: '100%', aspectRatio: ui.artAspectRatio, marginVertical: s.spacing.component },
  emphasis: {
    fontSize: s.typography.body,
    fontWeight: s.typography.bold,
    color: s.color.text,
    textAlign: 'center',
  },
  body: {
    fontSize: s.typography.body,
    lineHeight: ui.bodyLineHeight,
    color: s.color.text,
    textAlign: 'center',
  },
  preview: {
    flexDirection: 'row',
    gap: s.spacing.control,
    marginTop: s.spacing.section,
    alignItems: 'flex-start',
  },
  previewTitle: { fontSize: s.typography.body, fontWeight: s.typography.bold, color: s.color.text },
  previewBody: { fontSize: s.typography.label, color: s.color.text },
  privacy: {
    marginTop: s.spacing.section,
    paddingTop: s.spacing.component,
    borderTopWidth: s.stroke.subtle,
    borderTopColor: s.color.divider,
    fontSize: ui.privacySize,
    color: s.color.textMuted,
    textAlign: 'center',
  },
});
