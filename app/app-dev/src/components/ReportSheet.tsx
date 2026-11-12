import React, { useEffect, useRef, useState } from 'react';
import { Modal, View } from 'react-native';
import { Btn, C, Field, NavBtn, Overlay, Txt } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { errorTextOr, t } from '@/i18n';
import { uuid } from '@/services/api/client';
import {
  submitReport,
  type ReportReason,
  type ReportTarget,
  type ReportReceipt,
} from '@/services/api/safety';

const REASONS: ReportReason[] = [
  'HARASSMENT',
  'HATE',
  'SPAM_FRAUD',
  'SEXUAL',
  'CHILD_SAFETY',
  'THREAT',
  'PRIVACY_IMPERSONATION',
  'OTHER',
];

type Props = { visible: boolean; target?: ReportTarget; onClose: () => void };

export function ReportSheet({ visible, target, onClose }: Props) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<ReportReceipt | null>(null);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const sending = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setReason(null);
    setDetails('');
    setBusy(false);
    setError('');
    setReceipt(null);
    attempt.current = null;
    sending.current = false;
    return () => {
      generation.current += 1;
    };
  }, [visible, target?.targetType, target?.targetId, target?.targetUserId, target?.submittedText]);

  const close = () => {
    if (!sending.current) onClose();
  };
  const send = async () => {
    if (sending.current || !reason || !details.trim()) return;
    const currentGeneration = generation.current;
    const body = {
      targetType: target?.targetType ?? ('OTHER' as const),
      targetId: target?.targetId,
      targetUserId: target?.targetUserId,
      submittedText: target?.submittedText?.slice(0, 5000),
      reason,
      details: details.trim(),
    };
    const payload = JSON.stringify(body);
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: uuid() };
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await submitReport({ ...body, requestId: attempt.current.key });
      if (generation.current === currentGeneration) setReceipt(result);
    } catch (thrown) {
      if (generation.current === currentGeneration) setError(errorTextOr(thrown, 'safety.failed'));
    } finally {
      if (generation.current === currentGeneration) {
        sending.current = false;
        setBusy(false);
      }
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      accessibilityLabel={t(receipt ? 'report.received' : 'report.title')}
      onRequestClose={close}
    >
      <Overlay close={close} adjustForKeyboard>
        <View
          testID="report-dialog"
          accessibilityViewIsModal
          style={{ gap: componentTokens.modal.gap }}
        >
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Txt kind="title">{t(receipt ? 'report.received' : 'report.title')}</Txt>
            <NavBtn close label={t('common.close')} disabled={busy} onPress={close} />
          </View>
          {receipt ? (
            <>
              <Txt>{t('report.receivedBody')}</Txt>
              <Txt selectable kind="meta">
                {t('report.receipt', { id: receipt.reportId })}
              </Txt>
              <Btn title={t('common.close')} onPress={close} />
            </>
          ) : (
            <>
              {target?.label ? <Txt>{target.label}</Txt> : null}
              <Txt kind="meta">{t('report.privacy')}</Txt>
              <Txt kind="section">{t('report.reason')}</Txt>
              <View style={{ gap: semanticTokens.spacing.control }}>
                {REASONS.map((value) => (
                  <Btn
                    key={value}
                    kind={reason === value ? undefined : 'sec'}
                    title={t(`report.reasons.${value}`)}
                    disabled={busy}
                    selected={reason === value}
                    onPress={() => setReason(value)}
                  />
                ))}
              </View>
              <Field
                label={t('report.details')}
                placeholder={t('report.placeholder')}
                multiline
                value={details}
                maxLength={2000}
                disabled={busy}
                onChange={setDetails}
              />
              {error ? (
                <Txt accessibilityRole="alert" style={{ color: C.danger }}>
                  {error}
                </Txt>
              ) : null}
              <Btn
                title={t(busy ? 'safety.processing' : 'report.submit')}
                disabled={busy || !reason || !details.trim()}
                onPress={() => {
                  void send();
                }}
              />
            </>
          )}
        </View>
      </Overlay>
    </Modal>
  );
}
