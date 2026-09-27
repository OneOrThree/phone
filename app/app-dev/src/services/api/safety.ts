import { request } from './client';

export type BlockedUser = { id: string; name: string };

export type ReportTargetType = 'USER' | 'LETTER';
export type ReportReason =
  | 'HARASSMENT'
  | 'HATE'
  | 'SPAM_FRAUD'
  | 'SEXUAL'
  | 'CHILD_SAFETY'
  | 'THREAT'
  | 'PRIVACY_IMPERSONATION'
  | 'OTHER';

export type ReportInput = {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  description: string | null;
  replyEmail: string | null;
  blockUser: boolean;
};

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

export function reportEmailUrl(input: ReportInput, targetName: string): string {
  const targetType = input.targetType === 'LETTER' ? '편지' : '사용자';
  const lines = [
    '안녕하세요. 그로모 앱에서 신고드립니다.',
    '',
    `신고 대상: ${targetName}`,
    `대상 유형: ${targetType}`,
    `대상 ID: ${input.targetId}`,
    `신고 사유: ${input.reason}`,
    `상세 설명: ${input.description ?? '없음'}`,
    `회신 받을 이메일: ${input.replyEmail ?? '미입력'}`,
    `앱에서 함께 차단: ${input.blockUser ? '예' : '아니오'}`,
    '',
    '위 내용을 확인한 뒤 이 메일을 보내 주세요.',
  ];
  const subject = `[Gromo 신고] ${targetType} ${targetName}`;
  return `mailto:${REPORT_EMAIL_RECIPIENT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}
