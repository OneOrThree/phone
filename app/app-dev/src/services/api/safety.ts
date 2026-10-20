import { request } from './client';
import { Linking } from 'react-native';
import { t } from '@/i18n';

export type BlockedUser = { id: string; name: string };

export type ReportReason =
  | 'HARASSMENT'
  | 'HATE'
  | 'SPAM_FRAUD'
  | 'SEXUAL'
  | 'CHILD_SAFETY'
  | 'THREAT'
  | 'PRIVACY_IMPERSONATION'
  | 'OTHER';

export const REPORT_EMAIL_RECIPIENT = 'nappaegonoljima@gmail.com';

export function getBlockedUsers(): Promise<BlockedUser[]> {
  return request<BlockedUser[]>('/blocks');
}

export function blockUser(userId: string): Promise<void> {
  return request<unknown>('/blocks', {
    method: 'POST',
    body: { blockedUserId: userId },
  }).then(() => undefined);
}

export function unblockUser(userId: string): Promise<void> {
  return request<unknown>(`/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' }).then(
    () => undefined,
  );
}

/** 설정의 단일 신고 접수 진입 — 내용·캡처는 사용자가 기기 메일에서 작성한다. */
export function reportEmailUrl(): string {
  return `mailto:${REPORT_EMAIL_RECIPIENT}?subject=${encodeURIComponent(t('settings.report.subject'))}&body=${encodeURIComponent(t('settings.report.body'))}`;
}

export function openReportCenter(): Promise<void> {
  // 사전 조회를 기다리지 않고 탭한 순간 연다. 웹 팝업의 사용자 활성화도 유지한다.
  return Linking.openURL(reportEmailUrl());
}
