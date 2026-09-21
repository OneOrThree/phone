/**
 * 섬 게시판 공지·댓글 공개 API (GROMO-2013, island-board LLD §1·§2 — business-api
 * `IslandNoticeController`·`ScreenController.board`). 무접두 경로이고 성공 봉투·오류 형태는
 * 공통 client 가 벗긴다 — 이 모듈은 정확한 path/body/키만 보증한다.
 *
 * 쓰기 네 종은 호출자가 만든 UUID36 `Idempotency-Key` 를 받는다. 응답 유실·retryable 재시도는
 * 같은 path/body/key 로 보내고(서버가 원 결과를 재생한다), 의도가 바뀌면 새 key 다.
 *
 * ⚠️ 현재 공개 PATCH 는 `title`/`body` 만 받는다 — `expectedVersion` 등 다른 필드를 섞으면
 * 400 `INVALID_REQUEST` 다. 낙관 잠금(version precondition)은 서버 계약이 생길 때까지 없다.
 */
import { request } from './client';

/** 공지 목록 한 페이지 — 목록 항목에는 createdAt 이 없다(정렬 키는 서명 커서 안). */
export type NoticePage = {
  items: { id: string; title: string; commentCount: number }[];
  nextCursor: string | null;
};
/** 댓글 — 탈퇴·삭제된 작성자의 userId/name 은 null 이다. 합성하지 않는다. */
export type NoticeComment = {
  id: string;
  userId: string | null;
  name: string | null;
  text: string;
  createdAt: string;
};
export type NoticeDetail = {
  id: string;
  title: string;
  body: string;
  version: number;
  comments: NoticeComment[];
  nextCommentsCursor: string | null;
};
export type NoticeWriteResult = { id: string; title: string; body: string };
export type NoticeDeleted = { deleted: true };
export type CommentCreated = { id: string; name: string | null; text: string };
export type BoardScreen = {
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
    role: 'host' | 'member';
    version: number;
  };
  quests: {
    items: {
      id: string;
      occurrenceId: string;
      title: string;
      type: string;
      windowStart: string | null;
      windowEnd: string | null;
      timezone: string;
      date: string;
      targetMinutes: number;
      myRate: number | null;
      reward: { currency: string; amount: number };
      settlementStatus: string;
      claimable: boolean;
      claimBlockedReason: string | null;
      claimed: boolean;
      bonusAmount: number;
      bonusGranted: boolean;
      version: number;
    }[];
  };
  notices: NoticePage;
  wallets: {
    fish: number;
    villagePoints: number;
    fishVersion: number | null;
    villagePointsVersion: number;
  };
};

const enc = encodeURIComponent;
const query = (name: string, value: string | undefined) =>
  value === undefined ? '' : `?${name}=${enc(value)}`;

/** 게시판 화면 — 현재 섬 문맥·퀘스트·공지 첫 페이지·지갑. 게시판 미완공은 화면 전체 403 이다. */
export function getBoard(): Promise<BoardScreen> {
  return request<BoardScreen>('/screens/board');
}

export function listNotices(islandId: string, cursor?: string): Promise<NoticePage> {
  return request<NoticePage>(`/islands/${enc(islandId)}/notices${query('cursor', cursor)}`);
}

export function getNotice(
  islandId: string,
  noticeId: string,
  commentsCursor?: string,
): Promise<NoticeDetail> {
  return request<NoticeDetail>(
    `/islands/${enc(islandId)}/notices/${enc(noticeId)}${query('commentsCursor', commentsCursor)}`,
  );
}

export function createNotice(
  islandId: string,
  body: { title: string; body: string },
  key: string,
): Promise<NoticeWriteResult> {
  return request<NoticeWriteResult>(`/islands/${enc(islandId)}/notices`, {
    method: 'POST',
    body,
    idempotencyKey: key,
  });
}

/** 보낸 필드만 간다 — 생략은 유지·명시 null 은 서버가 거절한다. */
export function updateNotice(
  islandId: string,
  noticeId: string,
  body: { title?: string; body?: string },
  key: string,
): Promise<NoticeWriteResult> {
  return request<NoticeWriteResult>(`/islands/${enc(islandId)}/notices/${enc(noticeId)}`, {
    method: 'PATCH',
    body,
    idempotencyKey: key,
  });
}

export function deleteNotice(
  islandId: string,
  noticeId: string,
  key: string,
): Promise<NoticeDeleted> {
  return request<NoticeDeleted>(`/islands/${enc(islandId)}/notices/${enc(noticeId)}`, {
    method: 'DELETE',
    idempotencyKey: key,
  });
}

/** 댓글 작성 — 작성자는 AT 주체다. 대리 userId 입력은 계약에 없다. */
export function createNoticeComment(
  islandId: string,
  noticeId: string,
  body: { text: string },
  key: string,
): Promise<CommentCreated> {
  return request<CommentCreated>(`/islands/${enc(islandId)}/notices/${enc(noticeId)}/comments`, {
    method: 'POST',
    body,
    idempotencyKey: key,
  });
}
