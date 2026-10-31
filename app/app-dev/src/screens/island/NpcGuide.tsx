import { BlurTargetView, BlurView } from 'expo-blur';
import Svg, { Path } from 'react-native-svg';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
  type LayoutRectangle,
  type ViewProps,
} from 'react-native';
import { buildingNames, type Building } from '@/services/model';
import { assets } from '@/constants/assets';
import { t } from '@/i18n';
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
  onSkip,
  skipTitle = t('onboarding.spotlightSkip'),
}: {
  text: string;
  character?: 'mongdol' | 'pelican' | 'dog' | null;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  accessibilityViewIsModal?: boolean;
  /** 안내를 끝내는 링크 — 단계마다 다른 버튼이 있어도 항상 왼쪽 같은 자리에 둔다. */
  onSkip?: () => void;
  skipTitle?: string;
}) {
  return (
    <View style={[styles.box, style]} accessibilityViewIsModal={accessibilityViewIsModal}>
      <View style={styles.dialogue}>
        {character === null ? null : character === 'pelican' ? (
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
        <Txt style={styles.text} accessibilityLiveRegion="polite">
          {text}
        </Txt>
      </View>
      <View style={styles.actions}>
        {onSkip && (
          <Pressable
            testID="guide-skip"
            accessibilityRole="button"
            accessibilityLabel={skipTitle}
            onPress={onSkip}
            hitSlop={8}
            style={styles.skip}
          >
            <Txt style={styles.skipText}>{skipTitle}</Txt>
          </Pressable>
        )}
        {children}
      </View>
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
  radius,
}: {
  target?: SpotlightRect | null;
  text: string;
  children?: React.ReactNode;
  action?: { title: string; onPress: () => void; disabled?: boolean };
  accessibleInput?: React.ReactNode;
  /** 조작 실패 메시지 — 블러·딤 뒤로 가려지지 않게 대화창 안에서 읽어 준다. */
  error?: string;
  /** 원형·둥근 버튼용 구멍 모서리 반경. 구멍 반(半)너비·반높이로 클램프된다. */
  radius?: number;
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
  // 둥근 버튼이면 구멍 모서리의 "틈"(사각 구멍 − 둥근 버튼)만 딤으로 가려 둥근(원형) 구멍을 만든다.
  // 오목한 틈이라 단일 View·borderRadius로는 못 만든다 → SVG evenodd 마스크(사각 − 둥근사각)로 틈만 채운다.
  const holeW = Math.max(0, right - x);
  const holeH = Math.max(0, bottom - y);
  const holeRadius = radius ? Math.min(radius, holeW / 2, holeH / 2) : 0;
  // 바깥 사각 subpath + 안쪽 둥근사각 subpath → evenodd 로 둘 사이(모서리 틈)만 칠한다
  const holeMaskPath =
    holeRadius > 0
      ? `M0 0 H${holeW} V${holeH} H0 Z ` +
        `M${holeRadius} 0 H${holeW - holeRadius} ` +
        `A${holeRadius} ${holeRadius} 0 0 1 ${holeW} ${holeRadius} ` +
        `V${holeH - holeRadius} ` +
        `A${holeRadius} ${holeRadius} 0 0 1 ${holeW - holeRadius} ${holeH} ` +
        `H${holeRadius} ` +
        `A${holeRadius} ${holeRadius} 0 0 1 0 ${holeH - holeRadius} ` +
        `V${holeRadius} ` +
        `A${holeRadius} ${holeRadius} 0 0 1 ${holeRadius} 0 Z`
      : '';
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
      {target && holeRadius > 0 && (
        <Svg
          testID="spotlight-hole-mask"
          pointerEvents="none"
          style={{ position: 'absolute', left: x, top: y }}
          width={holeW}
          height={holeH}
        >
          <Path d={holeMaskPath} fill={semanticTokens.color.overlay} fillRule="evenodd" />
        </Svg>
      )}
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
        <GuideBox text={text} style={{ position: 'relative' }} onSkip={skip}>
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
        </GuideBox>
      </ScrollView>
    </View>
  );
}

const buildingLines: Record<Building, string[]> = {
  hall: [
    '마을회관에서는 섬 정보와 주민, 공동 통장을 확인할 수 있어.',
    '방장은 여기서 다음에 지을 건물을 고르고 섬을 관리할 수 있어.',
  ],
  board: [
    '게시판에서는 섬 공지와 퀘스트를 확인할 수 있어.',
    '공지에 댓글로 이야기하고, 퀘스트에 함께 참여해 봐!',
  ],
  gram: [
    '축음기에서는 섬에서 함께 들을 음악을 고를 수 있어.',
    '음악을 재생하거나 멈추면 같은 섬의 친구들에게도 함께 반영돼.',
  ],
  library: [
    '도서관에서는 집중 기록과 휴대폰 사용 시간을 돌아볼 수 있어.',
    '달력에서 날짜를 골라 기록을 확인해 봐!',
  ],
  mail: [
    '난 친구들의 편지를 배달하는 펠리컨이야.',
    '여기서 섬 친구들과 이야기하고, 친구에게 편지도 보낼 수 있어.',
    '친구에게 편지가 오면 내가 우체통 위에 앉아 있을게.\n그때 우체통을 눌러 봐!',
  ],
  tower: [
    '전망대에서는 다른 섬을 찾아보고 섬들의 순위를 볼 수 있어.',
    '마음에 드는 섬을 발견하면 구경하러 가 봐!',
  ],
  shop: [
    '강아지 상점에 어서 와!\n옷과 섬 꾸미기를 둘러볼 수 있어.',
    '다 같이 모은 물고기로 마음에 드는 걸 골라 봐.\n이 섬을 너희답게 꾸며 보자!',
  ],
};

function BuildingDialogue({
  building,
  lines,
  onDone,
  onCancel = onDone,
  blocked = false,
  error,
  saving = false,
  testID,
  lastTitle = '확인',
}: {
  building: Building;
  lines: string[];
  onDone: () => void;
  onCancel?: () => void;
  blocked?: boolean;
  error?: string;
  saving?: boolean;
  testID: string;
  lastTitle?: string;
}) {
  const [step, setStep] = useState(0);
  const layout = useAppLayout();
  const last = step === lines.length - 1;
  const disabled = blocked || saving;
  return (
    <Modal
      transparent
      animationType="none"
      testID={testID}
      onRequestClose={() => !disabled && onCancel()}
    >
      <View
        testID={`${testID}-overlay`}
        pointerEvents={disabled ? 'none' : 'auto'}
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
          <GuideBox
            character={building === 'mail' ? 'pelican' : building === 'shop' ? 'dog' : 'mongdol'}
            text={lines[step]}
            style={building === 'shop' ? styles.shopBox : styles.mailboxBox}
            onSkip={disabled ? undefined : onDone}
            skipTitle="안내 그만 보기"
          >
            {error && <Txt accessibilityRole="alert">{error}</Txt>}
            <Btn
              title={saving ? '저장 중' : last ? lastTitle : '다음'}
              disabled={disabled}
              dialog
              style={styles.next}
              onPress={() => {
                if (!disabled) {
                  if (last) onDone();
                  else setStep(step + 1);
                }
              }}
            />
          </GuideBox>
        </ScrollView>
      </View>
    </Modal>
  );
}

export function BuildingGuide(props: {
  building: Building;
  onDone: () => void;
  blocked?: boolean;
  saving?: boolean;
  error?: string;
}) {
  return (
    <BuildingDialogue {...props} lines={buildingLines[props.building]} testID="building-guide" />
  );
}

export function BuildingCompletionGuide(props: {
  building: Building;
  onDone: () => void;
  blocked?: boolean;
  saving?: boolean;
  error?: string;
}) {
  return (
    <BuildingDialogue
      {...props}
      lines={[
        `${buildingNames[props.building]} 공사가 끝났어!\n네가 모아 준 물고기가 힘이 되었어. 고마워!`,
      ]}
      testID="building-completion-guide"
    />
  );
}

export function MailboxGuide({
  onDone,
  blocked,
}: {
  onDone: (open: boolean) => void;
  blocked?: boolean;
}) {
  return (
    <BuildingDialogue
      building="mail"
      lines={buildingLines.mail}
      onDone={() => onDone(true)}
      onCancel={() => onDone(false)}
      blocked={blocked}
      testID="mailbox-guide"
      lastTitle="우체통 열기"
    />
  );
}
export function ShopGuide({
  onDone,
  onCancel,
  blocked,
}: {
  onDone: () => void;
  onCancel: () => void;
  blocked?: boolean;
}) {
  return (
    <BuildingDialogue
      building="shop"
      lines={buildingLines.shop}
      onDone={onDone}
      onCancel={onCancel}
      blocked={blocked}
      testID="shop-guide"
      lastTitle="상점 둘러보기"
    />
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
  // 그만 보기는 왼쪽 끝에 붙고(marginRight auto) 나머지 버튼은 오른쪽으로 밀린다
  skip: { marginRight: 'auto', minHeight: 44, justifyContent: 'center' },
  skipText: {
    fontSize: primitiveTokens.fontSize.sm,
    lineHeight: space[5],
    fontWeight: primitiveTokens.fontWeight.bold,
    color: semanticTokens.color.textMuted,
    textDecorationLine: 'underline',
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
