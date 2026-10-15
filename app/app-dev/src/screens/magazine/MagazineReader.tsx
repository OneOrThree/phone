import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Btn } from '@/design-system/patterns';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { ApiError } from '@/services/api/client';
import type {
  MagazineCell,
  MagazineEditorial,
  MagazineIsland,
  MagazineIssue,
} from '@/services/api/magazine';
import { t } from '@/i18n';
import { formatDuration } from '@/i18n/format';
import { T, useGowun } from '@/screens/island/sceneKit';
import { ISLAND_STAGE_ART, MAGAZINE_UI, islandStage } from '@/constants/magazineAssets';
import { useAppLayout } from '@/utils/layout';
import { AdCell } from './AdCell';
import { islandTitle } from './islandTitle';
import { CELL_ASPECT } from './layout';
import { magazineApi } from './usePromotionEditor';
import { cachedMagazineToday, sendReceipt } from './useMagazineToday';
import { PromotionReportSheet } from './PromotionReportSheet';
import { CANVAS_PAD } from './useStickerGestures';

const R = componentTokens.magazineReader;
const PER_PAGE = 3;
const NAV_H = R.navHeight;
const COVER_H = R.coverHeight;
const TIP_COUNT = 14;

type Page =
  | { kind: 'editorial'; editorial: MagazineEditorial }
  | { kind: 'cells'; cells: MagazineCell[] }
  | { kind: 'empty' }
  | { kind: 'end' };

type Loaded = {
  issue: MagazineIssue;
  editorial: MagazineEditorial | null;
  cells: MagazineCell[];
  nextCursor: string | null;
};

/**
 * 속지 배치 — 속지는 그림 비율 그대로 화면 안에 가장 크게. 지면(표지 띠 아래 ~ 쪽 넘김 줄 위)은 쪽 넘김 줄과 겹치지 않는다:
 * 가로 화면처럼 속지가 낮으면 아래 여백(insetBottom)보다 넘김 줄이 먼저 닿으므로 둘 중 위쪽에서 끝낸다. 칸 3개는 지면 높이에 맞춘다.
 * 지면은 가로로 넘기는 목록이라 그 밖은 잘린다 — 꾸미기가 걸치는 칸 둘레(CANVAS_PAD)도 지면 안에 들게 칸을 그만큼 줄이고,
 * 첫 칸 위에 cellPad 를 비운다(첫 칸 위·마지막 칸 아래·좌우에서 꾸미기가 잘리지 않게).
 */
export function readerGeometry(L: {
  width: number;
  height: number;
  insets: { top: number; bottom: number; left: number; right: number };
}) {
  const availW = L.width - L.insets.left - L.insets.right - R.screenMargin * 2;
  const availH = L.height - L.insets.top - L.insets.bottom - R.screenMargin * 2;
  const W = Math.min(availW, availH * R.pageAspect, R.maxPageWidth);
  const H = W / R.pageAspect;
  const innerW = W * (1 - R.insetX * 2);
  const navTop = H * (1 - R.navBottom) - NAV_H;
  const contentBottom = Math.min(H * (1 - R.insetBottom), navTop - R.cellGap);
  const innerH = contentBottom - H * R.insetTop - COVER_H;
  const cellW = Math.min(
    innerW / (1 + CANVAS_PAD * 2),
    (innerH - R.cellGap * 2) / ((PER_PAGE + CANVAS_PAD * 2) * CELL_ASPECT),
  );
  const cellPad = CANVAS_PAD * cellW * CELL_ASPECT;
  return { W, H, innerW, innerH, cellW, cellPad, navTop, contentBottom };
}

/** 「2026-10-14」 → 「10월 14일」 */
export const issueDateText = (date: string) => {
  const [, m, d] = date.split('-').map(Number);
  return t('magazine.reader.date', { m, d });
};

/**
 * 지면 순서 — 첫 장 편집부(있으면) → 홍보 칸 3개씩 → (칸이 하나도 없으면) 「오늘은 실린 홍보가 없어요」 → (섬장만) 끝 장(홍보는 마을회관에서 쓴다는 안내).
 * 커서가 남아 있으면 끝 장은 아직 붙이지 않는다(다음 칸을 다 읽은 뒤).
 */
export function magazinePages(loaded: Loaded, host: boolean): Page[] {
  const pages: Page[] = [];
  if (loaded.editorial) pages.push({ kind: 'editorial', editorial: loaded.editorial });
  for (let i = 0; i < loaded.cells.length; i += PER_PAGE)
    pages.push({ kind: 'cells', cells: loaded.cells.slice(i, i + PER_PAGE) });
  if (!loaded.nextCursor) {
    if (!loaded.cells.length) pages.push({ kind: 'empty' });
    if (host) pages.push({ kind: 'end' });
  }
  return pages;
}

/**
 * 고양이 잡지 펼치기(GROMO-2289 · A1~A4) — 섬에서 펼친 잡지라 배경은 섬 홈이고 칸에 망원경 동그라미가 없다(10/14 확정).
 * 우리 섬 칸에는 「우리 섬이에요」. 속지 그림 위에 표지 띠(날짜·호)와 쪽을 그리고, 가로로 넘기거나 ‹ › 로 넘긴다.
 * 끝 쪽에 가까워지면 다음 커서를 읽는다. 펼치는 데 성공하면 그 호에 「읽음」을 보낸다(빨간 점이 꺼진다).
 * 칸을 누르면 화면 폭으로 크게 본다. 칸을 길게 누르거나(크게 보기에서도) 스크린리더 「신고하기」 동작으로 신고 시트를 연다(SAFE-04) —
 * 신고한 칸은 다음에 읽을 때까지 그대로 보인다(서버가 3건이면 숨긴다).
 *
 * e.detail = 펼칠 호 id. 비어 있으면 들고 있는 오늘 호를 연다.
 */
export function MagazineReader({
  e,
  host = false,
  background,
}: {
  e: any;
  /** 내 섬 섬장이면 끝 쪽에 「우리 섬도 실어 볼까요?」 안내 — 쓰기 입구는 마을회관에만 있다(10/14). */
  host?: boolean;
  background?: React.ReactNode;
}) {
  const L = useAppLayout();
  const font = useGowun();
  const issueId: string | null = e.detail || cachedMagazineToday()?.issue?.issueId || null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'gone'>('loading');
  const [nonce, setNonce] = useState(0);
  const [more, setMore] = useState(false);
  // 이어 읽기에 실패한 커서 — 같은 쪽에 머무는 동안 다시 부르지 않고, 쪽을 넘기면 다시 시도한다
  const [failedAt, setFailedAt] = useState<{ cursor: string; index: number } | null>(null);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState<MagazineCell | null>(null);
  const [report, setReport] = useState<MagazineCell | null>(null);
  // 크게 보기에서 길게 누른 칸 — iOS 는 크게 보기(Modal)가 다 닫힌 뒤에 신고 시트(Modal)를 연다(닫히는 중에 띄우면 실패한다)
  const reportAfterZoom = useRef<MagazineCell | null>(null);
  const list = useRef<FlatList<Page>>(null);

  useEffect(() => {
    if (!issueId) {
      setStatus('gone');
      return;
    }
    let alive = true;
    setStatus('loading');
    magazineApi()
      .getMagazineIssue(issueId)
      .then((page) => {
        if (!alive) return;
        setLoaded(page);
        setIndex(0);
        setStatus('ready');
        // 섬에서 펼쳤다 — 받은 적 없는 호면 받음도 같이 적힌다. 실패해도 읽기는 그대로 둔다(다음에 펼칠 때 다시 보낸다)
        sendReceipt(issueId, { place: 'ISLAND', opened: true }).catch(() => {});
      })
      .catch((err) => {
        if (!alive) return;
        setStatus(
          err instanceof ApiError && err.code === 'MAGAZINE_ISSUE_NOT_FOUND' ? 'gone' : 'error',
        );
      });
    return () => {
      alive = false;
    };
  }, [issueId, nonce]);

  const pages = loaded ? magazinePages(loaded, host) : [];
  const cursor = loaded?.nextCursor ?? null;
  // 마지막 쪽(또는 그 앞 쪽)에 오면 다음 칸을 읽어 붙인다
  useEffect(() => {
    if (!issueId || !cursor || more || index < pages.length - 2) return;
    if (failedAt?.cursor === cursor && failedAt.index === index) return;
    setMore(true);
    magazineApi()
      .getMagazineIssue(issueId, cursor)
      .then((next) =>
        setLoaded((prev) =>
          prev && prev.nextCursor === cursor
            ? { ...prev, cells: [...prev.cells, ...next.cells], nextCursor: next.nextCursor }
            : prev,
        ),
      )
      .catch(() => setFailedAt({ cursor, index }))
      .finally(() => setMore(false));
  }, [issueId, cursor, more, index, pages.length, failedAt]);

  const { W, H, innerW, innerH, cellW, cellPad } = readerGeometry(L);
  const largeText = L.fontScale >= R.largeTextThreshold;
  const text = (size: number, color: string = semanticTokens.color.text) => ({
    fontFamily: font,
    fontSize: size,
    lineHeight: size * 1.35,
    color,
  });

  const go = useCallback(
    (next: number) => {
      const to = Math.max(0, Math.min(pages.length - 1, next));
      setIndex(to);
      list.current?.scrollToOffset({ offset: to * innerW, animated: true });
    },
    [pages.length, innerW],
  );
  const onScrollEnd = (ev: NativeSyntheticEvent<NativeScrollEvent>) =>
    setIndex(Math.round(ev.nativeEvent.contentOffset.x / innerW));
  // 회전 등으로 쪽 폭이 바뀌면 보던 쪽에 다시 맞춘다(옛 폭의 오프셋이 남아 쪽 사이에 걸리지 않게)
  const indexRef = useRef(index);
  indexRef.current = index;
  useEffect(() => {
    list.current?.scrollToOffset({ offset: indexRef.current * innerW, animated: false });
  }, [innerW]);
  // 쪽이 바뀌면 스크린리더에 알린다(처음 펼칠 때는 표지 띠를 읽으므로 건너뛴다)
  const announced = useRef(false);
  const pageLabel = t(cursor ? 'magazine.reader.pageA11yMore' : 'magazine.reader.pageA11y', {
    page: index + 1,
    total: pages.length,
  });
  useEffect(() => {
    if (!announced.current) {
      announced.current = true;
      return;
    }
    AccessibilityInfo.announceForAccessibility(pageLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 쪽이 바뀔 때만 알린다(이어 읽어 전체 쪽 수가 늘 때는 알리지 않는다)
  }, [index]);

  const avatar = (island: MagazineIsland, size: number) => (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: semanticTokens.color.secondary,
        borderWidth: semanticTokens.stroke.subtle,
        borderColor: semanticTokens.color.outline,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Image
        source={ISLAND_STAGE_ART[islandStage(island.memberCount, island.buildingCount)]}
        resizeMode="contain"
        style={{ width: size * 1.3, height: size * 1.3 }}
      />
    </View>
  );
  // 섬 이름(두 줄까지) + 오른쪽 숫자. 큰 글자에서는 숫자를 이름 아래 줄로 내려 속지 밖으로 밀리지 않게 한다
  const islandLine = (name: string, meta: string) => (
    <View
      style={{
        flex: 1,
        flexDirection: largeText ? 'column' : 'row',
        alignItems: largeText ? 'flex-start' : 'center',
        gap: largeText ? 0 : primitiveTokens.space[2],
      }}
    >
      <T numberOfLines={2} style={[text(14), largeText ? null : { flex: 1 }]}>
        {name}
      </T>
      <T style={text(11, semanticTokens.color.textMuted)}>{meta}</T>
    </View>
  );
  const average = (island: MagazineIsland) =>
    island.averageFocusMinutesPerDay == null
      ? t('magazine.cell.averageUnknown')
      : t('magazine.cell.average', { time: formatDuration(island.averageFocusMinutesPerDay * 60) });
  const card = (tint: string, children: React.ReactNode) => (
    <View
      style={{
        backgroundColor: tint,
        borderWidth: semanticTokens.stroke.default,
        borderColor: semanticTokens.color.outline,
        borderRadius: R.cardRadius,
        paddingVertical: primitiveTokens.space[2],
        paddingHorizontal: semanticTokens.spacing.control,
      }}
    >
      {children}
    </View>
  );
  const emptyLine = (key: string) => (
    <T
      style={[
        text(13, semanticTokens.color.textMuted),
        { paddingVertical: primitiveTokens.space[2], textAlign: 'center' },
      ]}
    >
      {t(key)}
    </T>
  );

  const editorialPage = (ed: MagazineEditorial) => {
    const tip = ed.note.tipNo != null && ed.note.tipNo >= 0 ? ed.note.tipNo % TIP_COUNT : 0;
    const note =
      ed.note.type === 'EDITOR' && ed.note.body ? ed.note.body : t(`magazine.tips.${tip}`);
    const bannerW = Math.min(innerW, R.bannerMaxWidth);
    const bannerH = bannerW * (175 / 630);
    return (
      <ScrollView
        testID="magazine-editorial"
        style={{ width: innerW }}
        contentContainerStyle={{
          gap: primitiveTokens.space[2],
          paddingBottom: primitiveTokens.space[2],
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignSelf: 'center', width: bannerW, height: bannerH }}>
          <Image
            source={MAGAZINE_UI.bannerRanking}
            resizeMode="stretch"
            style={{ position: 'absolute', left: 0, top: 0, width: bannerW, height: bannerH }}
          />
          <T
            accessibilityRole="header"
            maxFontSizeMultiplier={R.fixedTextMaxScale}
            style={[
              text(15),
              { position: 'absolute', left: 0, right: 0, top: '34%', textAlign: 'center' },
            ]}
          >
            {t('magazine.reader.ranking')}
          </T>
        </View>
        {card(
          R.rankingTint,
          ed.ranking.length
            ? ed.ranking.map((row) => (
                <View
                  key={row.islandId}
                  testID={`magazine-rank-${row.rank}`}
                  accessible
                  accessibilityLabel={t('magazine.reader.rankA11y', {
                    rank: row.rank,
                    name: islandTitle(row.name),
                    average: average(row),
                  })}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: primitiveTokens.space[2],
                    minHeight: R.rowMinHeight,
                  }}
                >
                  {row.rank <= 3 ? (
                    <Image
                      source={MAGAZINE_UI.medals[row.rank - 1]}
                      resizeMode="contain"
                      style={R.medal}
                    />
                  ) : (
                    <T style={[text(14), { width: R.medal.width, textAlign: 'center' }]}>
                      {row.rank}
                    </T>
                  )}
                  {avatar(row, R.rankAvatar)}
                  {islandLine(islandTitle(row.name), average(row))}
                </View>
              ))
            : emptyLine('magazine.reader.rankingEmpty'),
        )}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: primitiveTokens.space[2],
            marginTop: primitiveTokens.space[1],
          }}
        >
          <Image source={MAGAZINE_UI.tagNew} resizeMode="contain" style={R.tagNew} />
          <T accessibilityRole="header" style={text(14)}>
            {t('magazine.reader.newIslands')}
          </T>
        </View>
        {card(
          R.newTint,
          ed.newIslands.length
            ? ed.newIslands.map((island) => (
                <View
                  key={island.islandId}
                  testID="magazine-new-island"
                  accessible
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: primitiveTokens.space[2],
                    minHeight: R.rowMinHeight,
                  }}
                >
                  {avatar(island, R.newAvatar)}
                  {islandLine(
                    islandTitle(island.name),
                    t('magazine.cell.residents', {
                      count: island.memberCount,
                      max: island.maxMembers,
                    }),
                  )}
                </View>
              ))
            : emptyLine('magazine.reader.newIslandsEmpty'),
        )}
        {card(
          R.noteTint,
          <View
            testID="magazine-note"
            accessible
            style={{ flexDirection: 'row', alignItems: 'center', gap: primitiveTokens.space[2] }}
          >
            <Image source={MAGAZINE_UI.editorCat} resizeMode="contain" style={R.noteCat} />
            <View style={{ flex: 1, gap: primitiveTokens.space[1] }}>
              <T style={text(14)}>
                {t(
                  ed.note.type === 'EDITOR' && ed.note.body
                    ? 'magazine.reader.editorNote'
                    : 'magazine.reader.tipNote',
                )}
              </T>
              <T
                lineBreakStrategyIOS="hangul-word"
                style={text(12, semanticTokens.color.textMuted)}
              >
                {note}
              </T>
            </View>
          </View>,
        )}
      </ScrollView>
    );
  };

  const renderPage = ({ item }: { item: Page }) => {
    if (item.kind === 'editorial') return editorialPage(item.editorial);
    if (item.kind === 'cells')
      return (
        <View
          testID="magazine-cells"
          style={{ width: innerW, alignItems: 'center', gap: R.cellGap, paddingTop: cellPad }}
        >
          {item.cells.map((cell) => (
            <AdCell
              key={cell.promotionId}
              testID={`magazine-cell-${cell.promotionId}`}
              width={cellW}
              cell={cell}
              // 섬에서 펼친 잡지에는 망원경 동그라미가 없다(10/14) — 우리 섬 배지만
              corner={cell.relation === 'MEMBER' ? 'ours' : null}
              onPress={() => setZoom(cell)}
              // 우리 섬 칸은 신고하지 않는다(길게 누르기·스크린리더 동작 모두 없음)
              onReport={cell.relation === 'MEMBER' ? undefined : () => setReport(cell)}
            />
          ))}
        </View>
      );
    return (
      <View
        testID={item.kind === 'empty' ? 'magazine-empty' : 'magazine-end'}
        style={{
          width: innerW,
          alignItems: 'center',
          justifyContent: 'center',
          gap: semanticTokens.spacing.control,
        }}
      >
        <Image source={MAGAZINE_UI.editorCat} resizeMode="contain" style={R.emptyCat} />
        <T style={[text(16), { textAlign: 'center' }]}>
          {t(item.kind === 'empty' ? 'magazine.reader.noCells' : 'magazine.reader.endTitle')}
        </T>
        {item.kind === 'end' && (
          // 쓰기 입구는 마을회관에만 있다(10/14) — 끝 장은 어디서 쓰는지 알려 주기만 한다
          <T
            lineBreakStrategyIOS="hangul-word"
            style={[text(12, semanticTokens.color.textMuted), { textAlign: 'center' }]}
          >
            {t('magazine.reader.endBody')}
          </T>
        )}
      </View>
    );
  };

  const issue = loaded?.issue;
  const total = pages.length;
  const pageText = t(cursor ? 'magazine.reader.pageMore' : 'magazine.reader.page', {
    page: index + 1,
    total,
  });
  // 이어 읽기가 실패해 멈춘 끝 쪽 — 쪽 번호 자리에 「더 불러오지 못했어요 · 다시」를 둔다
  const moreFailed = !!cursor && failedAt?.cursor === cursor && !more;
  const arrow = (dir: -1 | 1) => {
    const disabled = dir < 0 ? index <= 0 : index >= total - 1;
    return (
      <Pressable
        testID={dir < 0 ? 'magazine-prev' : 'magazine-next'}
        accessibilityRole="button"
        accessibilityLabel={t(dir < 0 ? 'magazine.reader.prev' : 'magazine.reader.next')}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => go(index + dir)}
        hitSlop={8}
        style={{
          width: semanticTokens.size.tapMin,
          height: NAV_H,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.3 : 1,
        }}
      >
        <T maxFontSizeMultiplier={R.fixedTextMaxScale} style={text(18)}>
          {dir < 0 ? '‹' : '›'}
        </T>
      </Pressable>
    );
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flex: 1 }}
      >
        {background}
      </View>
      <View
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: componentTokens.overlay.background,
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: L.insets.top,
          paddingBottom: L.insets.bottom,
        }}
      >
        <Pressable
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          onPress={e.back}
          style={StyleSheet.absoluteFill}
        />
        <View testID="magazine-reader" accessibilityViewIsModal style={{ width: W, height: H }}>
          <Image source={MAGAZINE_UI.page} resizeMode="stretch" style={{ width: W, height: H }} />
          <T
            allowFontScaling={false}
            style={[
              text(H * R.ribbonHeight * 0.5),
              {
                position: 'absolute',
                left: 0,
                right: 0,
                top: H * R.ribbonTop,
                height: H * R.ribbonHeight,
                lineHeight: H * R.ribbonHeight,
                textAlign: 'center',
              },
            ]}
          >
            {t('magazine.reader.title')}
          </T>
          <View
            style={{
              position: 'absolute',
              left: W * R.insetX,
              top: H * R.insetTop,
              width: innerW,
              height: innerH + COVER_H,
            }}
          >
            {issue && (
              <T
                testID="magazine-cover"
                maxFontSizeMultiplier={R.fixedTextMaxScale}
                accessibilityLabel={t('magazine.reader.coverA11y', {
                  no: issue.issueNo,
                  date: issueDateText(issue.issueDate),
                })}
                style={[
                  text(12, semanticTokens.color.textMuted),
                  { height: COVER_H, textAlign: 'center' },
                ]}
              >
                {t('magazine.reader.cover', {
                  no: issue.issueNo,
                  date: issueDateText(issue.issueDate),
                })}
              </T>
            )}
            {status === 'ready' ? (
              <FlatList
                ref={list}
                testID="magazine-pages"
                style={{ marginTop: issue ? 0 : COVER_H }}
                data={pages}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={(page, i) => `${page.kind}-${i}`}
                renderItem={renderPage}
                getItemLayout={(_, i) => ({ length: innerW, offset: innerW * i, index: i })}
                onMomentumScrollEnd={onScrollEnd}
              />
            ) : (
              <View
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: semanticTokens.spacing.control,
                  marginTop: issue ? 0 : COVER_H,
                }}
              >
                {status === 'loading' ? (
                  <>
                    <ActivityIndicator color={semanticTokens.color.outline} />
                    <T style={text(13, semanticTokens.color.textMuted)}>
                      {t('magazine.reader.loading')}
                    </T>
                  </>
                ) : (
                  <>
                    <T testID="magazine-problem" style={[text(15), { textAlign: 'center' }]}>
                      {t(status === 'gone' ? 'magazine.reader.gone' : 'magazine.reader.loadFailed')}
                    </T>
                    {status === 'error' ? (
                      <Btn
                        id="magazine-retry"
                        small
                        kind="sec"
                        title={t('common.retry')}
                        onPress={() => setNonce((n) => n + 1)}
                      />
                    ) : (
                      <Btn small kind="sec" title={t('common.ok')} onPress={e.back} />
                    )}
                  </>
                )}
              </View>
            )}
          </View>
          {status === 'ready' && (total > 1 || moreFailed) && (
            <View
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: H * R.navBottom,
                height: NAV_H,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {arrow(-1)}
              {moreFailed ? (
                <Pressable
                  testID="magazine-more-retry"
                  accessibilityRole="button"
                  onPress={() => setFailedAt(null)}
                  hitSlop={8}
                  style={{ minHeight: semanticTokens.size.tapMin, justifyContent: 'center' }}
                >
                  <T
                    maxFontSizeMultiplier={R.fixedTextMaxScale}
                    style={text(12, semanticTokens.color.danger)}
                  >
                    {t('magazine.reader.moreFailed')}
                  </T>
                </Pressable>
              ) : (
                <T
                  testID="magazine-page"
                  maxFontSizeMultiplier={R.fixedTextMaxScale}
                  accessibilityLabel={pageLabel}
                  accessibilityLiveRegion="polite"
                  style={[
                    text(13, semanticTokens.color.textMuted),
                    { minWidth: R.pageNumberMinWidth, textAlign: 'center' },
                  ]}
                >
                  {pageText}
                </T>
              )}
              {arrow(1)}
            </View>
          )}
          <Pressable
            testID="magazine-close"
            accessibilityRole="button"
            accessibilityLabel={t('magazine.reader.close')}
            onPress={e.back}
            hitSlop={6}
            style={{
              position: 'absolute',
              right: R.closeOffset,
              top: R.closeOffset,
              width: semanticTokens.size.tapMin,
              height: semanticTokens.size.tapMin,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Image
              source={MAGAZINE_UI.close}
              resizeMode="contain"
              style={{ width: R.closeArt, height: R.closeArt }}
            />
          </Pressable>
        </View>
      </View>
      <Modal
        visible={!!zoom}
        transparent
        animationType="fade"
        onRequestClose={() => setZoom(null)}
        onDismiss={() => {
          if (reportAfterZoom.current) setReport(reportAfterZoom.current);
          reportAfterZoom.current = null;
        }}
      >
        <Pressable
          testID="magazine-zoom"
          accessibilityRole="button"
          accessibilityLabel={t('magazine.reader.zoomClose')}
          onPress={() => setZoom(null)}
          style={{
            flex: 1,
            backgroundColor: componentTokens.overlay.cinematicBackground,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {zoom && (
            // 꾸미기가 걸치는 칸 둘레(CANVAS_PAD)까지 화면 안에 들게 그만큼 작게
            <AdCell
              width={Math.min(
                (L.width - semanticTokens.spacing.component * 2) / (1 + CANVAS_PAD * 2),
                (L.height - L.insets.top - L.insets.bottom - semanticTokens.spacing.component * 2) /
                  ((1 + CANVAS_PAD * 2) * CELL_ASPECT),
                R.maxPageWidth,
              )}
              cell={zoom}
              corner={zoom.relation === 'MEMBER' ? 'ours' : null}
              onPress={() => setZoom(null)}
              onReport={
                zoom.relation === 'MEMBER'
                  ? undefined
                  : () => {
                      if (Platform.OS === 'ios') reportAfterZoom.current = zoom;
                      else setReport(zoom);
                      setZoom(null);
                    }
              }
            />
          )}
        </Pressable>
      </Modal>
      <PromotionReportSheet
        cell={report}
        onClose={() => setReport(null)}
        onDone={(message) => {
          setReport(null);
          e.notify?.(message);
        }}
        offerConversion={e.conversion?.offer}
      />
    </View>
  );
}
