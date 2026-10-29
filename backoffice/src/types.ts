export type ContentKind = 'fcm' | 'notice' | 'magazine';
export type ContentStatus = 'draft' | 'review' | 'approved' | 'publishing' | 'published' | 'failed' | 'uncertain';
export interface Session { actor: string; csrfToken: string; mode: 'local' | 'connected' }
export interface MagazineCard {
  islandId: string; name: string; buildingCount: number; memberCount: number;
  maxMembers: number; averageFocusMinutesPerDay: number | null;
}
export interface MagazineSnapshot {
  snapshotId: string;
  digest: string;
  issueDate: string;
  issueNo: number;
  editorial: {
    ranking: { rank: number; island: MagazineCard }[];
    newIslands: MagazineCard[];
    note: { type: 'EDITOR' | 'TIP'; body: string | null; tipNo: number | null };
  };
  cells: { promotionId: string; islandId: string; updatedAt: string; body: string;
    layout: { v: number; frameId: string; stickers: { assetId: string; x: number; y: number; scale: number; rotation: number }[]; tape: { assetId: string; x: number; y: number; rotation: number } | null }; moderation: string; card: MagazineCard | null }[];
}
export interface ContentItem {
  id: string;
  kind: ContentKind;
  title: string;
  body: string;
  targets: string[];
  data: Record<string, unknown>;
  issueDate?: string;
  startsAt?: string;
  endsAt?: string | null;
  revision: number;
  status: ContentStatus;
  createdAt: string;
  updatedAt: string;
  dispatchActor?: string;
  approvedBy?: string;
  approvedAt?: string;
  receipt?: Record<string, unknown>;
  error?: string;
  audit: { at: string; actor: string; action: string; revision: number }[];
}
export interface Draft {
  kind: ContentKind;
  title: string;
  body: string;
  targetsText: string;
  fcmKind: string;
  dataText: string;
  issueDate: string;
  startsAt: string;
  endsAt: string;
}
