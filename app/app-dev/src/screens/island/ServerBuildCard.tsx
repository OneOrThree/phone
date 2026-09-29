/**
 * 서버 모드 홈의 첫 건물(회관·게시판) 짓기 카드 (GROMO-2139).
 *
 * 기획상 회관·게시판은 홈에서 고정 순서로 짓는다(회관이 생기기 전이라 회관 화면을 쓸 수 없다).
 * 홈 진입 호출 수를 늘리지 않게, 접힌 카드는 홈 스냅샷만 그리고 서버 건설 조회
 * (`useConstruction`)는 카드를 펼쳤을 때만 돈다. 가격·건설 가능 여부는 서버 옵션이 정본이고,
 * 착공 뒤 홈 반영은 `onChanged`(홈 스냅샷 재조회)로만 한다 — 로컬 BUILD 는 부르지 않는다.
 */
import React, { useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { Btn, Txt } from '@/design-system/patterns';
import { componentTokens } from '@/design-system/tokens';
import { buildingNames, type Building } from '@/services/model';
import { normalizedConstructionProgress } from './constructionProgress';
import { useConstruction } from './useConstruction';
import { buildBlockedText } from './Hall';

type Tracked = { building: Building; startedAt: number; endsAt: number } | null;

export function ServerBuildCard({
  islandId,
  building,
  villagePoints,
  tracked,
  style,
  onStarted,
  onChanged,
}: {
  /** 홈 스냅샷의 서버 섬 id — scope 리셋 신호. */
  islandId: string;
  building: Building;
  /** 홈 스냅샷의 섬 통장 잔액 — 접힌 카드 표시용. */
  villagePoints: number;
  /** 이 기기에서 받은 착공 receipt(clientConstruction) — 공사 중 표시용. */
  tracked: Tracked;
  style: ViewStyle;
  onStarted: (receipt: { building: Building; startedAt: number; endsAt: number }) => void;
  /** 착공·완공 뒤 홈 스냅샷을 다시 읽는다. */
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const now = Date.now();
  const construction = useConstruction({
    active: open,
    islandId,
    now,
    onStarted: (r) =>
      onStarted({
        building: r.buildingId as Building,
        startedAt: Date.parse(r.startedAt),
        endsAt: Date.parse(r.completesAt),
      }),
  });
  const name = buildingNames[tracked?.building ?? building];
  const item = construction.options?.items.find((it) => it.id === building);

  let meta: string, bar: number, action: React.ReactNode;
  if (tracked) {
    const progress = normalizedConstructionProgress(
      { startedAt: tracked.startedAt, completesAt: tracked.endsAt },
      now,
    );
    meta = `${Math.max(0, Math.ceil((tracked.endsAt - now) / 60000))}분 남음`;
    bar = progress;
    // 완공은 서버 스케줄러 몫 — 예정 시각이 지나면 홈을 다시 읽어 확인한다
    action = progress >= 1 && (
      <Btn small id="server-build-refresh" title="완공 확인" onPress={onChanged} />
    );
  } else if (!open) {
    meta = `섬 통장 ${villagePoints}마리`;
    bar = 0;
    action = (
      <Btn
        small
        id="server-build-open"
        title="건설하기"
        onPress={() => {
          setMessage('');
          setOpen(true);
        }}
      />
    );
  } else if (construction.status === 'error') {
    meta = '';
    bar = 0;
    action = (
      <>
        <Txt kind="meta">{construction.error?.message ?? '건설 정보를 불러오지 못했어요.'}</Txt>
        <Btn
          small
          id="server-build-retry"
          title="다시 시도"
          onPress={() => void construction.retry().catch(() => undefined)}
        />
      </>
    );
  } else if (construction.status === 'loading' || !item) {
    // 옵션에 이 건물이 없다 = 이미 완공 — 홈 스냅샷이 늦은 것이라 다시 읽는다
    meta = '';
    bar = 0;
    action =
      construction.status === 'ready' ? (
        <Btn small id="server-build-refresh" title="새로고침" onPress={onChanged} />
      ) : (
        <Txt kind="meta">건설 정보를 불러오고 있어요</Txt>
      );
  } else {
    meta = `${construction.options!.villagePoints}/${item.cost} 마리`;
    bar = Math.min(1, construction.options!.villagePoints / Math.max(1, item.cost));
    action = item.buildable ? (
      <Btn
        small
        id="server-build-start"
        title={`${item.cost}마리로 건설하기`}
        onPress={() =>
          construction.build(building).then(
            () => {
              setOpen(false);
              onChanged();
            },
            (error) =>
              setMessage(error instanceof Error ? error.message : '건설을 시작하지 못했어요.'),
          )
        }
      />
    ) : (
      <Txt kind="meta">{buildBlockedText(item.blockedReason)}</Txt>
    );
  }

  return (
    <View testID="server-build-card" style={[style, { gap: 8 }]}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Txt style={{ fontSize: 14, lineHeight: 20.3, fontWeight: '800' }}>
          {name} {tracked ? '공사 중' : '짓기'}
        </Txt>
        <Txt
          kind="meta"
          style={{
            fontSize: 12,
            lineHeight: 17.4,
            fontWeight: '600',
            fontVariant: ['tabular-nums'],
          }}
        >
          {meta}
        </Txt>
      </View>
      <View
        style={{
          height: 6,
          backgroundColor: componentTokens.progress.track,
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            height: '100%',
            width: `${bar * 100}%`,
            backgroundColor: componentTokens.progress.fill,
          }}
        />
      </View>
      {action}
      {!!message && <Txt kind="meta">{message}</Txt>}
    </View>
  );
}
