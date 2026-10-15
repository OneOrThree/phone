import React, { useContext, useEffect, useRef, useState } from 'react';
import {
  AccessibilityActionEvent,
  ActivityIndicator,
  Animated,
  BackHandler,
  Image,
  Keyboard,
  TextInput as NativeTextInput,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { MotionContext } from '@/design-system/primitives';
import { Btn, CharCount, Chevron, Overlay, Txt } from '@/design-system/patterns';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { art } from '@/constants/art';
import {
  DEFAULT_FRAME_ID,
  MAGAZINE_FRAMES,
  MAGAZINE_STAMP,
  MAGAZINE_UI,
  StickerTab,
} from '@/constants/magazineAssets';
import { managedIslandRole } from '@/screens/interiors/useIslandManagement';
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
  MAX_STICKERS,
  PromotionLayout,
  addSticker,
  applyEdit,
  emptyLayout,
  layoutProblem,
  setTape,
} from './layout';
import { StickerDrawer, assetName } from './StickerDrawer';
import { issueDateText } from './MagazineReader';
import { AppliedPhase, EditorProblem, usePromotionEditor } from './usePromotionEditor';
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
  step: (step: EditorStep) => void;
  submit: () => void;
  closeDone: () => void;
};

/** 쓰기 단계(10/15) — 칸 틀을 고르고, 칸 안에서 한 줄 글을 쓰고, 글이 있어야 스티커를 붙인다. */
export type EditorStep = 'frame' | 'text' | 'stickers';

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
      // 회관 「섬 관리」가 확정한 관리 API 역할이 있으면 그것, 없으면 홈 스냅샷 — 회관 입구(displayHost)와 같은 근거라
      // 다른 기기에서 위임받아 스냅샷이 늦어도 입구와 쓰기 화면이 엇갈리지 않는다
      host: (managedIslandRole(island.id) ?? island.role) === 'host',
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
// 고른 꾸미기 버튼 줄 — 손가락에 없는 겹침·지우기만(옮기기·크기·돌리기는 끌기·손잡이, 스크린리더는 A11Y_OPS 동작, DESIGN.md 8.19)
const OPS: EditOp[] = ['front', 'delete'];
/** 꾸미기마다 둔 접근성 요소의 반치수 하한 — 44pt 터치 영역 */
const A11Y_HALF = semanticTokens.size.tapMin / 2;
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
 * 손잡이 · 맨 앞으로·지우기 버튼) → [잡지에 싣기 · 60 물고기] 또는 신청 창 안이면 [고친 내용 저장]. 자정이 지나면 읽기 전용이다(10/14).
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
  const [step, setStep] = useState<EditorStep>('frame');
  // 처음 열 때만 단계를 정한다(다시 읽기로 보던 단계가 바뀌지 않게) — 마감으로 읽기 전용이 되면 칸 전체 단계로
  const opened = useRef(false);
  const bodyRef = useRef<NativeTextInput>(null);
  // 고른 종이 — 새로 쓸 때는 아무것도 골라 두지 않는다(기본 틀은 그리기용일 뿐)
  const [chosenFrame, setChosenFrame] = useState<string | null>(null);
  // 종이 고르기의 잡지 속지 — 남은 자리에 잡지와 같은 비율로 가장 크게
  const [pageBox, setPageBox] = useState({ width: 0, height: 0 });
  const [problem, setProblem] = useState<EditorProblem | null>(null);
  // 접수 완료 확인창 — 열 때의 신청 결과(호 · 시점)로 문구를 고정한다(뒤이은 다시 읽기로 바뀌지 않게). null 이면 닫힘
  const [done, setDone] = useState<{ issueDate: string; phase: AppliedPhase } | null>(null);
  const [stamped, setStamped] = useState(false);
  // 싣기 전 가격 안내창
  const [confirming, setConfirming] = useState(false);
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
    // 새로 쓰면 빈 종이에서 시작한다(10/15 — 지난번 글·스티커를 채워 두지 않는다). 이미 낸 홍보만 그 칸으로 연다
    const from = editor.next;
    setBody(from?.body ?? '');
    setLayout(from?.layout ?? emptyLayout(DEFAULT_FRAME_ID));
    setChosenFrame(from ? from.layout.frameId : null);
    // 서버 칸으로 바꾸면 스티커 수가 달라질 수 있다 — 고르기는 늘 푼다
    setSelection(null);
    if (locked) touched.current = false;
    // 이미 낸 홍보를 고치러 오면 틀·글이 정해져 있다 — 바로 칸 전체(스티커) 단계로 연다
    if (!opened.current || locked) setStep(editor.next || locked ? 'stickers' : 'frame');
    opened.current = true;
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
  // 뒤로가기 — 한 단계씩 돌아간다(스티커 → 글 → 종이 → 회관). 이미 낸 홍보도 이 길로 글·종이를 고친다
  const backStep: EditorStep | null = !editable
    ? null
    : step === 'stickers'
      ? 'text'
      : step === 'text'
        ? 'frame'
        : null;
  const goBack = () => (backStep ? setStep(backStep) : e.back());
  // 안드로이드 하드웨어 뒤로가기도 같은 순서 — 나중에 단 리스너가 먼저 받으므로 App 의 처리보다 앞선다
  useEffect(() => {
    if (!backStep) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setStep(backStep);
      return true;
    });
    return () => sub.remove();
  }, [backStep]);
  // 서버 재료 목록에서 내 것이 아니라고 온 것만 잠근다(목록을 못 읽었으면 지금 재료는 전부 무료라 연다)
  const owned = (id: string) => {
    if (!assets) return true;
    const item = [...assets.frames, ...assets.stickers, ...assets.tapes].find(
      (a) => a.assetId === id,
    );
    return item ? item.owned : false;
  };

  // 칸 크기: 화면 폭에서 스티커가 걸칠 둘레(8%)를 뺀 만큼. 태블릿·가로에서는 너무 커지지 않게 묶는다
  // 쓰기 화면은 모든 단계를 잡지 속지 위에서 한다. 속지는 종이 고르기 화면(머리 아래 ~ 바닥 여백 위) 안에 잡지와 같은
  // 비율로 가장 크게 — 세 단계가 같은 크기라 종이도 늘 같은 크기다. 글(키보드)·스티커(서랍) 단계에서는 속지 아래가 가려지고,
  // 종이는 보이는 속지 안 가운데에 둔다. 종이 폭 = 속지 안쪽 폭(스티커가 걸칠 둘레 8% 는 속지 테두리 그림 위로 나가도 된다)
  const R = componentTokens.magazineReader;
  const areaH =
    L.height -
    L.insets.top -
    componentTokens.promotionEditor.headerHeight -
    L.insets.bottom -
    semanticTokens.spacing.control;
  const pageW = Math.min(L.width, areaH * R.pageAspect, R.maxPageWidth);
  const pageH = pageW / R.pageAspect;
  const cellW =
    Math.floor(pageW * (1 - R.insetX * 2)) -
    primitiveTokens.space[1] * 2 -
    semanticTokens.stroke.strong * 2;
  // 속지 안에서 실제로 보이는 높이(띠 아래 ~ 남은 자리 끝)
  const pageInnerH = Math.min(
    pageH * (1 - R.insetTop - R.insetBottom),
    (pageBox.height || pageH) - pageH * R.insetTop,
  );
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
  // [새로 꾸미기] — 스티커·테이프만 비운다(10/15). 고른 종이와 글은 그대로 두고 스티커 단계에 머문다
  const fresh = () => {
    edit(emptyLayout(layout.frameId));
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
  // 글을 다 쓰면 스티커 단계로 — 빈 글이면 넘어가지 않고 글 아래에 안내한다
  const toStickers = () => {
    if (!body.trim()) return setProblem({ message: t('magazine.editor.bodyEmpty'), field: 'body' });
    Keyboard.dismiss();
    setStep('stickers');
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
      setDone({ issueDate: result.issueDate, phase: result.phase });
      // 이미 나온 호면 지금 칸은 새 신청 창의 칸이다 — 접수 도장을 찍지 않는다
      if (result.phase === 'published') return;
      setStamped(true);
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
    // 글 문제(금칙어 · 60자 초과)는 글 단계로 돌려 칸 아래 빨간 안내와 함께 바로 고치게 한다
    if (result.problem.field === 'body') setStep('text');
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
      step: setStep,
      submit: send,
      closeDone: () => setDone(null),
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
        onPress={goBack}
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
        accessibilityElementsHidden={!!done || confirming}
        importantForAccessibility={done || confirming ? 'no-hide-descendants' : 'auto'}
      >
        {header}
        {content}
        {footer}
      </View>
      {confirming && editor && (
        <Overlay close={() => setConfirming(false)}>
          <Txt kind="h17">{t('magazine.editor.confirmTitle')}</Txt>
          {/* 값만 — 섬에서 쓰는 물고기 그림 + 숫자 */}
          <View
            testID="promotion-confirm-price"
            accessible
            accessibilityLabel={t('magazine.editor.confirmA11y', { fish: editor.feeFish })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: primitiveTokens.space[1] }}
          >
            <Image source={art.fish} style={{ width: 26, height: 26 }} />
            <Txt style={{ fontWeight: '800' }}>{editor.feeFish}</Txt>
          </View>
          <View style={{ flexDirection: 'row', gap: semanticTokens.spacing.control }}>
            <Btn
              id="promotion-confirm-cancel"
              kind="sec"
              style={{ flex: 1 }}
              title={t('common.cancel')}
              onPress={() => setConfirming(false)}
            />
            <Btn
              id="promotion-confirm-ok"
              style={{ flex: 1 }}
              title={t('magazine.editor.confirmOk')}
              onPress={() => {
                setConfirming(false);
                void send();
              }}
            />
          </View>
        </Overlay>
      )}
      {done && (
        <Overlay close={() => setDone(null)}>
          <Txt kind="h17">{t('magazine.editor.doneTitle')}</Txt>
          {/* 성공을 받은 시점으로 고른다 — 마감 전 「내일 · 자정까지」, 자정 뒤 「오늘 · 더는 못 고침」, 발행 뒤 「이미 나옴」 */}
          <Txt testID="promotion-done-body">
            {done.phase === 'published'
              ? t('magazine.editor.doneBodyPublished', { date: issueDateText(done.issueDate) })
              : t(
                  done.phase === 'locked'
                    ? 'magazine.editor.doneBodyLocked'
                    : 'magazine.editor.doneBody',
                )}
          </Txt>
          <Btn id="promotion-done-ok" title={t('common.ok')} onPress={() => setDone(null)} />
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
      : t('magazine.editor.apply');
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

  const page = semanticTokens.spacing.page;
  const space = primitiveTokens.space;
  // 1단계 — 종이(칸 틀) 고르기. 잡지 속지 위 가운데에 빈 종이를 한 장씩 크게 두고 세로로 밀어 고른다. 고르면 글 단계로
  // 잡지 속지 한 장(남은 자리 가운데, 잡지와 같은 비율) — 띠에 글, 안쪽에 children. 종이 고르기·글 쓰기가 같이 쓴다
  const onPage = (ribbon: string, children: React.ReactNode) => (
    <View
      style={{ flex: 1, overflow: 'hidden' }}
      onLayout={(ev) => setPageBox(ev.nativeEvent.layout)}
    >
      {/* 속지는 자리보다 클 수 있다 — 겹쳐 그려(absolute) 버튼 줄·서랍·[다음]을 밀어내지 않고 아래만 가려지게 */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: ((pageBox.width || L.width) - pageW) / 2,
          width: pageW,
          height: pageH,
        }}
      >
        <Image
          source={MAGAZINE_UI.page}
          resizeMode="stretch"
          style={{ position: 'absolute', width: pageW, height: pageH }}
        />
        <Txt
          accessibilityRole="header"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: pageH * R.ribbonTop,
            height: pageH * R.ribbonHeight,
            lineHeight: pageH * R.ribbonHeight,
            textAlign: 'center',
            fontWeight: '700',
          }}
        >
          {ribbon}
        </Txt>
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: pageH * R.insetTop,
            height: pageInnerH,
          }}
        >
          {children}
        </View>
      </View>
    </View>
  );
  const framePage = onPage(
    t('magazine.editor.framePrompt'),
    <ScrollView
      testID="promotion-frames"
      style={{ flex: 1 }}
      contentContainerStyle={{
        // 종이가 적어 속지 안에 다 들어가면 위아래 가운데에 둔다
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[3],
        paddingVertical: space[2],
      }}
      showsVerticalScrollIndicator={false}
    >
      {Object.keys(MAGAZINE_FRAMES).map((id) => {
        const on = chosenFrame === id;
        const lockedFrame = !owned(id);
        return (
          <Pressable
            key={id}
            testID={`frame-${id}`}
            accessibilityRole="button"
            accessibilityLabel={t('magazine.editor.frameA11y', { name: assetName(id) })}
            accessibilityState={{ selected: on, disabled: !canEdit || lockedFrame }}
            disabled={!canEdit || lockedFrame}
            onPress={() => {
              setChosenFrame(id);
              edit({ ...layout, frameId: id });
              setStep('text');
            }}
            style={{
              padding: space[1],
              borderRadius: semanticTokens.radius.control,
              borderWidth: semanticTokens.stroke.strong,
              borderColor: on ? semanticTokens.color.outline : 'transparent',
              opacity: lockedFrame ? componentTokens.button.disabledOpacity : 1,
            }}
          >
            <Image
              source={MAGAZINE_FRAMES[id].source}
              resizeMode="stretch"
              style={{ width: cellW, height: cellW * CELL_ASPECT }}
            />
          </Pressable>
        );
      })}
    </ScrollView>,
  );

  // 2단계 — 속지 가운데의 고른 종이. 칸 안 한 줄 글 자리를 누르면 바로 키보드가 뜬다(Figma C1 원안). 들어오면 커서를 둔다
  const textPage = onPage(
    t('magazine.reader.title'),
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[2] }}>
      <Pressable
        testID="promotion-text-cell"
        accessible={false}
        onPress={() => bodyRef.current?.focus()}
        style={{ width: cellW }}
      >
        <AdCell
          testID="promotion-cell"
          width={cellW}
          hideMeta
          cell={{ ...facts, body: body.trim(), layout }}
          bodyInput={(style) => (
            <NativeTextInput
              ref={bodyRef}
              testID="promotion-body"
              accessibilityLabel={t('magazine.editor.body')}
              value={body}
              editable={canEdit}
              autoFocus
              multiline
              allowFontScaling={false}
              lineBreakStrategyIOS="hangul-word"
              submitBehavior="blurAndSubmit"
              returnKeyType="done"
              onSubmitEditing={toStickers}
              placeholder={t('magazine.editor.bodyPlaceholder')}
              placeholderTextColor={componentTokens.input.placeholder}
              onChangeText={changeBody}
              style={[style, { padding: 0, textAlignVertical: 'top' }]}
            />
          )}
        />
      </Pressable>
      <View
        style={{
          width: cellW,
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: space[2],
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
    </View>,
  );

  // 3단계 — 속지 가운데 칸에 스티커를 붙인다. 아래로 고른 꾸미기 버튼 줄과 서랍(고정 높이)
  const content = (
    <View style={{ flex: 1 }}>
      {onPage(
        t('magazine.reader.title'),
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View
            testID="promotion-canvas"
            {...gestures}
            style={{ width: cellW + pad.x * 2, height: cellH + pad.y * 2 }}
          >
            <View pointerEvents="none" style={{ position: 'absolute', left: pad.x, top: pad.y }}>
              <AdCell
                testID="promotion-cell"
                width={cellW}
                hideMeta
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
                style={{
                  position: 'absolute',
                  left: pad.x + cellW * 0.6,
                  top: pad.y + cellH * 0.3,
                }}
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
        </View>,
      )}
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
                title={t(`magazine.editor.op.${op}`)}
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
            {readOnly ? t('magazine.editor.locked') : null}
          </Txt>
        )}
      </View>
      {editable ? (
        <View
          pointerEvents={canEdit ? 'auto' : 'none'}
          style={{
            height: componentTokens.promotionEditor.drawerMinHeight,
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
            full={layout.stickers.length >= MAX_STICKERS}
            owned={owned}
            tapeId={layout.tape?.assetId ?? null}
            onSticker={addOne}
            onTape={putTape}
            onFull={() => e.notify(t('magazine.editor.stickersFull'))}
          />
        </View>
      ) : null}
    </View>
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
          onPress={() => (editor.next ? send() : setConfirming(true))}
        />
      </View>
      {/* 평소에는 잔액·안내 줄을 두지 않는다(10/15 — 가격은 싣기 확인창에서). 버튼이 꺼진 이유만 알린다 */}
      {readOnly || poor || editor.privateIsland ? (
        <Txt kind="meta" style={{ textAlign: 'center' }}>
          {`${t('magazine.editor.balance', { fish: formatNumber(editor.balance) })} · ${note}`}
        </Txt>
      ) : null}
    </View>
  );

  const bottom = { paddingBottom: L.insets.bottom + semanticTokens.spacing.control };
  if (editable && step === 'frame') return shell(framePage, <View style={bottom} />);
  if (editable && step === 'text')
    return shell(
      textPage,
      <View
        style={[
          bottom,
          {
            paddingHorizontal: page,
            paddingTop: semanticTokens.spacing.control,
          },
        ]}
      >
        <Btn
          id="promotion-next"
          dynamicHeight
          title={t('magazine.editor.next')}
          disabled={!canEdit || !body.trim()}
          onPress={toStickers}
        />
      </View>,
    );
  return shell(content, footer);
}
