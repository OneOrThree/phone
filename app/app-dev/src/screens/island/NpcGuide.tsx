import { BlurTargetView, BlurView } from 'expo-blur';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
  type LayoutRectangle,
  type ViewProps,
} from 'react-native';
import { assets } from '@/constants/assets';
import { Btn, C, Txt } from '@/design-system/patterns';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { useAppLayout } from '@/utils/layout';

const space = primitiveTokens.space;

// 몽돌 온보딩과 건물 안내가 공유하는 하단 대화창.
export function GuideBox({
  text,
  character = 'mongdol',
  style,
  children,
}: {
  text: string;
  character?: 'mongdol' | 'pelican';
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
          <Image
            source={assets['characters/mongdol/npc/idle.png']}
            accessible={false}
            resizeMode="contain"
            style={styles.mongdol}
          />
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

export type SpotlightRect = LayoutRectangle;

const BlurTargetContext = createContext<React.RefObject<View | null> | undefined>(undefined);

// Android는 블러가 읽을 실제 장면을 지정해야 한다. 오버레이는 장면의 형제로 둔다.
export function TutorialScene({
  children,
  overlay,
  ...props
}: ViewProps & { overlay?: React.ReactNode }) {
  const target = useRef<View>(null);
  return (
    <View {...props}>
      <BlurTargetView ref={target} style={{ flex: 1 }}>
        {children}
      </BlurTargetView>
      <BlurTargetContext.Provider value={target}>{overlay}</BlurTargetContext.Provider>
    </View>
  );
}

export function useSpotlightTarget(active = false) {
  const ref = useRef<View>(null);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const measure = useCallback(() => {
    requestAnimationFrame(() =>
      ref.current?.measureInWindow((x, y, width, height) => {
        if (width <= 0 || height <= 0) return;
        setRect((previous) =>
          previous?.x === x &&
          previous.y === y &&
          previous.width === width &&
          previous.height === height
            ? previous
            : { x, y, width, height },
        );
      }),
    );
  }, []);
  useEffect(() => {
    if (!active) return;
    measure();
    // 키보드·화면 회전·부모 이동으로 바뀐 창 좌표도 따라간다.
    const timer = setInterval(measure, 200);
    return () => clearInterval(timer);
  }, [active, measure]);
  return { ref, rect, measure };
}

/** 실제 조작 대상을 비워 두고 나머지 화면만 블러·딤 처리한다. */
export function TutorialSpotlight({
  target,
  text,
  children,
}: {
  target?: SpotlightRect | null;
  text: string;
  children?: React.ReactNode;
}) {
  const layout = useAppLayout();
  const blurTarget = useContext(BlurTargetContext);
  const root = useRef<View>(null);
  const [area, setArea] = useState({ x: 0, y: 0, width: layout.width, height: layout.height });
  const measureRoot = () =>
    root.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) setArea({ x, y, width, height });
    });
  const pad = 7;
  const x = Math.min(area.width, Math.max(0, (target?.x ?? 0) - area.x - pad));
  const y = Math.min(area.height, Math.max(0, (target?.y ?? 0) - area.y - pad));
  const right = Math.max(
    x,
    Math.min(area.width, (target?.x ?? 0) - area.x + (target?.width ?? 0) + pad),
  );
  const bottom = Math.max(
    y,
    Math.min(area.height, (target?.y ?? 0) - area.y + (target?.height ?? 0) + pad),
  );
  const panes = target
    ? [
        { left: 0, top: 0, right: 0, height: y },
        { left: 0, top: y, width: x, height: Math.max(0, bottom - y) },
        { left: right, right: 0, top: y, height: Math.max(0, bottom - y) },
        { left: 0, right: 0, top: bottom, bottom: 0 },
      ]
    : [{ left: 0, top: 0, right: 0, bottom: 0 }];
  const width = Math.min(layout.floatingWidth, 414, area.width - 24);
  const guidePosition = target
    ? y > area.height / 2
      ? { bottom: Math.max(layout.insets.bottom + space[4], area.height - y + space[4]) }
      : { top: bottom + space[4] }
    : { bottom: layout.insets.bottom + space[4] };
  return (
    <View
      ref={root}
      collapsable={false}
      onLayout={measureRoot}
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, styles.spotlight]}
    >
      {panes.map((pane, index) => (
        <BlurView
          key={index}
          intensity={35}
          tint="dark"
          blurMethod="dimezisBlurView"
          blurTarget={blurTarget}
          onStartShouldSetResponder={() => true}
          style={[styles.blurPane, pane]}
        >
          <View style={styles.dim} />
        </BlurView>
      ))}
      <GuideBox
        text={text}
        style={{
          left: (area.width - width) / 2,
          width,
          ...guidePosition,
        }}
      >
        {children ?? null}
      </GuideBox>
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
  mongdol: { width: space[16], height: space[16] },
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
  spotlight: { zIndex: 100 },
  blurPane: { position: 'absolute', overflow: 'hidden' },
  dim: { flex: 1, backgroundColor: '#211A174F' },
});
