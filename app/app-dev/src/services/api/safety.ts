import { request } from './client';
import { Linking, Platform } from 'react-native';
import { getLocale, t } from '@/i18n';

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
export const FEEDBACK_KAKAO_URL = 'https://open.kakao.com/o/ssOnMPUi';

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
  return `mailto:${REPORT_EMAIL_RECIPIENT}?subject=${encodeURIComponent(t('settings.report.subject', { brand: t('onboardingStory.brand') }))}&body=${encodeURIComponent(t('settings.report.body'))}`;
}

export function openReportCenter(): Promise<void> {
  // 사전 조회를 기다리지 않고 탭한 순간 연다. 웹 팝업의 사용자 활성화도 유지한다.
  return Linking.openURL(reportEmailUrl());
}

/** 영어 사용자용 문의 메일 — 앱 오류 제보·기능 제안. 신고와 같은 주소이고 제목 말머리로 구분한다. */
export function feedbackEmailUrl(appVersion: string): string {
  const body = t('settings.feedback.body', {
    version: appVersion,
    // 안드로이드의 Platform.Version 은 API 레벨(36)이라 사용자가 아는 OS 버전(16)을 넣는다.
    // 웹에는 Platform.Version 이 없어 브라우저 user agent 를 넣는다.
    os:
      Platform.OS === 'android'
        ? `android ${Platform.constants.Release}`
        : Platform.OS === 'web'
          ? `web ${navigator.userAgent}`
          : `${Platform.OS} ${Platform.Version}`,
  });
  return `mailto:${REPORT_EMAIL_RECIPIENT}?subject=${encodeURIComponent(t('settings.feedback.subject', { brand: t('onboardingStory.brand') }))}&body=${encodeURIComponent(body)}`;
}

export function openFeedback(appVersion: string): Promise<void> {
  // 카카오톡은 국내 사용자용이라 한국어만 오픈채팅으로 보내고, 그 외 언어는 메일을 연다.
  return Linking.openURL(getLocale() === 'ko' ? FEEDBACK_KAKAO_URL : feedbackEmailUrl(appVersion));
}
