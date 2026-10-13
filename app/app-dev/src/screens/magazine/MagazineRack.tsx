import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import { Btn, Overlay } from '@/design-system/patterns';
import { semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import type { MagazineIssueSummary } from '@/services/api/magazine';
import { T, useGowun } from '@/screens/island/sceneKit';
import { issueDateText } from './MagazineReader';
import { cachedMagazineToday, onMagazineChanged } from './useMagazineToday';
import { magazineApi } from './usePromotionEditor';

/**
 * 잡지 꽂이(GROMO-2289 · C5) — 최근 7호, 최신 호가 먼저. 한 줄을 누르면 그 호를 펼친다(지난 호는 보기만).
 * 섬에서 본 잡지라 망원경 안내는 없다. 펼쳐 읽으면(onMagazineChanged) 「읽음」 표시가 바로 바뀐다.
 */
export function MagazineRack({
  visible,
  onClose,
  onOpen,
}: {
  visible: boolean;
  onClose: () => void;
  onOpen: (issueId: string) => void;
}) {
  const font = useGowun();
  const [items, setItems] = useState<MagazineIssueSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setFailed(false);
    magazineApi()
      .getMagazineIssues()
      .then((next) => alive && setItems(next))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [visible, nonce]);
  useEffect(
    () => (visible ? onMagazineChanged(() => setNonce((n) => n + 1)) : undefined),
    [visible],
  );

  // 「오늘」 표시는 지금 나와 있는 호에만 — 발행이 늦어져 가장 최근 호가 어제 호일 때는 붙이지 않는다
  const latest = cachedMagazineToday()?.issue;
  const current = latest?.current ? latest : null;
  const text = (size: number, color: string = semanticTokens.color.text) => ({
    fontFamily: font,
    fontSize: size,
    lineHeight: size * 1.35,
    color,
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Overlay sheet close={onClose}>
        <View testID="magazine-rack" style={{ gap: 2 }}>
          <T accessibilityRole="header" style={text(20)}>
            {t('magazine.rack.title')}
          </T>
          <T style={text(12, semanticTokens.color.textMuted)}>{t('magazine.rack.sub')}</T>
        </View>
        {failed ? (
          <View style={{ alignItems: 'center', gap: 8, paddingVertical: 16 }}>
            <T style={text(14)}>{t('magazine.rack.loadFailed')}</T>
            <Btn
              small
              kind="sec"
              title={t('common.retry')}
              onPress={() => setNonce((n) => n + 1)}
            />
          </View>
        ) : !items ? (
          <ActivityIndicator color={semanticTokens.color.outline} style={{ padding: 16 }} />
        ) : !items.length ? (
          <T style={[text(14), { textAlign: 'center', paddingVertical: 16 }]}>
            {t('magazine.rack.empty')}
          </T>
        ) : (
          <View
            style={{
              borderWidth: 1.5,
              borderColor: semanticTokens.color.outline,
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            {items.map((item, i) => {
              const today = !!current && current.issueId === item.issueId;
              const date = issueDateText(item.issueDate);
              const state = t(item.opened ? 'magazine.rack.opened' : 'magazine.rack.unread');
              return (
                <Pressable
                  key={item.issueId}
                  testID={`magazine-rack-${item.issueNo}`}
                  accessibilityRole="button"
                  accessibilityLabel={t('magazine.rack.rowA11y', {
                    no: item.issueNo,
                    date: today ? `${date} ${t('magazine.rack.today')}` : date,
                    state,
                  })}
                  onPress={() => onOpen(item.issueId)}
                  style={{
                    minHeight: 56,
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    backgroundColor: today
                      ? semanticTokens.color.subtle
                      : semanticTokens.color.surface,
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: semanticTokens.color.divider,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <T style={text(16)}>{t('magazine.rack.row', { no: item.issueNo, date })}</T>
                    <T
                      style={text(
                        12,
                        item.opened ? semanticTokens.color.textMuted : semanticTokens.color.danger,
                      )}
                    >
                      {state}
                    </T>
                  </View>
                  {today && (
                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 2,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: semanticTokens.color.outline,
                        backgroundColor: semanticTokens.color.accent,
                      }}
                    >
                      <T style={text(12)}>{t('magazine.rack.today')}</T>
                    </View>
                  )}
                  <T style={text(18, semanticTokens.color.textMuted)}>›</T>
                </Pressable>
              );
            })}
          </View>
        )}
      </Overlay>
    </Modal>
  );
}
