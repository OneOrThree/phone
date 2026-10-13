import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, Platform, View } from 'react-native';
import { Btn, C, Chips, Overlay, Txt } from '@/design-system/patterns';
import { semanticTokens } from '@/design-system/tokens';
import { REASONS } from '@/components/UserSafetySheet';
import { t } from '@/i18n';
import { ApiError } from '@/services/api/client';
import type { MagazineCell } from '@/services/api/magazine';
import { isMemberGateError } from '@/services/memberConversion';
import type { ReportReason } from '@/services/api/safety';
import { islandTitle } from './islandTitle';
import { magazineApi } from './usePromotionEditor';

/**
 * 홍보 칸 신고 시트(GROMO-2289 · SAFE-04) — 유저 신고 창(UserSafetySheet)과 같은 종이 시트 · 같은 사유 8종이고, 메일 대신
 * 서버 신고 API 로 보낸다. 서로 다른 3명이 신고하면 서버가 칸을 숨기지만 지금 보는 칸은 다음에 읽을 때까지 그대로 둔다.
 *
 * - 새 신고 · 이미 한 신고(서버 200) 모두 시트를 닫고 문구로 알린다(onDone).
 * - 게스트는 서버가 403 SOCIAL_LOGIN_REQUIRED — 회원 전환 시트를 열 수 있으면 이 시트를 닫고 연다, 없으면(목업) 시트 안에 안내.
 *
 * 잡지 꽂이·크게 보기처럼 Modal 이다(스크린리더가 시트만 읽는다). iOS 는 Modal 이 닫히는 중에 다른 Modal(회원 전환)을 띄우면
 * 조용히 실패해서, 회원 전환은 이 시트가 다 닫힌 뒤(onDismiss) 연다. 안드로이드는 onDismiss 가 없고 그럴 필요도 없어 바로 연다.
 * 그래서 부모는 시트를 늘 그려 두고 cell 로 열고 닫는다(닫히는 동안에는 마지막 칸을 그린다).
 */
export function PromotionReportSheet({
  cell,
  onClose,
  onDone,
  offerConversion,
}: {
  /** 신고할 칸 — null 이면 닫힘 */
  cell: MagazineCell | null;
  onClose: () => void;
  onDone: (message: string) => void;
  /** e.conversion?.offer — 게이트 거절이면 회원 전환 시트를 열고 true */
  offerConversion?: (err: unknown) => boolean;
}) {
  const [reason, setReason] = useState<ReportReason>(REASONS[0].value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shown = useRef(cell);
  if (cell) shown.current = cell;
  // 시트가 다 닫힌 뒤 열 회원 전환(게스트 게이트 오류)
  const gate = useRef<unknown>(null);
  const handOff = () => {
    const err = gate.current;
    gate.current = null;
    if (err) offerConversion?.(err);
  };
  const open = !!cell;
  useEffect(() => {
    if (!open) return;
    setReason(REASONS[0].value);
    setBusy(false);
    setError('');
  }, [open, cell?.promotionId]);
  const label = (value: ReportReason) => t(`magazine.report.reasons.${value}`);
  // 오류 문구 — 안드로이드는 아래 live region 이, iOS 는 여기서 읽어 준다(망원경 오류 안내와 같다)
  useEffect(() => {
    if (error && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  const close = () => {
    if (!busy) onClose();
  };
  const send = async () => {
    const target = shown.current;
    if (busy || !target) return;
    setBusy(true);
    setError('');
    try {
      const { created } = await magazineApi().reportPromotion(
        target.islandId,
        target.promotionId,
        reason,
      );
      onDone(t(created ? 'magazine.report.done' : 'magazine.report.already'));
    } catch (err) {
      setBusy(false);
      if (offerConversion && isMemberGateError(err)) {
        gate.current = err;
        onClose();
        if (Platform.OS !== 'ios') handOff();
        return;
      }
      const code = err instanceof ApiError ? err.code : '';
      setError(
        t(
          code === 'SOCIAL_LOGIN_REQUIRED'
            ? 'magazine.report.guest'
            : code === 'PROMOTION_NOT_FOUND'
              ? 'magazine.report.gone'
              : 'magazine.report.failed',
        ),
      );
    }
  };

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={close}
      onDismiss={handOff}
    >
      <Overlay sheet close={close}>
        <Txt testID="magazine-report" kind="h17" accessibilityRole="header">
          {t('magazine.report.title')}
        </Txt>
        <Txt kind="meta">
          {t('magazine.report.sub', { name: islandTitle(shown.current?.name ?? '') })}
        </Txt>
        <Chips
          items={REASONS.map((r) => label(r.value))}
          value={label(reason)}
          onChange={(picked: string) =>
            setReason(REASONS.find((r) => label(r.value) === picked)!.value)
          }
          disabled={busy}
          large
          wrap
        />
        <View style={{ flexDirection: 'row', gap: semanticTokens.spacing.control }}>
          <Btn
            kind="sec"
            dynamicHeight
            title={t('common.cancel')}
            disabled={busy}
            style={{ flex: 1 }}
            onPress={close}
          />
          <Btn
            id="magazine-report-submit"
            dynamicHeight
            title={t(busy ? 'magazine.report.busy' : 'magazine.report.submit')}
            disabled={busy}
            style={{ flex: 1 }}
            onPress={send}
          />
        </View>
        {!!error && (
          <Txt
            testID="magazine-report-error"
            accessibilityLiveRegion="polite"
            style={{ color: C.danger }}
          >
            {error}
          </Txt>
        )}
      </Overlay>
    </Modal>
  );
}
