import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Badge, Btn, Page, Txt } from '@/design-system/patterns';
import { Card } from '@/design-system/primitives';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { ApiError } from '@/services/api/client';
import type { PromotionRecord } from '@/services/api/magazine';
import { AdCell } from '@/screens/magazine/AdCell';
import { issueDateText } from '@/screens/magazine/MagazineReader';
import { editorIsland } from '@/screens/magazine/PromotionEditor';
import { magazineApi } from '@/screens/magazine/usePromotionEditor';
import { useAppLayout } from '@/utils/layout';

const P = componentTokens.promotionRecords;

/**
 * 우리 섬 홍보 기록판(GROMO-2289 · AD-11) — 회관 「섬 관리」에서 주민만 들어온다(방문자는 입구가 없고 라우트도 주민 전용).
 * 지난 홍보를 최신순으로: 날짜·호, 상태 칩, 칸 썸네일(섬장이 꾸민 칸 + 지금 섬 정보), 글, 상태 안내.
 * 줄 하나 = 스크린리더 요소 하나.
 */
export function PromotionRecords({ e }: { e: any }) {
  const L = useAppLayout();
  const largeText = L.fontScale >= P.largeTextThreshold;
  const { islandId, facts } = editorIsland(e.state, !!e.islands);
  const [items, setItems] = useState<PromotionRecord[] | null>(null);
  const [problem, setProblem] = useState<'' | 'failed' | 'forbidden'>('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!islandId) return;
    let alive = true;
    setProblem('');
    magazineApi()
      .getPromotionRecords(islandId)
      .then((next) => alive && setItems(next))
      .catch((err) => {
        if (!alive) return;
        // 주민이 아니게 됐다(탈퇴·강퇴) — 다시 시도해도 같다
        setProblem(err instanceof ApiError && err.code === 'FORBIDDEN' ? 'forbidden' : 'failed');
      });
    return () => {
      alive = false;
    };
  }, [islandId, nonce]);

  const center = (children: React.ReactNode) => (
    <View
      style={{
        alignItems: 'center',
        gap: semanticTokens.spacing.control,
        paddingVertical: semanticTokens.spacing.section,
      }}
    >
      {children}
    </View>
  );

  const row = (rec: PromotionRecord) => {
    const date = issueDateText(rec.issueDate);
    const issue =
      rec.issueNo == null
        ? t('magazine.records.issueUnpublished', { date })
        : t('magazine.records.issue', { date, no: rec.issueNo });
    const status = t(`magazine.records.status.${rec.status}`);
    const note = rec.status === 'PUBLISHED' ? '' : t(`magazine.records.note.${rec.status}`);
    const label = [t('magazine.records.rowA11y', { issue, status, body: rec.body }), note]
      .filter(Boolean)
      .join(', ');
    return (
      <Card key={rec.promotionId}>
        <View
          testID={`promotion-record-${rec.promotionId}`}
          accessible
          accessibilityLabel={label}
          style={{ gap: primitiveTokens.space[2] }}
        >
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: primitiveTokens.space[2],
            }}
          >
            <Txt kind="h17">{issue}</Txt>
            <Badge style={{ backgroundColor: P.statusTint[rec.status] }}>{status}</Badge>
          </View>
          <View
            style={{
              flexDirection: largeText ? 'column' : 'row',
              gap: semanticTokens.spacing.control,
            }}
          >
            {facts && rec.layout && (
              <AdCell
                testID={`promotion-record-cell-${rec.promotionId}`}
                width={P.thumbWidth}
                cell={{ ...facts, body: rec.body, layout: rec.layout }}
                // 지금 섬 숫자라 실린 날 칸의 숫자와 다르다 — 썸네일에서는 그 줄을 뺀다
                hideMeta
              />
            )}
            <View style={{ flex: largeText ? undefined : 1, gap: primitiveTokens.space[1] }}>
              <Txt>‘{rec.body}’</Txt>
              {!!note && <Txt kind="meta">{note}</Txt>}
            </View>
          </View>
        </View>
      </Card>
    );
  };

  return (
    <Page title={t('magazine.records.title')} back={e.back}>
      {problem
        ? center(
            <>
              <Txt testID="promotion-records-problem" style={{ textAlign: 'center' }}>
                {t(
                  problem === 'forbidden'
                    ? 'magazine.records.forbidden'
                    : 'magazine.records.loadFailed',
                )}
              </Txt>
              {problem === 'failed' && (
                <Btn
                  id="promotion-records-retry"
                  small
                  kind="sec"
                  title={t('common.retry')}
                  onPress={() => setNonce((n) => n + 1)}
                />
              )}
            </>,
          )
        : !items
          ? center(
              <>
                <ActivityIndicator color={semanticTokens.color.outline} />
                <Txt kind="meta">{t('magazine.records.loading')}</Txt>
              </>,
            )
          : !items.length
            ? center(
                <Txt testID="promotion-records-empty" style={{ textAlign: 'center' }}>
                  {t('magazine.records.empty')}
                </Txt>,
              )
            : items.map(row)}
    </Page>
  );
}
