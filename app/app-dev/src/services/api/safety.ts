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
  blockStatus: 'NOT_REQUESTED' | 'COMPLETED' | 'FAILED';
  evidenceText: string | null;
};

export const REPORT_EMAIL_RECIPIENT = 'nappaegonoljima@gmail.com';

const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  HARASSMENT: '욕설·괴롭힘',
  HATE: '혐오·차별',
  SPAM_FRAUD: '스팸·사기',
  SEXUAL: '성적 콘텐츠',
  CHILD_SAFETY: '아동 안전',
  THREAT: '위해 협박',
  PRIVACY_IMPERSONATION: '개인정보·사칭',
  OTHER: '기타',
};

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
  const blockStatus =
    input.blockStatus === 'COMPLETED'
      ? '완료'
      : input.blockStatus === 'FAILED'
        ? '실패'
        : '선택하지 않음';
  const lines = [
    '안녕하세요. 그로모 앱에서 신고드립니다.',
    '',
    `신고 대상: ${targetName}`,
    `대상 유형: ${targetType}`,
    `대상 ID: ${input.targetId}`,
    `신고 사유: ${REPORT_REASON_LABEL[input.reason]}`,
    `상세 설명: ${input.description ?? '없음'}`,
    `회신 받을 이메일: ${input.replyEmail ?? '미입력'}`,
    `앱에서 함께 차단: ${blockStatus}`,
    ...(input.evidenceText
      ? ['', '[신고 대상 원문]', input.evidenceText, '[/신고 대상 원문]']
      : []),
    '',
    '위 내용을 확인한 뒤 이 메일을 보내 주세요.',
  ];
  const subject = `[Gromo 신고] ${targetType} ${targetName}`;
  return `mailto:${REPORT_EMAIL_RECIPIENT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}
