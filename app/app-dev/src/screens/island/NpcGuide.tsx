import React, { useState } from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { assets } from '@/constants/assets';
import { Btn, C, Pic, Txt } from '@/design-system/patterns';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { useAppLayout } from '@/utils/layout';

const space = primitiveTokens.space;

// 온보딩 앵무새와 건물 안내가 공유하는 하단 대화창.
export function GuideBox({
  text,
  character = 'parrot',
  style,
  children,
}: {
  text: string;
  character?: 'parrot' | 'pelican';
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.box, style]}>
      <View style={styles.dialogue}>
        {character === 'pelican' ? (
          <Image
            source={assets['characters/pelican/npc/idle.png']}
            accessible={false}
            resizeMode="contain"
            style={styles.pelican}
          />
        ) : (
          <Pic id="parrot" w={56} />
        )}
        <Txt
          lineBreakStrategyIOS="hangul-word"
          style={styles.text}
          accessibilityLiveRegion="polite"
        >
          {text}
        </Txt>
      </View>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

const lines = [
  '우체통이 생겼네!\n난 친구들의 편지를 배달하는 펠리컨이야.',
  '여기서 섬 친구들과 이야기하고, 친구에게 편지도 보낼 수 있어.',
  '친구에게 편지가 오면 내가 우체통 위에 앉아 있을게.\n그때 우체통을 눌러 봐!',
];

export function MailboxGuide({ onDone }: { onDone: (openMailbox: boolean) => void }) {
  const [step, setStep] = useState(0);
  const layout = useAppLayout();
  const last = step === lines.length - 1;
  return (
    <Modal transparent animationType="none" onRequestClose={() => onDone(false)}>
      <View
        accessibilityViewIsModal
        style={[
          styles.overlay,
          {
            paddingTop: layout.insets.top + space[3],
            paddingBottom: layout.insets.bottom + space[3],
            paddingLeft: layout.insets.left + space[5],
            paddingRight: layout.insets.right + space[5],
          },
        ]}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          bounces={false}
        >
          <GuideBox character="pelican" text={lines[step]} style={styles.mailboxBox}>
            <Btn title="건너뛰기" kind="ghost" onPress={() => onDone(false)} />
            <Btn
              title={last ? '우체통 열기' : '다음'}
              dialog
              style={styles.next}
              onPress={() => (last ? onDone(true) : setStep((current) => current + 1))}
            />
          </GuideBox>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    borderRadius: semanticTokens.radius.card,
    borderWidth: semanticTokens.stroke.strong,
    borderColor: C.brown,
    backgroundColor: C.paper,
    paddingVertical: space[4],
    paddingHorizontal: space[4],
    gap: space[3],
    boxShadow: `0px ${space[1]}px 0px ${C.brown}`,
  },
  dialogue: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  pelican: { width: space[16], height: space[16] + space[4] },
  text: {
    flex: 1,
    fontSize: primitiveTokens.fontSize.md,
    lineHeight: space[6],
    fontWeight: primitiveTokens.fontWeight.bold,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space[4],
  },
  overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  scroll: { flexGrow: 0, flexShrink: 1, width: '100%', maxWidth: 414 },
  scrollContent: { paddingBottom: space[1] },
  mailboxBox: { position: 'relative' },
  next: { minWidth: 120, minHeight: componentTokens.button.heightGhost },
});
