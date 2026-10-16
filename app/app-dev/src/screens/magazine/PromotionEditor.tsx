import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityActionEvent,
  ActivityIndicator,
  BackHandler,
  Image,
  Keyboard,
  TextInput as NativeTextInput,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { Btn, CharCount, Chevron, Overlay, Txt } from '@/design-system/patterns';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { art } from '@/constants/art';
import {
  DEFAULT_FRAME_ID,
  MAGAZINE_FRAMES,
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
  step: (step: EditorStep) => void;
  submit: () => void;
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
/** 고른 꾸미기 왼쪽 위 ✕(지우기) 지름 — 누르는 자리는 hitSlop 으로 44pt */
const DELETE_SIZE = 26;
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
  // 싣기 전 가격 안내창
  const [confirming, setConfirming] = useState(false);
  // 이미 올린 홍보로 들어오면 고칠지 먼저 묻는다(10/15) — [취소]는 회관으로
  const [askEdit, setAskEdit] = useState(false);
  const touched = useRef(false);

  // 처음 불러온 칸(다음 호 → 지난번 칸 → 빈 칸)으로 연다. 사용자가 고치기 시작한 뒤 다시 읽어도 고친 것은 두고 모드만 바꾼다.
  // 단 마감(자정)으로 읽기 전용이 되면 저장 안 한 고친 것은 실리지 않는다 — 서버에 남은(잡지에 실릴) 칸으로 되돌린다
  useEffect(() => {
    if (!editor) return;
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
    if (!opened.current && editor.next && !locked) setAskEdit(true);
    if (locked) setAskEdit(false);
    opened.current = true;
  }, [editor]);

  const edit = (next: PromotionLayout) => {
    touched.current = true;
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
  // 안드로이드 하드웨어 뒤로가기도 같은 순서 — 나중에 단 리스너가 먼저 받으므로 App 의 처리보다 앞선다.
  // 확인창이 떠 있으면 단계보다 확인창의 [취소]가 먼저다(고치기 확인창은 회관으로, 싣기 확인창은 닫기)
  useEffect(() => {
    if (!backStep && !askEdit && !confirming) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (askEdit) e.back();
      else if (confirming) setConfirming(false);
      else if (backStep) setStep(backStep);
      return true;
    });
    return () => sub.remove();
  }, [backStep, askEdit, confirming, e]);
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

  const changeBody = (text: string) => {
    // 한 줄 글 — 서버는 줄바꿈·탭 같은 제어 문자와 U+2028·U+2029 를 거절한다(400). 붙여 넣은 것은 띄어쓰기로 바꾸고,
    // 길이는 서버처럼 코드포인트로 자른다
    touched.current = true;
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
    if (layoutProblem(layout)) return e.notify(t('magazine.editor.problem.layout'));
    setProblem(null);
    const result = await submit({ body: trimmed, layout });
    if ('ok' in result) {
      setSelection(null);
      // 싣거나(물고기를 냈으면) 고쳐 저장하면 회관으로 돌아간다(10/15) — 알림은 토스트 한 줄
      e.notify(t(result.ok === 'updated' ? 'magazine.editor.saved' : 'magazine.editor.doneTitle'));
      e.back();
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
        accessibilityElementsHidden={confirming || askEdit}
        importantForAccessibility={confirming || askEdit ? 'no-hide-descendants' : 'auto'}
      >
        {header}
        {content}
        {footer}
      </View>
      {askEdit && (
        <Overlay close={e.back}>
          <Txt kind="h17">{t('magazine.editor.editAsk')}</Txt>
          <View style={{ flexDirection: 'row', gap: semanticTokens.spacing.control }}>
            <Btn
              id="promotion-edit-cancel"
              kind="sec"
              style={{ flex: 1 }}
              title={t('common.cancel')}
              onPress={e.back}
            />
            <Btn
              id="promotion-edit-ok"
              style={{ flex: 1 }}
              title={t('magazine.editor.editOk')}
              onPress={() => setAskEdit(false)}
            />
          </View>
        </Overlay>
      )}
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
  // 종이 아래 [완료](10/15) — 처음 싣기면 가격 확인창, 이미 낸 홍보면 바로 저장. 신청 창이 닫힌 00~07시는 그 안내로
  const ctaTitle = closed ? t('magazine.editor.whenClosed') : t('magazine.editor.done');
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
  // 점선 상자의 (sx, sy) 모서리(-1 = 왼쪽·위)를 꾸미기 회전만큼 돌린 자리 — ✕ 버튼 가운데가 그 점에 오게
  const cornerOf = (b: NonNullable<typeof box>, sx: number, sy: number) => {
    const inset = componentTokens.promotionEditor.selectionInset;
    const lx = sx * (b.hw + inset);
    const ly = sy * (b.hh + inset);
    const r = (b.rotation * Math.PI) / 180;
    // 가장자리 꾸미기는 모서리가 판 밖일 수 있다 — 판 밖은 터치가 오지 않으니 누르는 범위(44pt)째 판 안으로 끌어들인다
    const slop = (semanticTokens.size.tapMin - DELETE_SIZE) / 2;
    const clamp = (n: number, hi: number) => Math.min(hi - DELETE_SIZE - slop, Math.max(slop, n));
    return {
      left: clamp(
        pad.x + b.cx + lx * Math.cos(r) - ly * Math.sin(r) - DELETE_SIZE / 2,
        cellW + pad.x * 2,
      ),
      top: clamp(
        pad.y + b.cy + lx * Math.sin(r) + ly * Math.cos(r) - DELETE_SIZE / 2,
        cellH + pad.y * 2,
      ),
    };
  };
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

  const space = primitiveTokens.space;
  // 1단계 — 종이(칸 틀) 고르기. 잡지 속지 위 가운데에 빈 종이를 한 장씩 크게 두고 세로로 밀어 고른다. 고르면 글 단계로
  // 잡지 속지 한 장(남은 자리 가운데, 잡지와 같은 비율) — 띠에 글, 안쪽에 children. 종이 고르기·글 쓰기가 같이 쓴다
  const onPage = (ribbon: string, children: React.ReactNode, height?: number) => (
    <View
      style={height ? { height, overflow: 'hidden' } : { flex: 1, overflow: 'hidden' }}
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
      <Btn
        id="promotion-next"
        style={{ width: cellW }}
        dynamicHeight
        title={t('magazine.editor.next')}
        disabled={!canEdit || !body.trim()}
        onPress={toStickers}
      />
    </View>,
  );

  // 3단계 — 속지 가운데 칸에 스티커를 붙인다. 아래로 고른 꾸미기 버튼 줄과 서랍(고정 높이)
  // 속지는 종이와 [완료]가 들어갈 만큼만 보이고, 나머지는 스티커 서랍이 쓴다(10/15 — 서랍을 크게)
  const doneH = semanticTokens.size.tapMin + primitiveTokens.space[3];
  const stickerPageH =
    pageH * R.insetTop + cellH + pad.y * 2 + doneH + primitiveTokens.space[4] * 2;
  const content = (
    <View style={{ flex: 1 }}>
      {onPage(
        t('magazine.reader.title'),
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[2] }}>
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
            {box && canEdit && selection && (
              // 고른 꾸미기 지우기 — 점선 상자 왼쪽 위(돌린 각도 그대로)의 ✕
              <Pressable
                testID="promotion-delete"
                accessibilityRole="button"
                accessibilityLabel={`${t('magazine.editor.op.delete')}: ${itemLabel(selection)}`}
                hitSlop={(semanticTokens.size.tapMin - DELETE_SIZE) / 2}
                onPress={() => doEdit(selection, 'delete')}
                style={{
                  position: 'absolute',
                  ...cornerOf(box, -1, -1),
                  width: DELETE_SIZE,
                  height: DELETE_SIZE,
                  borderRadius: DELETE_SIZE / 2,
                  borderWidth: semanticTokens.stroke.strong,
                  borderColor: semanticTokens.color.outline,
                  backgroundColor: semanticTokens.color.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Txt style={{ fontSize: 14, lineHeight: 16, fontWeight: '800' }}>✕</Txt>
              </Pressable>
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
            {layout.stickers.map((_, i) => a11yItem({ kind: 'sticker', index: i }, `sticker-${i}`))}
            {layout.tape && a11yItem({ kind: 'tape' }, 'tape')}
          </View>
          {/* 다시 읽는 중에도 자리는 그대로(꺼짐) — 읽기 전용이면 버튼 없이 안내만 */}
          {!readOnly ? (
            <Btn
              id="promotion-submit"
              style={{ width: cellW }}
              dynamicHeight
              title={ctaTitle}
              // canEdit = 불러온 상태(다시 읽는 중 아님) · 저장 중 아님
              disabled={blocked || !canEdit}
              onPress={() => (editor.next ? send() : setConfirming(true))}
            />
          ) : null}
          {/* 버튼이 꺼진 이유만 한 줄(잔액 부족 · 비공개 섬 · 자정 지나 잠김) */}
          {readOnly || poor || editor.privateIsland ? (
            <Txt kind="meta" style={{ textAlign: 'center' }}>
              {readOnly
                ? note
                : `${t('magazine.editor.balance', { fish: formatNumber(editor.balance) })} · ${note}`}
            </Txt>
          ) : null}
        </View>,
        !readOnly ? stickerPageH : undefined,
      )}
      {!readOnly ? (
        <View
          pointerEvents={canEdit ? 'auto' : 'none'}
          style={{
            flex: 1,
            minHeight: componentTokens.promotionEditor.drawerMinHeight,
            paddingBottom: L.insets.bottom,
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

  const bottom = { paddingBottom: L.insets.bottom + semanticTokens.spacing.control };
  if (editable && step === 'frame') return shell(framePage, <View style={bottom} />);
  // 글 단계도 바닥 줄 없이 [다음]은 속지 안 종이 아래(10/15) — 키보드가 뜨면 보이는 속지 안 가운데로 같이 올라간다
  if (editable && step === 'text') return shell(textPage);
  // 스티커 단계는 바닥 줄 없이 서랍이 화면 아래까지 — 신청 거절 같은 안내는 토스트로
  return shell(content, readOnly ? <View style={bottom} /> : undefined);
}
