/**
 * 우체통 화면·친구 편지·섬 우체통 낙서 공개 API (GROMO-2016).
 * 공개 근거 — friend-letter LLD §1.12~1.16, island-mailbox LLD §1.8~1.12,
 * business-api ScreenController/LetterController/IslandController.
 *
 * 계약 요지:
 * - GET /screens/mailbox — 현재 섬 + 우체통 낙서(오름차순) + 받은 편지 + 친구 한 묶음.
 * - GET /letters — 받은·보낸 편지 최신순 cursor 슬라이스. 보낸 편지의 열람 여부는
 *   정보라 안 싣는다.
 * - GET /letters/{id} — 읽기. 수신자 최초 읽기가 readAt 을 찍지만 편지를 닫지 않는다.
 * - POST /letters — 친구에게만 발송. Idempotency-Key 계약이 없다 — 응답 유실 뒤
 *   재시도하면 중복이 생길 수 있으므로 호출자는 실패를 숨기거나 자동 재시도하지 않는다.
 * - DELETE /letters/{id} — 닫기. 수신자만 호출, 204 성공·이미 닫힌 편지는 404.
 *   서버가 양쪽 목록에서 지운다 — 앱은 성공 뒤 목록을 재조회한다.
 * - /islands/{islandId}/messages — 섬 우체통 낙서. 보내기는 {clientMessageId, text},
 *   같은 키 재시도는 서버가 원본을 재생한다(중복 글 없음).
 */
import { request } from './client';

export type LetterItem = {
  id: string;
  counterpartUserId: string;
  counterpartNickname: string | null;
  content: string;
  isRead: boolean;
  createdAt: string;
};

export type LetterSlice = {
  content: LetterItem[];
  size: number;
  hasNext: boolean;
  nextCursor: string | null;
};

export type LetterView = {
  id: string;
  senderId: string;
  senderNickname: string | null;
  receiverId: string;
  content: string;
  createdAt: string;
  readAt: string | null;
};

export type MailboxMessage = {
  id: string;
  clientMessageId: string;
  userId: string;
  name: string | null;
  text: string;
  createdAt: string;
};

export type MailboxFriend = {
  userId: string;
  nickname: string | null;
  mainIslandName: string | null;
  myFavorite: boolean;
  theirFavorite: boolean;
};

export type MailboxScreen = {
  island: {
    id: string;
    name: string;
    intro: string;
    visibility: string;
    approvalRequired: boolean;
    memberCount: number;
    maxMembers: number;
    membershipStatus: string;
    growthStage: string | null;
    themeId: string | null;
    role: string;
    version: number;
  };
  messages: { items: MailboxMessage[]; nextCursor: string | null };
  letters: LetterSlice;
  friends: MailboxFriend[];
};

export type MessagePage = { items: MailboxMessage[]; nextCursor: string | null };

export const getMailboxScreen = () => request<MailboxScreen>('/screens/mailbox');

export const listLetters = (type: 'received' | 'sent', cursor?: string | null) =>
  request<LetterSlice>(
    `/letters?type=${type}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );

export const getLetter = (letterId: string) => request<LetterView>(`/letters/${letterId}`);

export const sendLetter = (body: { receiverId: string; content: string }) =>
  request<LetterView>('/letters', { method: 'POST', body });

export const closeLetter = (letterId: string) =>
  request<void>(`/letters/${letterId}`, { method: 'DELETE' });

export const listIslandMessages = (islandId: string, cursor?: string | null) =>
  request<MessagePage>(
    `/islands/${islandId}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );

export const sendIslandMessage = (
  islandId: string,
  body: { clientMessageId: string; text: string },
) => request<MailboxMessage>(`/islands/${islandId}/messages`, { method: 'POST', body });
