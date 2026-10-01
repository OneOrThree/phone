import { BlurTargetView, BlurView } from 'expo-blur';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  Keyboard,
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
  accessibilityViewIsModal,
}: {
  text: string;
  character?: 'mongdol' | 'pelican' | 'dog';
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  accessibilityViewIsModal?: boolean;
}) {
  return (
    <View style={[styles.box, style]} accessibilityViewIsModal={accessibilityViewIsModal}>
      <View style={styles.dialogue}>
        {character === 'pelican' ? (
          <Image
            source={assets['characters/pelican/npc/idle.png']}
            accessible={false}
            resizeMode="contain"
            style={styles.pelican}
          />
        ) : character === 'dog' ? (
          <Image
            source={assets['characters/dog/npc/idle.png']}
            accessible={false}
            resizeMode="contain"
            style={styles.dog}
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
const TutorialSkipContext = createContext<(() => void) | undefined>(undefined);

export function useScreenReaderEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.resolve(AccessibilityInfo.isScreenReaderEnabled())
      .then((value) => {
        if (live) setEnabled(!!value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}

// Android는 블러가 읽을 실제 장면을 지정해야 한다. 오버레이는 장면의 형제로 둔다.
export function TutorialScene({
  children,
  overlay,
  onSkip,
  isolateAccessibility = false,
  ...props
}: ViewProps & { overlay?: React.ReactNode; onSkip?: () => void; isolateAccessibility?: boolean }) {
  const target = useRef<View>(null);
  const isolated =
    isolateAccessibility || (React.isValidElement(overlay) && overlay.type === TutorialSpotlight);
  return (
    <View {...props}>
      <BlurTargetView
        ref={target}
        style={{ flex: 1 }}
        accessibilityElementsHidden={isolated}
        importantForAccessibility={isolated ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </BlurTargetView>
      <BlurTargetContext.Provider value={target}>
        <TutorialSkipContext.Provider value={onSkip}>{overlay}</TutorialSkipContext.Provider>
      </BlurTargetContext.Provider>
    </View>
  );
}

export function useSpotlightTarget(active = false) {
  const ref = useRef<View>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const measure = useCallback(() => {
    requestAnimationFrame(() => {
      if (!activeRef.current) return;
      const node = ref.current;
      if (!node) {
        setRect(null);
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        if (!activeRef.current || ref.current !== node) return;
        if (width <= 0 || height <= 0) {
          setRect(null);
          return;
        }
        setRect((previous) =>
          previous?.x === x &&
          previous.y === y &&
          previous.width === width &&
          previous.height === height
            ? previous
            : { x, y, width, height },
        );
      });
    });
  }, []);
  useEffect(() => {
    if (!active) {
      setRect(null);
      return;
    }
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
  action,
  accessibleInput,
  error,
}: {
  target?: SpotlightRect | null;
  text: string;
  children?: React.ReactNode;
  action?: { title: string; onPress: () => void; disabled?: boolean };
  accessibleInput?: React.ReactNode;
  /** 조작 실패 메시지 — 블러·딤 뒤로 가려지지 않게 대화창 안에서 읽어 준다. */
  error?: string;
}) {
  const layout = useAppLayout();
  const blurTarget = useContext(BlurTargetContext);
  const skip = useContext(TutorialSkipContext);
  const screenReader = useScreenReaderEnabled();
  const [measurementFailed, setMeasurementFailed] = useState(false);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) =>
      setKeyboardTop(event.endCoordinates.screenY),
    );
    const change = Keyboard.addListener('keyboardWillChangeFrame', (event) =>
      setKeyboardTop(event.endCoordinates.screenY),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null));
    return () => {
      show.remove();
      change.remove();
      hide.remove();
    };
  }, []);
  const needsTarget = !!action || !!accessibleInput;
  useEffect(() => {
    setMeasurementFailed(false);
    if (target || !needsTarget) return;
    const timer = setTimeout(() => setMeasurementFailed(true), 2000);
    return () => clearTimeout(timer);
  }, [target, needsTarget, text]);
  const root = useRef<View>(null);
  const [area, setArea] = useState({ x: 0, y: 0, width: layout.width, height: layout.height });
  const measureRoot = () =>
    root.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) setArea({ x, y, width, height });
    });
  // 구멍의 여백으로 옆 버튼까지 눌리지 않도록 실제 대상 rect만 연다.
  const pad = 0;
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
  const safeTop = layout.insets.top + space[3];
  const visibleBottom =
    Math.min(
      area.height - layout.insets.bottom,
      keyboardTop == null ? area.height : keyboardTop - area.y,
    ) - space[3];
  const above = target && y > (visibleBottom + safeTop) / 2;
  const guideTop = target && !above ? Math.min(bottom + space[4], visibleBottom) : safeTop;
  const guideBottom = above ? Math.min(y - space[4], visibleBottom) : visibleBottom;
  const guidePosition = {
    ...(above || !target ? { bottom: area.height - guideBottom } : { top: guideTop }),
    maxHeight: Math.max(space[12], guideBottom - guideTop),
  };
  return (
    <View
      ref={root}
      testID="tutorial-spotlight"
      collapsable={false}
      onLayout={measureRoot}
      pointerEvents="box-none"
      accessibilityViewIsModal
      onAccessibilityEscape={skip}
      style={[StyleSheet.absoluteFill, styles.spotlight]}
    >
      {panes.map((pane, index) => (
        <BlurView
          key={index}
          intensity={35}
          tint="dark"
          blurMethod="dimezisBlurView"
          blurTarget={blurTarget}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onStartShouldSetResponder={() => true}
          style={[styles.blurPane, pane]}
        >
          <View style={styles.dim} />
        </BlurView>
      ))}
      <ScrollView
        testID="tutorial-dialogue"
        keyboardShouldPersistTaps="handled"
        style={{
          position: 'absolute',
          left: (area.width - width) / 2,
          width,
          ...guidePosition,
        }}
      >
        <GuideBox text={text} style={{ position: 'relative' }}>
          {!!error && (
            <Txt
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={{ color: semanticTokens.color.danger, fontWeight: '700' }}
            >
              {error}
            </Txt>
          )}
          {(screenReader || measurementFailed) && accessibleInput}
          {(screenReader || measurementFailed) && action && (
            <Btn title={action.title} onPress={action.onPress} disabled={action.disabled} />
          )}
          {children ?? null}
          {skip && <Btn title="안내 그만 보기" kind="ghost" onPress={skip} />}
        </GuideBox>
      </ScrollView>
    </View>
  );
}

const lines = [
  '우체통이 생겼네!\n난 친구들의 편지를 배달하는 펠리컨이야.',
  '여기서 섬 친구들과 이야기하고, 친구에게 편지도 보낼 수 있어.',
  '친구에게 편지가 오면 내가 우체통 위에 앉아 있을게.\n그때 우체통을 눌러 봐!',
];

export function MailboxGuide({
  onDone,
  blocked = false,
}: {
  onDone: (openMailbox: boolean) => void;
  blocked?: boolean;
}) {
  const [step, setStep] = useState(0);
  const layout = useAppLayout();
  const last = step === lines.length - 1;
  return (
    <Modal transparent animationType="none" onRequestClose={() => !blocked && onDone(false)}>
      <View
        testID="mailbox-guide-overlay"
        pointerEvents={blocked ? 'none' : 'auto'}
        accessibilityElementsHidden={blocked}
        importantForAccessibility={blocked ? 'no-hide-descendants' : 'auto'}
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

const shopLines = [
  '드디어 마지막 건물까지 완성됐네!\n멀리서 이 섬이 자라는 걸 계속 보고 있었어.',
  '상점이 열릴 날만 기다리면서\n옷이랑 섬 꾸미기를 한가득 모아 왔지.',
  '다 같이 모은 물고기로 마음에 드는 걸 골라 봐.\n이제 이 섬을 너희답게 꾸밀 차례야!',
];

export function ShopGuide({
  onDone,
  onCancel,
  blocked = false,
}: {
  onDone: () => void;
  onCancel: () => void;
  blocked?: boolean;
}) {
  const [step, setStep] = useState(0);
  const layout = useAppLayout();
  const last = step === shopLines.length - 1;
  return (
    <Modal
      transparent
      animationType="none"
      testID="shop-guide"
      onRequestClose={() => !blocked && onCancel()}
    >
      <View
        testID="shop-guide-overlay"
        pointerEvents={blocked ? 'none' : 'auto'}
        accessibilityElementsHidden={blocked}
        importantForAccessibility={blocked ? 'no-hide-descendants' : 'auto'}
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
          <GuideBox character="dog" text={shopLines[step]} style={styles.shopBox}>
            <Btn title="건너뛰기" kind="ghost" onPress={onDone} />
            <Btn
              title={last ? '상점 둘러보기' : '다음'}
              dialog
              style={styles.next}
              onPress={() => (last ? onDone() : setStep((current) => current + 1))}
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
  dog: { width: space[16] + space[4], height: space[16] + space[4] },
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
  shopBox: { position: 'relative' },
  next: { minWidth: 120, minHeight: componentTokens.button.heightGhost },
  spotlight: { zIndex: 100 },
  blurPane: { position: 'absolute', overflow: 'hidden' },
  dim: { flex: 1, backgroundColor: semanticTokens.color.overlay },
});
