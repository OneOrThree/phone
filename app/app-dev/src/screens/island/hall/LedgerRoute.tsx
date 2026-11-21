import { localeTag } from '@/i18n/format';
import { art } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { errorTextOr, t } from '@/i18n';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import { BROWN, T, fill, web } from '@/design-system/sceneKit';
import {
  CARD_INK,
  MUTED,
  hallLiveIslandId,
  ledgerMockMode,
} from '@/screens/island/hall/hallShared';
import { useHallFrame } from '@/screens/island/hall/useHallFrame';
import {
  shiftMonth,
  useLedgerScreen,
  type LedgerScreenState,
  type LedgerTab,
} from '@/screens/island/useLedgerScreen';
import { State, balance, dayKey, kstMonthDay, ledgerParts, viewIsland } from '@/services/model';
import { captureProductEvent } from '@/services/posthog';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';

// 공동 가계부 장부 한 장과 잔액·적립·지출 고양이 포스트잇(GROMO-2487) — 새 그림이라 OTA 경로(src/assets/ota/)에 둔다
const ledgerArt = {
  book: require('@/assets/ota/interiors/ui/ledger-book-v2.png'),
  tabs: [
    require('@/assets/ota/interiors/ui/tab-pink.png'),
    require('@/assets/ota/interiors/ui/tab-yellow.png'),
    require('@/assets/ota/interiors/ui/tab-blue.png'),
  ],
};

// ── 052·053 공동 가계부 ──
export function LedgerRoute({ e }: ScreenProps) {
  const s: State = e.state,
    i = viewIsland(s),
    visitor = !!s.visitingIslandId,
    liveIslandId = hallLiveIslandId(e, s, i);
  const { L, land, W, H, side, g, shell } = useHallFrame(e);
  // 가계부: 서버 원장·지갑 조각이 정본이다 — 로컬 i.ledger 문자열·로컬 잔액 합산을 쓰지 않는다.
  // 방문자에게는 조회 자체를 하지 않는다(서버도 403). 리뷰·데모 모크 모드는 서버가 아예 없다 —
  // 거기서는 로컬 원장으로 그리던 기존 화면을 유지하고 API 호출은 0회다.
  const thisMonth = dayKey(e.now).slice(0, 7);
  const mockLedger = ledgerMockMode();
  const serverLedger = useLedgerScreen({
    active: !visitor && !mockLedger,
    islandId: liveIslandId ?? i.id, // URL 에 안 쓰는 값이라 타입만 지킨다
    currentMonth: thisMonth,
  });
  const [mockMonth, setMockMonth] = useState(0);
  const [mockTab, setMockTab] = useState<LedgerTab>('balance');
  // 모크 모드용 로컬 view model — 서버 모델과 같은 모양으로 맞춰 아래 렌더를 공유한다.
  // reason 자리에는 표시용 로컬 제목(l.title)을 싣는다(아래 렌더가 mockLedger 면 그대로 그린다).
  const mockLedgerState = useMemo<LedgerScreenState>(() => {
    const key = shiftMonth(thisMonth, mockMonth);
    const rows = i.ledger
      .map((l) => ({ ...l, ...ledgerParts(l) }))
      .filter((l) => l.amount !== 0 && dayKey(l.at).slice(0, 7) === key);
    const items = rows
      .filter((l) => mockTab === 'balance' || (mockTab === 'earn' ? l.amount > 0 : l.amount < 0))
      .map((l, n) => ({
        id: `local-${n}`,
        direction: (l.amount > 0 ? 'earn' : 'spend') as 'earn' | 'spend',
        reason: l.title,
        amount: Math.abs(l.amount),
        createdAt: new Date(l.at).toISOString(),
        groupedUntil: new Date(l.at).toISOString(),
        entryCount: 1,
      }));
    return {
      month: key,
      offset: mockMonth,
      canNext: mockMonth < 0,
      prevMonth: () => setMockMonth((n) => n - 1),
      nextMonth: () => setMockMonth((n) => Math.min(0, n + 1)),
      tab: mockTab,
      setTab: setMockTab,
      status: 'ready',
      error: null,
      items,
      villagePoints: balance(i),
      earnedTotal: rows.reduce((n, l) => n + Math.max(0, l.amount), 0),
      spentTotal: Math.abs(rows.reduce((n, l) => n + Math.min(0, l.amount), 0)),
      nextCursor: null,
      loadingMore: false,
      moreError: null,
      loadMore: () => {},
      retry: () => {},
      refresh: () => {},
    };
  }, [i, mockMonth, mockTab, thisMonth]);
  const ledger = mockLedger ? mockLedgerState : serverLedger;
  // 방문자에게 공동 가계부는 열리지 않는다(서버도 403) — 조회도, 빈 장부로 위장도 하지 않는다
  if (visitor) {
    return shell(
      <View
        style={{
          position: 'absolute',
          zIndex: 7,
          left: land ? side : 36,
          right: land ? side : 36,
          top: '40%',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 23.2,
          paddingHorizontal: 16,
          borderWidth: 1.9,
          borderStyle: 'dashed',
          borderColor: '#c5ad8a',
          borderRadius: 12.9,
          backgroundColor: '#fff3d8',
        }}
      >
        <T
          testID="ledger-member-only"
          style={g(16.8, 26.88, { fontWeight: '700', textAlign: 'center' })}
        >
          {t('ui.hall.residentsOnly')}
        </T>
        <T style={g(15.5, 21.7, { color: MUTED, textAlign: 'center' })}>
          {t('ui.hall.ledgerResidentsOnly')}
        </T>
      </View>,
      e.back,
    );
  }
  const [ledgerYear, ledgerMonth] = ledger.month.split('-').map(Number);
  // 포스트잇 라벨 ↔ 서버 direction scope. 잔액은 무필터(최근 두 줄), 적립·지출은 해당 방향 전체
  const TAB_LABEL = {
    balance: t('ui.hall.balance'),
    earn: t('ui.hall.earned'),
    spend: t('ui.hall.spent'),
  } as const;
  // 서버 원장 사유 → 한 줄 표시 (GROMO-1786 · IslandWalletTransactionType). 거래 주체는 계약에 없다
  const REASON: Record<string, string> = {
    contribution: t('ui.hall.focusContribution'),
    quest_settlement: t('ui.hall.questReward'),
    construction_debit: t('ui.hall.constructionExpense'),
    shop_purchase: t('ui.hall.sharedPurchase'),
    golden_fish: t('ui.hall.goldenFish'),
    promotion_fee: t('magazine.ledger.promotionFee'),
  };
  const shown = ledger.tab === 'balance' ? ledger.items.slice(0, 2) : ledger.items;
  const numberText = (n: number, sign: '+' | '−') =>
    `${sign}${Math.abs(n).toLocaleString(localeTag())}`;
  const LG = componentTokens.ledger;
  // 세 장짜리 책: 장부 그림 한 장을 비율 그대로 깔고(세로는 폭은 좌우 여백 안, 높이는 위~아래 여백 안 — 작은 쪽에 맞춰
  // 가운데) 그림 속 종이 영역 비율로 글을 둔다
  const A = LG.art;
  const bookLeft = land ? side : LG.side;
  const room = W - bookLeft - (land ? LG.landRight : LG.side);
  // 세로: 874 화면은 시안 높이 635.3 그대로, 낮은 화면은 뒤로 버튼·명판 아래에서 시작
  const bookTop = land
    ? LG.landTop
    : Math.max(L.insets.top + LG.topBelowInset, H - LG.bottom - LG.maxHeight);
  const visibleH = H - bookTop - (land ? LG.landBottom : LG.bottom);
  // 가로는 높이에 맞춰 줄이지 않는다 — 세로 폰과 비슷한 폭으로 크게 두고 아래쪽을 화면 밖으로 잘라 낸다(2026-10-27 오스카)
  const sc = land
    ? Math.min(room, LG.landscapeBookWidth) / A.width
    : Math.min(room / A.width, visibleH / A.height);
  const artH = A.height * sc;
  const bookW = A.width * sc;
  // 보이는 책 몸통 높이 — 세로는 그림 높이 그대로, 가로는 화면 아래 여백에서 잘린다
  const bodyH = Math.min(artH, visibleH);
  const paper = {
    left: A.paperLeft * sc,
    top: A.paperTop * sc,
    right: (A.width - A.paperRight) * sc,
    bottom: (A.height - A.paperBottom) * sc,
  };
  // 큰 글자·좁은 종이는 날짜·내용 아래에 금액을 따로 놓아 어느 열도 밀려 사라지지 않게 한다.
  const contentWidth = bookW - paper.left - paper.right - LG.contentInsetX * 2;
  const stackedRows =
    (L.fontScale ?? 1) >= semanticTokens.typography.largeTextThreshold ||
    contentWidth < LG.rowStackWidth * Math.max(1, L.fontScale ?? 1);
  // 토큰의 { 크기, 줄높이 } 로 고운돋움 글자 스타일을 만든다
  const lt = (type: { fontSize: number; lineHeight: number }, extra?: object) =>
    g(type.fontSize, type.lineHeight, extra);
  const tnum = { fontVariant: ['tabular-nums'] };
  // 이번 달이 아니면 「그 달」
  const monthWord = ledger.offset ? t('ui.hall.thatMonth') : t('ui.hall.thisMonth');
  // 통장 표 한 줄: 날짜 | 내용(묶인 줄은 · N회) | 물고기 금액. 금액 줄높이 22 > 크기 18 이라 고운돋움 숫자 윗부분이 잘리지 않는다
  const list = shown.map((l) => {
    const spend = l.direction === 'spend';
    return (
      <View
        key={l.id}
        testID={`ledger-row-${l.id}`}
        style={{
          flexDirection: stackedRows ? 'column' : 'row',
          alignItems: 'center',
          gap: LG.columnGap,
          paddingVertical: LG.rowPaddingVertical,
          paddingHorizontal: LG.cellPaddingHorizontal,
          borderBottomWidth: LG.rowRule,
          borderStyle: 'dashed',
          borderBottomColor: LG.dash,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: LG.columnGap,
            flex: stackedRows ? undefined : 1,
            alignSelf: stackedRows ? 'stretch' : undefined,
            minWidth: 0,
          }}
        >
          <T style={lt(LG.date, { minWidth: LG.dateWidth, color: LG.faint, ...tnum })}>
            {kstMonthDay(Date.parse(l.createdAt))}
          </T>
          {/* 모크 모드의 reason 자리에는 로컬 제목이 실려 있다 — 그대로 보여 준다 */}
          <T style={lt(LG.reason, { flex: 1, minWidth: 0 })}>
            {mockLedger ? l.reason : (REASON[l.reason] ?? t('ui.hall.miscellaneous'))}
            {l.entryCount > 1 ? (
              <T style={{ fontSize: LG.countFontSize, color: LG.faint }}>
                {t('ui.hall.entryCount', { v0: l.entryCount })}
              </T>
            ) : null}
          </T>
        </View>
        {/* 서버 amount 는 항상 양수 — 부호는 direction 이 정한다 */}
        <T
          testID={`ledger-amount-${l.id}`}
          numberOfLines={1}
          adjustsFontSizeToFit
          style={lt(LG.amount, {
            minWidth: stackedRows ? 0 : LG.amountMinWidth,
            maxWidth: stackedRows ? '100%' : '50%',
            alignSelf: stackedRows ? 'stretch' : undefined,
            flexShrink: 1,
            textAlign: 'right',
            fontWeight: '700',
            color: spend ? LG.spend : LG.earn,
            ...tnum,
          })}
        >
          {numberText(l.amount, spend ? '−' : '+')}
        </T>
      </View>
    );
  });
  // 다음 쪽(같은 월·방향의 서명 커서) 더 보기. 잔액 장은 최근 두 줄만 보는 자리라 붙이지 않는다
  const more =
    ledger.tab !== 'balance' && ledger.nextCursor ? (
      <Pressable
        testID="ledger-more"
        accessibilityRole="button"
        accessibilityLabel={t('ui.hall.loadEarlier')}
        accessibilityState={{ disabled: ledger.loadingMore }}
        disabled={ledger.loadingMore}
        onPress={ledger.loadMore}
        style={{
          alignSelf: 'center',
          marginTop: 7.7,
          paddingVertical: 9,
          paddingHorizontal: 19.4,
          opacity: ledger.loadingMore ? 0.5 : 1,
        }}
      >
        <T style={g(15.5, 24.8, { color: MUTED, fontWeight: '700' })}>
          {ledger.loadingMore ? t('account.blocked.loading') : t('ui.hall.loadEarlier')}
        </T>
      </Pressable>
    ) : null;
  const moreRetry = ledger.moreError && (
    <Pressable
      testID="ledger-more-retry"
      accessibilityRole="button"
      accessibilityLabel={t('common.retry')}
      onPress={ledger.loadMore}
      style={{ alignSelf: 'center', paddingVertical: 9 }}
    >
      <T style={g(15.5, 21.7, { color: '#8a4a3f', textAlign: 'center' })}>
        {t('ui.hall.loadEarlierFailed')}
      </T>
    </Pressable>
  );
  const stateBox =
    ledger.status === 'loading' ? (
      <View
        testID="ledger-loading"
        style={{
          alignItems: 'center',
          paddingVertical: 23.2,
          borderWidth: 1.9,
          borderStyle: 'dashed',
          borderColor: '#c5ad8a',
          borderRadius: 12.9,
        }}
      >
        <T style={g(16.8, 26.88, { fontWeight: '700' })}>{t('ui.hall.loading')}</T>
      </View>
    ) : ledger.status === 'error' ? (
      <View
        testID="ledger-error"
        style={{
          alignItems: 'center',
          gap: 9,
          paddingVertical: 23.2,
          paddingHorizontal: 12.9,
          borderWidth: 1.9,
          borderStyle: 'dashed',
          borderColor: '#c5ad8a',
          borderRadius: 12.9,
        }}
      >
        <T style={g(16.8, 26.88, { fontWeight: '700', textAlign: 'center' })}>
          {errorTextOr(ledger.error, 'ui.errors.ledgerFailed')}
        </T>
        <Pressable
          testID="ledger-retry"
          accessibilityRole="button"
          accessibilityLabel={t('common.retry')}
          onPress={ledger.retry}
          style={{
            minHeight: 44,
            paddingHorizontal: 19.4,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: BROWN,
            borderRadius: 99,
          }}
        >
          <T style={g(14, 22.4, { color: CARD_INK })}>{t('common.retry')}</T>
        </Pressable>
      </View>
    ) : null;
  const tableHead = (
    <View
      style={{
        flexDirection: 'row',
        gap: LG.columnGap,
        paddingTop: LG.tableHeadPadding.top,
        paddingBottom: LG.tableHeadPadding.bottom,
        paddingHorizontal: LG.cellPaddingHorizontal,
        borderBottomWidth: LG.headRule,
        borderBottomColor: LG.rule,
      }}
    >
      <T style={lt(LG.tableHead, { minWidth: LG.dateWidth, color: LG.faint })}>
        {t('ui.hall.date')}
      </T>
      <T style={lt(LG.tableHead, { flex: 1, color: LG.faint })}>{t('ui.hall.details')}</T>
      <T
        style={lt(LG.tableHead, {
          minWidth: LG.amountMinWidth,
          textAlign: 'right',
          color: LG.faint,
        })}
      >
        🐟
      </T>
    </View>
  );
  const empty = (
    <View
      testID="ledger-empty"
      style={{
        alignItems: 'center',
        gap: 5.2,
        paddingVertical: 23.2,
        paddingHorizontal: 12.9,
        borderWidth: 1.9,
        borderStyle: 'dashed',
        borderColor: '#c5ad8a',
        borderRadius: 12.9,
      }}
    >
      <T style={g(16.8, 26.88, { fontWeight: '700', textAlign: 'center' })}>
        {ledger.tab === 'balance'
          ? t('ui.hall.noEntries')
          : t('ui.hall.noMonthlyEntries', { v0: TAB_LABEL[ledger.tab] })}
      </T>
      <T style={g(15.5, 21.7, { color: MUTED, textAlign: 'center' })}>
        {t('ui.hall.earnAndSpendHint')}
      </T>
    </View>
  );
  // 잔액 장: 물고기 + 잔액 + 단위, 그 아래 이번 달 적립·사용 한 줄. 적립·지출 장: 그 달 합계 하나
  // 큰 숫자는 줄높이 40 > 크기 34. 긴 금액·큰 글자는 자르지 않고 한 줄에 맞게 줄인다
  const head =
    ledger.tab === 'balance' ? (
      <>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            gap: LG.headGap,
            marginTop: LG.headTop,
          }}
        >
          <Image
            source={art.fish}
            accessible={false}
            style={{ width: LG.fishSize, height: LG.fishSize }}
          />
          <T
            testID="ledger-balance"
            numberOfLines={1}
            adjustsFontSizeToFit
            style={lt(LG.balance, { flexShrink: 1, ...tnum })}
          >
            {ledger.villagePoints === null ? '—' : ledger.villagePoints.toLocaleString(localeTag())}
          </T>
          <T style={lt(LG.unit, { color: MUTED })}>{t('ui.hall.fishUnit')}</T>
        </View>
        <T style={lt(LG.caption, { marginTop: LG.summaryTop, color: MUTED })}>
          {t('ui.hall.monthlyEarned', { v0: monthWord })}
          <T style={{ color: LG.earn, ...tnum }}>{numberText(ledger.earnedTotal, '+')}</T>
          {t('ui.hall.monthlySpent', { v0: monthWord })}
          <T style={{ color: LG.spend, ...tnum }}>{numberText(ledger.spentTotal, '−')}</T>
        </T>
      </>
    ) : (
      <>
        <T style={lt(LG.caption, { marginTop: LG.headTop, color: MUTED })}>
          {`${monthWord} ${ledger.tab === 'earn' ? t('ui.hall.earned') : t('ui.hall.used')}`}
        </T>
        <T
          testID="ledger-total"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={lt(LG.balance, { color: ledger.tab === 'earn' ? LG.earn : LG.spend, ...tnum })}
        >
          {ledger.tab === 'earn'
            ? numberText(ledger.earnedTotal, '+')
            : numberText(ledger.spentTotal, '−')}
        </T>
      </>
    );
  // 월 이동 ‹ › — 글자만 보이고 버튼 상자 자체가 44×44 다(hitSlop 은 부모 행·스크롤 경계를 못 넘어 44 가 안 나온다).
  // 화살표는 시안 자리대로 ‹ 는 왼쪽 끝, › 는 오른쪽 끝에 붙이고 세로 가운데. 두 상자 폭이 같아 월 글자는 가운데 그대로
  const nav = (dir: -1 | 1) => {
    const disabled = dir === 1 && !ledger.canNext;
    return (
      <Pressable
        testID={dir < 0 ? 'ledger-prev' : 'ledger-next'}
        accessibilityRole="button"
        accessibilityLabel={dir < 0 ? t('ui.hall.previousMonth') : t('ui.hall.nextMonth')}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => (dir < 0 ? ledger.prevMonth() : ledger.nextMonth())}
        style={{
          minWidth: semanticTokens.size.tapMin,
          minHeight: semanticTokens.size.tapMin,
          alignItems: dir < 0 ? 'flex-start' : 'flex-end',
          justifyContent: 'center',
          opacity: disabled ? LG.navDisabledOpacity : 1,
        }}
      >
        <T style={lt(LG.navArrow, { fontWeight: '800', color: LG.faint })}>{dir < 0 ? '‹' : '›'}</T>
      </Pressable>
    );
  };
  const labels = ['balance', 'earn', 'spend'] as const;
  const tabLeft = (n: number) => paper.left + LG.tabLeft + n * (LG.tabSize + LG.tabGap);
  // 포스트잇은 책 위로(좁은 화면은 오른쪽으로도) 나온다. 안드로이드는 부모 상자 밖 터치를 자르므로 바깥 상자를
  // 누르는 자리(hitSlop 포함)까지 위·오른쪽으로 늘리고, 책은 그 안에서 rise 만큼 내려 화면상 자리는 그대로 둔다.
  // rise 는 장과 상관없이 가장 높이 오는 자리(가장 위 단면 또는 펼친 자리) 기준이라 장을 넘겨도 책이 움직이지 않는다
  const rise = Math.max(
    0,
    LG.tabSize * LG.tabArtBottom +
      LG.tabHitSlop -
      Math.min(
        A.bandBottom * sc + LG.tabOpenOverlap,
        ...LG.pageEdges.map((y) => y * sc + LG.tabRestOverlap),
      ),
  );
  const frameW = Math.max(bookW, tabLeft(labels.length - 1) + LG.tabSize + LG.tabHitSlop);
  // 고양이 포스트잇 — 세 장 모두 책 그림 앞. 펼친 장은 아래가 단면 띠 바닥 +4(종이에 붙음), 나머지는 제 색 단면 +6 에 걸친다.
  // 누르면 그 장이 펼쳐진다(넘김 애니메이션 없음)
  const postIt = (label: (typeof labels)[number], n: number) => {
    const on = ledger.tab === label;
    const artBottom = on
      ? A.bandBottom * sc + LG.tabOpenOverlap
      : LG.pageEdges[n] * sc + LG.tabRestOverlap;
    return (
      <Pressable
        key={label}
        testID={`ledger-tab-${label}`}
        accessibilityRole="tab"
        accessibilityLabel={TAB_LABEL[label]}
        accessibilityState={{ selected: on }}
        hitSlop={LG.tabHitSlop}
        onPress={() => {
          const next = label;
          // 거래내역(적립·지출) 장을 실제로 펼치는 순간 1회 — 기본 잔액 요약·같은 장 재탭은 제외
          if (next !== ledger.tab && next !== 'balance')
            captureProductEvent('feature_used', { building: 'ledger', action: 'open' });
          ledger.setTab(next);
        }}
        style={{
          position: 'absolute',
          zIndex: on ? LG.tabOpenZ : LG.tabZ,
          left: tabLeft(n),
          top: rise + artBottom - LG.tabSize * LG.tabArtBottom,
          width: LG.tabSize,
          height: LG.tabSize,
        }}
      >
        <Image source={ledgerArt.tabs[n]} resizeMode="contain" style={fill} />
        <T
          style={lt(LG.tabLabel, {
            position: 'absolute',
            left: 0,
            right: 0,
            top: LG.tabSize * LG.tabLabelTop,
            textAlign: 'center',
            fontWeight: '800',
          })}
        >
          {TAB_LABEL[label]}
        </T>
      </Pressable>
    );
  };
  return shell(
    // 바깥 상자 = 책 + 포스트잇 누르는 자리. 빈 부분은 터치를 받지 않는다(box-none)
    <View
      testID="ledger-book"
      pointerEvents="box-none"
      style={[
        {
          position: 'absolute',
          zIndex: 7,
          left: bookLeft + (room - bookW) / 2,
          top: bookTop - rise,
          width: frameW,
          height: bodyH + rise,
        },
        web({ filter: 'drop-shadow(rgba(60, 38, 27, 0.384) 0px 14.2px 15.5px)' }),
      ]}
    >
      {/* 책 몸통은 보이는 높이에서 그림을 자른다. 포스트잇은 몸통 밖 형제라 잘리지 않는다 */}
      <View
        testID="ledger-book-body"
        style={{
          position: 'absolute',
          zIndex: LG.artZ,
          left: 0,
          top: rise,
          width: bookW,
          height: bodyH,
          overflow: 'hidden',
        }}
      >
        <Image
          testID="ledger-book-art"
          source={ledgerArt.book}
          resizeMode="contain"
          style={{
            position: 'absolute',
            zIndex: LG.artZ,
            left: 0,
            top: 0,
            width: bookW,
            height: artH,
          }}
        />
        {/* 펼친 장 종이에 그 장 포스트잇 색을 곱하기로 옅게 덮는다 */}
        <View
          testID="ledger-tint"
          pointerEvents="none"
          style={{
            position: 'absolute',
            zIndex: LG.tintZ,
            left: paper.left,
            right: paper.right,
            top: paper.top,
            height: artH - paper.top - paper.bottom,
            borderRadius: LG.tintRadius,
            backgroundColor: LG.tabColors[labels.findIndex((x) => x === ledger.tab)],
            opacity: LG.tintOpacity,
            mixBlendMode: 'multiply',
          }}
        />
        {/* 종이 안: 낮은 화면·긴 내역은 종이 안에서 스크롤한다. 아래 끝은 그림의 종이 바닥과 보이는 몸통 아래 끝 중
            위쪽(− 여백) — 가로에서 잘린 책이어도 글이 화면 밖으로 숨지 않고 스크롤된다 */}
        <ScrollView
          testID="ledger-page"
          showsVerticalScrollIndicator={false}
          style={{
            position: 'absolute',
            zIndex: LG.contentZ,
            left: paper.left + LG.contentInsetX,
            right: paper.right + LG.contentInsetX,
            top: paper.top + LG.contentInsetY,
            bottom: Math.max(0, bodyH - artH + paper.bottom) + LG.contentInsetY,
          }}
        >
          <View
            testID="ledger-month-row"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: LG.navGap,
              minHeight: semanticTokens.size.tapMin,
            }}
          >
            {nav(-1)}
            <T style={lt(LG.month, { flex: 1, textAlign: 'center', color: LG.faint })}>
              {t('ui.hall.month', { v0: ledgerYear, v1: ledgerMonth })}
            </T>
            {nav(1)}
          </View>
          {head}
          {/* 조회 실패·로딩·진짜 빈 달은 서로 다른 상태다 — 실패를 빈 내역으로 접지 않는다 */}
          <View style={{ marginTop: LG.tableTop }}>
            {stateBox ??
              (shown.length ? (
                <>
                  {tableHead}
                  {list}
                  {more}
                  {moreRetry}
                </>
              ) : (
                empty
              ))}
          </View>
        </ScrollView>
      </View>
      {labels.map(postIt)}
    </View>,
    e.back,
  );
}
