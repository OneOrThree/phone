import React, { useContext, useEffect, useRef, useState } from 'react';
import {
  AccessibilityActionEvent,
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { MotionContext } from '@/design-system/primitives';
import { Btn, CharCount, Chevron, Overlay, Txt, k } from '@/design-system/patterns';
import { TextInput } from '@/design-system/typography';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import {
  DEFAULT_FRAME_ID,
  MAGAZINE_FRAMES,
  MAGAZINE_STAMP,
  StickerTab,
} from '@/constants/magazineAssets';
import { mockFlags } from '@/services/api/magazineMock';
import { isMockMode } from '@/services/demoMode';
import { State, capacityOf, currentIsland, isHost, serverHome } from '@/services/model';
import { clampCodePoints } from '@/utils/codePoints';
import { useAppLayout } from '@/utils/layout';
import { AdCell, AdCellData } from './AdCell';
import {
  BODY_MAX,
  CELL_ASPECT,
  EditOp,
  EditTarget,
  PromotionLayout,
  addSticker,
  applyEdit,
  emptyLayout,
  layoutProblem,
  setTape,
} from './layout';
import { StickerDrawer, assetName } from './StickerDrawer';
import { EditorProblem, usePromotionEditor } from './usePromotionEditor';
import { CANVAS_PAD, handlePoint, itemBox, useStickerGestures } from './useStickerGestures';

type IslandFacts = Omit<AdCellData, 'body' | 'layout'>;

/**
 * 개발 미리보기(MagazinePreview 의 editor 대본) 전용 — 시뮬레이터에서 손가락 없이 같은 판 핸들러·버튼 동작을 부른다.
 * 제품 화면은 넘기지 않는다.
 */
export type EditorDriver = {
  canvas: ReturnType<typeof useStickerGestures>;
  cellW: number;
  /** 고른 꾸미기 손잡이의 판 안 좌표(없으면 null). */
  handle: () => { x: number; y: number } | null;
  body: (text: string) => void;
  frame: (id: string) => void;
  sticker: (id: string) => void;
  tape: (id: string) => void;
  op: (op: EditOp) => void;
  submit: () => void;
  closeDone: () => void;
};

/**
 * 쓰기 화면이 칸 미리보기에 쓰는 우리 섬 값 — 서버 모드는 홈 스냅샷, 목업은 로컬 섬. 평균은 07시 발행 때 정해지므로
 * 미리보기에서는 「평균 집계 전」이다. 섬장 여부도 같은 근거로 본다(서버 홈 role · 목업 isHost).
 */
export function editorIsland(
  state: State,
  server: boolean,
): { islandId: string | null; host: boolean; facts: IslandFacts | null } {
  if (server) {
    const facts = serverHome(state);
    if (!facts) return { islandId: null, host: false, facts: null };
    const island = facts.home.island;
    return {
      islandId: island.id,
      host: island.role === 'host',
      facts: {
        name: island.name,
        memberCount: island.memberCount,
        maxMembers: island.maxMembers,
        buildingCount: facts.completedBuildings.length,
        averageFocusMinutesPerDay: null,
      },
    };
  }
  const island = currentIsland(state);
  return {
    islandId: island.id,
    host: isHost(island),
    facts: {
      name: island.name,
      memberCount: island.members.length + (island.joined ? 1 : 0),
      maxMembers: capacityOf(island),
      buildingCount: island.buildings.length,
      averageFocusMinutesPerDay: null,
    },
  };
}

// 서버 PromotionContent.breaksTheLine 과 같은 문자 — ISO 제어 문자(U+0000~001F · U+007F~009F)와 줄·문단 구분자
const LINE_BREAKERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
// 손가락 대안 — 옮기기·크기·돌리기·겹침·지우기를 모두 버튼으로도 한다(DESIGN.md 8.19)
const OPS: EditOp[] = [
  'left',
  'up',
  'down',
  'right',
  'smaller',
  'bigger',
  'rotateLeft',
  'rotateRight',
  'front',
  'delete',
];
/** 꾸미기마다 둔 접근성 요소의 반치수 하한 — 44pt 터치 영역 */
const A11Y_HALF = semanticTokens.size.tapMin / 2;
const OP_GLYPH: Partial<Record<EditOp, string>> = {
  left: '←',
  up: '↑',
  down: '↓',
  right: '→',
  rotateLeft: '↺',
  rotateRight: '↻',
};
/** 테이프는 크기·겹침 순서가 없다(applyEdit 가 그대로 둔다) — 버튼 줄·스크린리더 동작에서 뺀다. */
const TAPE_OFF: EditOp[] = ['bigger', 'smaller', 'front'];
const opsFor = (target: EditTarget, ops: EditOp[]) =>
  target.kind === 'tape' ? ops.filter((op) => !TAPE_OFF.includes(op)) : ops;
const A11Y_OPS: EditOp[] = [
  'up',
  'down',
  'left',
  'right',
  'bigger',
  'smaller',
  'rotateLeft',
  'rotateRight',
  'front',
  'delete',
];

/**
 * 우리 섬 홍보 쓰기(C1) · 접수 완료(C2) — 섬장만. 칸 틀 고르기 → 한 줄 글(60자) → 칸 위에서 스티커 꾸미기(끌기 · 두 손가락 크기·회전 ·
 * 손잡이 · 버튼) → [잡지에 싣기 · 60 물고기] 또는 신청 창 안이면 [고친 내용 저장]. 자정이 지나면 읽기 전용이다(10/14).
 * 화면을 열면 다음 호에 이미 낸 칸, 없으면 지난번에 실은 칸이 그대로 열린다(AD-08). 임시 저장은 없다.
 */
export function PromotionEditor({
  e,
  driver,
}: {
  e: any;
  driver?: React.MutableRefObject<EditorDriver | null>;
}) {
  const state: State = e.state;
  const L = useAppLayout();
  const largeText = L.fontScale >= componentTokens.promotionEditor.largeTextThreshold;
  const reduceMotion = useContext(MotionContext);
  const mock = isMockMode();
  const base = editorIsland(state, !!e.islands);
  // 목업 QA: EXPO_PUBLIC_MAGAZINE_MOCK=member 면 섬장이 아닌 주민으로 본다
  const host = base.host && !(mock && mockFlags().has('member'));
  const { status, editor, assets, error, submitting, reload, submit } = usePromotionEditor({
    islandId: host ? base.islandId : null,
    offerConversion: e.conversion?.offer,
  });

  const [body, setBody] = useState('');
  const [layout, setLayout] = useState<PromotionLayout>(emptyLayout(DEFAULT_FRAME_ID));
  const [picked, setSelection] = useState<EditTarget | null>(null);
  // 고른 것이 지금 칸에 없으면(지워졌거나 칸이 바뀜) 고르지 않은 것으로 본다 — 없는 스티커 번호로 그리지 않게
  const selection =
    picked && (picked.kind === 'tape' ? !!layout.tape : picked.index < layout.stickers.length)
      ? picked
      : null;
  const [tab, setTab] = useState<StickerTab>('cat');
  const [problem, setProblem] = useState<EditorProblem | null>(null);
  const [done, setDone] = useState(false);
  const [stamped, setStamped] = useState(false);
  // 칸 위에 손가락이 있는 동안은 화면 세로 스크롤을 잠근다(끌기·두 손가락 조작이 스크롤에 뺏기지 않게)
  const [canvasTouch, setCanvasTouch] = useState(false);
  const touched = useRef(false);
  const stamp = useRef(new Animated.Value(0)).current;

  // 처음 불러온 칸(다음 호 → 지난번 칸 → 빈 칸)으로 연다. 사용자가 고치기 시작한 뒤 다시 읽어도 고친 것은 두고 모드만 바꾼다.
  // 단 마감(자정)으로 읽기 전용이 되면 저장 안 한 고친 것은 실리지 않는다 — 서버에 남은(잡지에 실릴) 칸으로 되돌린다
  useEffect(() => {
    if (!editor) return;
    // 신청 창이 새 호로 넘어가면(07시 다시 읽기 — 낸 칸이 실려 next 가 비었다) 지난 접수 발도장을 걷는다
    if (!editor.next) setStamped(false);
    const locked = !!editor.next && !editor.next.editable;
    if (touched.current && !locked) return;
    const from = editor.next ?? editor.latest;
    setBody(from?.body ?? '');
    setLayout(from?.layout ?? emptyLayout(DEFAULT_FRAME_ID));
    // 서버 칸으로 바꾸면 스티커 수가 달라질 수 있다 — 고르기는 늘 푼다
    setSelection(null);
    if (locked) touched.current = false;
  }, [editor]);

  const edit = (next: PromotionLayout) => {
    touched.current = true;
    setStamped(false);
    setLayout(next);
  };
  const readOnly = !!editor?.next && !editor.next.editable;
  // editable = 고칠 수 있는 화면(서랍·버튼을 그린다), canEdit = 지금 손을 댈 수 있다(저장 중에는 잠깐 막는다)
  const editable = status === 'ready' && !readOnly;
  const canEdit = editable && !submitting;
  // 서버 재료 목록에서 내 것이 아니라고 온 것만 잠근다(목록을 못 읽었으면 지금 재료는 전부 무료라 연다)
  const owned = (id: string) => {
    if (!assets) return true;
    const item = [...assets.frames, ...assets.stickers, ...assets.tapes].find(
      (a) => a.assetId === id,
    );
    return item ? item.owned : false;
  };

  // 칸 크기: 화면 폭에서 스티커가 걸칠 둘레(8%)를 뺀 만큼. 태블릿·가로에서는 너무 커지지 않게 묶는다
  const frameW = Math.min(L.width - L.insets.left - L.insets.right, 520) - primitiveTokens.space[4];
  const cellW = Math.floor(frameW / (1 + 2 * CANVAS_PAD));
  const cellH = cellW * CELL_ASPECT;
  const pad = { x: CANVAS_PAD * cellW, y: CANVAS_PAD * cellH };
  const gestures = useStickerGestures({
    width: cellW,
    layout,
    selection,
    enabled: canEdit,
    onSelect: setSelection,
    onChange: edit,
  });

  const doEdit = (target: EditTarget, op: EditOp) => {
    const result = applyEdit(layout, target, op);
    edit(result.layout);
    setSelection(result.target);
  };
  const addOne = (id: string) => {
    const next = addSticker(layout, id);
    if (!next) return e.notify(t('magazine.editor.stickersFull'));
    edit(next);
    setSelection({ kind: 'sticker', index: next.stickers.length - 1 });
  };
  const putTape = (id: string) => {
    edit(setTape(layout, id));
    setSelection({ kind: 'tape' });
  };
  const fresh = () => {
    edit(emptyLayout(layout.frameId));
    touched.current = true;
    setBody('');
    setSelection(null);
    setProblem(null);
  };

  const changeBody = (text: string) => {
    // 한 줄 글 — 서버는 줄바꿈·탭 같은 제어 문자와 U+2028·U+2029 를 거절한다(400). 붙여 넣은 것은 띄어쓰기로 바꾸고,
    // 길이는 서버처럼 코드포인트로 자른다
    touched.current = true;
    setStamped(false);
    setBody(clampCodePoints(text.replace(LINE_BREAKERS, ' '), BODY_MAX));
    if (problem?.field === 'body') setProblem(null);
  };
  const send = async () => {
    const trimmed = body.trim();
    if (!trimmed) return setProblem({ message: t('magazine.editor.bodyEmpty'), field: 'body' });
    // 개수·범위만 미리 본다 — 이 앱이 모르는 재료(새 시즌)는 그리지 못해도 지난 칸의 일부로 그대로 보낸다(보유 판정은 서버)
    if (layoutProblem(layout)) return setProblem({ message: t('magazine.editor.problem.layout') });
    setProblem(null);
    const result = await submit({ body: trimmed, layout });
    if ('ok' in result) {
      setSelection(null);
      if (result.ok === 'updated') return e.notify(t('magazine.editor.saved'));
      setStamped(true);
      setDone(true);
      stamp.setValue(reduceMotion ? 1 : 0);
      if (!reduceMotion)
        Animated.spring(stamp, {
          toValue: 1,
          useNativeDriver: true,
          speed: 14,
          bounciness: 9,
        }).start();
      return;
    }
    if (!result.problem.message) return;
    setProblem(result.problem);
    if (!result.problem.field) e.notify(result.problem.message);
  };

  if (driver)
    driver.current = {
      canvas: gestures,
      cellW,
      handle: () => {
        const h = selection && handlePoint(layout, selection, cellW);
        return h && { x: pad.x + h.x, y: pad.y + h.y };
      },
      body: changeBody,
      frame: (id) => edit({ ...layout, frameId: id }),
      sticker: addOne,
      tape: putTape,
      op: (op) => selection && doEdit(selection, op),
      submit: send,
      closeDone: () => setDone(false),
    };

  const header = (
    <View
      style={{
        // 큰 글자에서 제목이 두 줄이 되면 머리도 같이 늘어난다
        minHeight: componentTokens.promotionEditor.headerHeight,
        flexDirection: 'row',
        alignItems: 'center',
        gap: primitiveTokens.space[2],
        paddingLeft: primitiveTokens.space[2],
        paddingRight: semanticTokens.spacing.control,
      }}
    >
      <Pressable
        testID="promotion-back"
        accessibilityRole="button"
        accessibilityLabel={t('telescope.back')}
        onPress={e.back}
        style={{
          width: semanticTokens.size.tapMin,
          height: semanticTokens.size.tapMin,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Chevron back />
      </Pressable>
      <Txt
        testID="promotion-title"
        accessibilityRole="header"
        style={{ flex: 1, fontSize: 20, fontWeight: '800' }}
      >
        {t('magazine.editor.title')}
      </Txt>
    </View>
  );

  const center = (children: React.ReactNode) => (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: semanticTokens.spacing.section,
        gap: semanticTokens.spacing.control,
      }}
    >
      {children}
    </View>
  );
  const shell = (content: React.ReactNode, footer?: React.ReactNode) => (
    <View
      style={{ flex: 1, backgroundColor: semanticTokens.color.canvas, paddingTop: L.insets.top }}
    >
      <View
        testID="promotion-editor-layer"
        style={{ flex: 1 }}
        accessibilityElementsHidden={done}
        importantForAccessibility={done ? 'no-hide-descendants' : 'auto'}
      >
        {header}
        {content}
        {footer}
      </View>
      {done && (
        <Overlay close={() => setDone(false)}>
          <Txt kind="h17">{t('magazine.editor.doneTitle')}</Txt>
          {/* 자정을 넘겨 받은 성공이면 이미 잠긴 오늘 07시 호다 — 「내일 · 자정까지 고칠 수 있어요」라고 하지 않는다 */}
          <Txt>{t(readOnly ? 'magazine.editor.doneBodyLocked' : 'magazine.editor.doneBody')}</Txt>
          <Btn id="promotion-done-ok" title={t('common.ok')} onPress={() => setDone(false)} />
        </Overlay>
      )}
    </View>
  );

  if (!host)
    return shell(
      center(
        <>
          <Txt kind="h17" style={{ textAlign: 'center' }}>
            {base.islandId || !e.islands
              ? t('magazine.editor.hostOnly')
              : t('magazine.editor.loading')}
          </Txt>
          {base.islandId || !e.islands ? (
            <Btn small kind="sec" title={t('common.ok')} onPress={e.back} />
          ) : null}
        </>,
      ),
    );
  if (status === 'loading' && !editor)
    return shell(
      center(
        <>
          <ActivityIndicator color={semanticTokens.color.outline} />
          <Txt kind="meta">{t('magazine.editor.loading')}</Txt>
        </>,
      ),
    );
  if (status === 'guest')
    return shell(
      center(
        <>
          <Txt kind="h17" style={{ textAlign: 'center' }}>
            {t('magazine.editor.guest')}
          </Txt>
          {e.conversion ? (
            <Btn
              id="promotion-login"
              title={t('magazine.editor.login')}
              onPress={() => e.conversion.offer(error)}
            />
          ) : null}
        </>,
      ),
    );
  if (status === 'forbidden')
    return shell(
      center(
        <>
          <Txt kind="h17" style={{ textAlign: 'center' }}>
            {t('magazine.editor.hostOnly')}
          </Txt>
          <Btn small kind="sec" title={t('common.ok')} onPress={e.back} />
        </>,
      ),
    );
  if (status === 'error' || !editor)
    return shell(
      center(
        <>
          <Txt accessibilityLiveRegion="polite" style={{ textAlign: 'center' }}>
            {t('magazine.editor.loadFailed')}
          </Txt>
          <Btn id="promotion-retry" small kind="sec" title={t('common.retry')} onPress={reload} />
        </>,
      ),
    );

  const facts = base.facts!;
  const fee = editor.feeFish;
  const poor = !editor.next && editor.balance < fee;
  const closed = !editor.next && !editor.window.open;
  const blocked = readOnly || closed || poor || editor.privateIsland;
  const ctaTitle = editor.next
    ? t('magazine.editor.save')
    : closed
      ? t('magazine.editor.whenClosed')
      : t('magazine.editor.apply', { fish: fee });
  const note = readOnly
    ? t('magazine.editor.locked')
    : editor.privateIsland
      ? t('magazine.editor.problem.private')
      : poor
        ? t('magazine.editor.problem.poor')
        : !editor.next && !editor.window.open
          ? t('magazine.editor.whenClosed')
          : t('magazine.editor.whenOpen');

  const box = selection && itemBox(layout, selection, cellW);
  const handle = selection && canEdit && handlePoint(layout, selection, cellW);
  const itemLabel = (target: EditTarget) => {
    if (target.kind === 'tape') return assetName(layout.tape?.assetId ?? '');
    const s = layout.stickers[target.index];
    return t('magazine.editor.stickerA11y', { name: assetName(s.assetId), n: target.index + 1 });
  };
  const a11yItem = (target: EditTarget, key: string) => {
    const b = itemBox(layout, target, cellW);
    if (!b) return null;
    const label = itemLabel(target);
    const chosen =
      !!selection &&
      selection.kind === target.kind &&
      (target.kind === 'tape' ||
        (selection.kind === 'sticker' && selection.index === target.index));
    return (
      <View
        key={key}
        testID={`canvas-${key}`}
        accessible
        pointerEvents="none"
        accessibilityLabel={chosen ? t('magazine.editor.selectedA11y', { name: label }) : label}
        accessibilityState={{ selected: chosen }}
        accessibilityActions={
          canEdit
            ? [
                { name: 'activate', label: t('magazine.editor.op.select') },
                ...opsFor(target, A11Y_OPS).map((op) => ({
                  name: op,
                  label: t(`magazine.editor.op.${op}`),
                })),
              ]
            : undefined
        }
        onAccessibilityAction={(event: AccessibilityActionEvent) => {
          const name = event.nativeEvent.actionName;
          if (name === 'activate') return setSelection(target);
          if ((opsFor(target, A11Y_OPS) as string[]).includes(name)) doEdit(target, name as EditOp);
        }}
        // 스크린리더 터치 탐색 대상 — 작은 스티커도 최소 44pt(손가락 hitTest 와 같은 하한)
        style={{
          position: 'absolute',
          left: pad.x + b.cx - Math.max(b.hw, A11Y_HALF),
          top: pad.y + b.cy - Math.max(b.hh, A11Y_HALF),
          width: Math.max(b.hw, A11Y_HALF) * 2,
          height: Math.max(b.hh, A11Y_HALF) * 2,
        }}
      />
    );
  };

  // 작은 화면(320×568)·키보드·큰 글자에서 넘치면 본문 전체를 세로로 민다. 넉넉하면 늘 그렇듯 서랍이 남은 높이를 채운다
  const content = (
    <ScrollView
      testID="promotion-scroll"
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      alwaysBounceVertical={false}
      scrollEnabled={!canvasTouch}
    >
      <View
        style={{
          flex: 1,
          width: Math.min(L.contentWidth, 560),
          alignSelf: 'center',
          gap: semanticTokens.spacing.control,
        }}
      >
        <View
          style={{ paddingHorizontal: semanticTokens.spacing.page, gap: primitiveTokens.space[2] }}
        >
          <Txt kind="meta" style={{ fontWeight: '600' }}>
            {t('magazine.editor.frames')}
          </Txt>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: primitiveTokens.space[2] }}
          >
            {Object.entries(MAGAZINE_FRAMES).map(([id, frame]) => {
              const on = layout.frameId === id;
              return (
                <Pressable
                  key={id}
                  testID={`frame-${id}`}
                  accessibilityRole="button"
                  accessibilityLabel={t('magazine.editor.frameA11y', { name: assetName(id) })}
                  accessibilityState={{ selected: on, disabled: !canEdit || !owned(id) }}
                  disabled={!canEdit || !owned(id)}
                  onPress={() => edit({ ...layout, frameId: id })}
                  style={{
                    width: componentTokens.promotionEditor.frameTileWidth,
                    height: semanticTokens.size.tapMin,
                    padding: primitiveTokens.space[1],
                    borderRadius: semanticTokens.radius.control,
                    borderWidth: on ? semanticTokens.stroke.strong : semanticTokens.stroke.subtle,
                    borderColor: on
                      ? semanticTokens.color.outline
                      : primitiveTokens.color.controlIdle,
                    backgroundColor: on
                      ? semanticTokens.color.selected
                      : semanticTokens.color.surface,
                    opacity: owned(id) ? 1 : componentTokens.button.disabledOpacity,
                  }}
                >
                  <Image
                    source={frame.source}
                    resizeMode="contain"
                    style={{ width: '100%', height: '100%' }}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
        <View
          style={{ paddingHorizontal: semanticTokens.spacing.page, gap: primitiveTokens.space[1] }}
        >
          <TextInput
            testID="promotion-body"
            accessibilityLabel={t('magazine.editor.body')}
            value={body}
            editable={canEdit}
            placeholder={t('magazine.editor.bodyPlaceholder')}
            placeholderTextColor={componentTokens.input.placeholder}
            returnKeyType="done"
            onChangeText={changeBody}
            style={[
              k.field,
              { minHeight: semanticTokens.size.tapMin },
              !canEdit && { opacity: 0.7 },
            ]}
          />
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: primitiveTokens.space[2],
            }}
          >
            <Txt
              kind="meta"
              accessibilityLiveRegion="polite"
              style={{ flex: 1, color: semanticTokens.color.danger }}
            >
              {problem?.field === 'body' ? problem.message : ''}
            </Txt>
            <CharCount value={body} max={BODY_MAX} codePoints />
          </View>
        </View>
        <View
          testID="promotion-canvas"
          {...gestures}
          onTouchStart={() => setCanvasTouch(true)}
          onTouchEnd={(ev) => ev.nativeEvent.touches.length === 0 && setCanvasTouch(false)}
          onTouchCancel={() => setCanvasTouch(false)}
          style={{ width: cellW + pad.x * 2, height: cellH + pad.y * 2, alignSelf: 'center' }}
        >
          <View pointerEvents="none" style={{ position: 'absolute', left: pad.x, top: pad.y }}>
            <AdCell
              testID="promotion-cell"
              width={cellW}
              cell={{ ...facts, body: body.trim(), layout }}
            />
          </View>
          {box && canEdit && (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: pad.x + box.cx - box.hw - componentTokens.promotionEditor.selectionInset,
                top: pad.y + box.cy - box.hh - componentTokens.promotionEditor.selectionInset,
                width: box.hw * 2 + componentTokens.promotionEditor.selectionInset * 2,
                height: box.hh * 2 + componentTokens.promotionEditor.selectionInset * 2,
                borderRadius: componentTokens.promotionEditor.selectionRadius,
                borderWidth: semanticTokens.stroke.default,
                borderStyle: 'dashed',
                borderColor: semanticTokens.color.outline,
                transform: [{ rotate: `${box.rotation}deg` }],
              }}
            />
          )}
          {handle && (
            <View
              testID="promotion-handle"
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: pad.x + handle.x - componentTokens.promotionEditor.handleSize / 2,
                top: pad.y + handle.y - componentTokens.promotionEditor.handleSize / 2,
                width: componentTokens.promotionEditor.handleSize,
                height: componentTokens.promotionEditor.handleSize,
                borderRadius: componentTokens.promotionEditor.handleSize / 2,
                borderWidth: semanticTokens.stroke.strong,
                borderColor: semanticTokens.color.outline,
                backgroundColor: semanticTokens.color.surface,
              }}
            />
          )}
          {stamped && (
            // 판의 손가락 기준점이 흔들리지 않게 도장은 터치를 받지 않는다
            <View
              pointerEvents="none"
              style={{ position: 'absolute', left: pad.x + cellW * 0.6, top: pad.y + cellH * 0.3 }}
            >
              <Animated.Image
                testID="promotion-stamp"
                accessibilityLabel={t('magazine.editor.stampA11y')}
                source={MAGAZINE_STAMP}
                resizeMode="contain"
                style={{
                  width: cellW * 0.38,
                  height: cellW * 0.38,
                  opacity: stamp,
                  transform: [
                    { scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [1.8, 1] }) },
                    { rotate: '-10deg' },
                  ],
                }}
              />
            </View>
          )}
          {layout.stickers.map((_, i) => a11yItem({ kind: 'sticker', index: i }, `sticker-${i}`))}
          {layout.tape && a11yItem({ kind: 'tape' }, 'tape')}
        </View>
        <View style={{ minHeight: semanticTokens.size.tapMin, justifyContent: 'center' }}>
          {selection && canEdit ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                gap: primitiveTokens.space[2],
                paddingHorizontal: semanticTokens.spacing.page,
              }}
            >
              {opsFor(selection, OPS).map((op) => (
                <Btn
                  key={op}
                  id={`op-${op}`}
                  small
                  kind="sec"
                  dynamicHeight={largeText}
                  title={OP_GLYPH[op] ?? t(`magazine.editor.op.${op}`)}
                  accessibilityLabel={`${t(`magazine.editor.op.${op}`)}: ${itemLabel(selection)}`}
                  onPress={() => doEdit(selection, op)}
                />
              ))}
            </ScrollView>
          ) : (
            <Txt
              kind="meta"
              style={{ textAlign: 'center', paddingHorizontal: semanticTokens.spacing.page }}
            >
              {readOnly ? t('magazine.editor.locked') : t('magazine.editor.hint')}
            </Txt>
          )}
        </View>
        {editable ? (
          <View
            pointerEvents={canEdit ? 'auto' : 'none'}
            style={{
              flex: 1,
              minHeight: componentTokens.promotionEditor.drawerMinHeight,
              paddingTop: semanticTokens.spacing.control,
              paddingHorizontal: semanticTokens.spacing.page,
              borderTopLeftRadius: componentTokens.modal.sheetRadius,
              borderTopRightRadius: componentTokens.modal.sheetRadius,
              borderWidth: semanticTokens.stroke.default,
              borderBottomWidth: 0,
              borderColor: semanticTokens.color.outline,
              backgroundColor: semanticTokens.color.surface,
            }}
          >
            <StickerDrawer
              tab={tab}
              onTab={setTab}
              full={layout.stickers.length >= 10}
              owned={owned}
              tapeId={layout.tape?.assetId ?? null}
              onSticker={addOne}
              onTape={putTape}
              onFull={() => e.notify(t('magazine.editor.stickersFull'))}
            />
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
      </View>
    </ScrollView>
  );

  const footer = (
    <View
      style={{
        paddingHorizontal: semanticTokens.spacing.page,
        paddingTop: semanticTokens.spacing.control,
        paddingBottom: L.insets.bottom + semanticTokens.spacing.control,
        gap: primitiveTokens.space[2],
        backgroundColor: editable ? semanticTokens.color.surface : semanticTokens.color.canvas,
      }}
    >
      {problem && !problem.field ? (
        <Txt
          accessibilityLiveRegion="polite"
          kind="meta"
          style={{ textAlign: 'center', color: semanticTokens.color.danger }}
        >
          {problem.message}
        </Txt>
      ) : null}
      {/* 큰 글자에서는 [새로 꾸미기]·주 행동을 세로로 쌓아 주 행동이 화면 폭을 다 쓴다 */}
      <View
        testID="promotion-actions"
        style={{
          flexDirection: largeText ? 'column-reverse' : 'row',
          gap: primitiveTokens.space[2],
        }}
      >
        {editable && (
          <Btn
            id="promotion-fresh"
            kind="sec"
            dynamicHeight
            title={t('magazine.editor.reset')}
            disabled={!canEdit}
            onPress={fresh}
          />
        )}
        <Btn
          id="promotion-submit"
          style={largeText ? undefined : { flex: 1 }}
          // 좁은 화면(320pt)·영문에서 주 행동 문구가 두 줄이 되어도 버튼이 같이 늘어난다(기본 높이 52 는 그대로)
          dynamicHeight
          title={ctaTitle}
          // canEdit = 불러온 상태(다시 읽는 중 아님) · 저장 중 아님
          disabled={blocked || !canEdit}
          onPress={send}
        />
      </View>
      <Txt kind="meta" style={{ textAlign: 'center' }}>
        {`${t('magazine.editor.balance', { fish: formatNumber(editor.balance) })} · ${note}`}
      </Txt>
    </View>
  );

  return shell(content, footer);
}
