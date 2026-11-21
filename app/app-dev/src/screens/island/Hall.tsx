import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import { ConstructionRoute } from '@/screens/island/hall/ConstructionRoute';
import { DeskRoute } from '@/screens/island/hall/DeskRoute';
import { LedgerRoute } from '@/screens/island/hall/LedgerRoute';
import { ManageRoute } from '@/screens/island/hall/ManageRoute';
import React from 'react';

// ServerBuildCard 가 './Hall' 에서 읽는다
export { buildBlockedText } from '@/screens/island/hall/ConstructionRoute';

// v2 시안(042~061) 마을회관: 책상 장면 → 섬 정보 카드·수정·위임·탈퇴 / 공동 가계부 / 목각 건물·청사진
// route 마다 화면을 hall/ 의 따로 된 컴포넌트가 그린다. CurrentScreenRouter 가 route 마다 key 로 회관을 다시
// 마운트하므로 상태는 route 를 넘어 남지 않는다 — 각 route 는 제 상태·훅만 갖는다.
export function Hall({ e }: ScreenProps) {
  if (e.route === 'hall') return <DeskRoute e={e} />;
  if (e.route === 'ledger') return <LedgerRoute e={e} />;
  if (e.route === 'construction') return <ConstructionRoute e={e} />;
  // manage·members
  return <ManageRoute e={e} />;
}
