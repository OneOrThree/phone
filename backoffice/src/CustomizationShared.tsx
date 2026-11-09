import { useState } from 'react';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export interface CatalogItem {
  productId: string; title: string; kind: string; category: string | null; rarity: Rarity | null;
  imagePath: string | null; displayable: boolean; inPool: boolean; ownerCount: number; sortOrder: number; retiredAt: string | null;
}
export interface PoolInfo { revision: number; categoryWeights: Record<string, number>; productIds: string[] }
export interface ItemsResponse { pool: PoolInfo; items: CatalogItem[]; staticOrigin: string | null; local?: boolean }
export interface AuditEvent { at: string; actor: string; action: string; revision: number }

export const RARITY_LABEL: Record<Rarity, string> = { common: '일반', uncommon: '고급', rare: '희귀', legendary: '전설' };
export const KIND_LABEL: Record<string, string> = { head: '머리', neck: '목' };
export const date = (value?: string | null) => value ? new Date(value).toLocaleString('ko-KR') : '—';
export const rarityLabel = (value: Rarity | null) => value ? RARITY_LABEL[value] : '—';
export const kindLabel = (value: string | null) => value ? (KIND_LABEL[value] ?? value) : '—';

// origin 이 없으면(로컬) 그림 대신 이름 첫 글자 자리표시를 그린다. 그림이 깨져도 같은 자리표시로 돌아간다.
export function Thumb({ item, staticOrigin }: { item: Pick<CatalogItem, 'title' | 'imagePath'>; staticOrigin: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!staticOrigin || !item.imagePath || broken)
    return <span className="cust-thumb cust-thumb-empty" aria-hidden="true">{item.title.slice(0, 1)}</span>;
  return <img className="cust-thumb" src={`${staticOrigin}${item.imagePath}`} alt="" loading="lazy" onError={() => setBroken(true)} />;
}
