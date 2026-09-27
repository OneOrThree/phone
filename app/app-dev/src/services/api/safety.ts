import { request, uuid } from './client';

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

export type ReportReceipt = { caseId: string; blocked: boolean };

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

/** 호출부는 실패 재시도 때 같은 requestId 를 넘겨야 같은 메일 사건으로 수렴한다. */
export function submitReport(
  input: ReportInput,
  requestId: string = uuid(),
): Promise<ReportReceipt> {
  return request<ReportReceipt>('/reports', {
    method: 'POST',
    body: input,
    idempotencyKey: requestId,
  });
}
