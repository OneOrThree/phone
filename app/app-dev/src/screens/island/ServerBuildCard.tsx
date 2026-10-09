/**
 * 서버 모드 홈의 첫 건물(회관·게시판) 짓기 카드 (GROMO-2139).
 *
 * 기획상 회관·게시판은 홈에서 고정 순서로 짓는다(회관이 생기기 전이라 회관 화면을 쓸 수 없다).
 * 한 번 눌러 바로 짓도록 카드가 보이면 서버 건설 옵션(`useConstruction`)을 미리 읽는다 — 이 카드는
 * 방장에게, 첫 두 건물이 남았을 때만 뜨므로 추가 조회는 그 경우 1회다. 가격·건설 가능 여부는 서버
 * 옵션이 정본이고, 착공 뒤 홈 반영은 `onChanged`(홈 스냅샷 재조회)로만 한다 — 로컬 BUILD 는 부르지 않는다.
 * 완공은 서버 스케줄러가 매분 처리하므로, 예정 시각이 지나면 카드가 스스로 홈을 다시 읽는다.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { Bar, Btn, Txt } from '@/design-system/patterns';
import { primitiveTokens } from '@/design-system/tokens';
import { buildingNames, type Building } from '@/services/model';
import { normalizedConstructionProgress } from './constructionProgress';
import { useConstruction } from './useConstruction';
import { buildBlockedText } from './Hall';

type Tracked = { building: Building; startedAt: number; endsAt: number } | null;

/** 완공 예정 시각이 지난 뒤 홈 스냅샷을 다시 읽는 간격 — 서버 완공 스케줄러는 매분 0초에 돈다. */
export const COMPLETION_POLL_MS = 10_000;

export function ServerBuildCard({
  islandId,
  building,
  villagePoints,
  tracked,
  style,
  onStarted,
  onChanged,
}: {
  /** 홈 스냅샷의 서버 섬 id — scope 리셋 신호이자 착공 요청 대상 섬과의 대조 기준. */
  islandId: string;
  building: Building;
  /** 홈 스냅샷의 섬 통장 잔액 — 접힌 카드 표시용. */
  villagePoints: number;
  /** 이 기기에서 받은 착공 receipt(clientConstruction) — 공사 중 표시용. */
  tracked: Tracked;
  style: ViewStyle;
  onStarted: (receipt: {
    islandId: string;
    building: Building;
    startedAt: number;
    endsAt: number;
  }) => void;
  /** 착공·완공 뒤 홈 스냅샷을 다시 읽는다. */
  onChanged: () => void;
}) {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const now = Date.now();
  const construction = useConstruction({
    // 공사 중이 아니면 바로 옵션을 읽어 「N마리로 건설하기」 한 버튼으로 짓게 한다
    active: !tracked,
    islandId,
    now,
    // 이 카드는 「각자 몫」 분모를 보여 주지 않는다 — 주민 전체 페이지 조회는 낭비다.
    withMembers: false,
    onStarted: (r, serverIslandId) =>
      onStarted({
        islandId: serverIslandId,
        building: r.buildingId as Building,
        startedAt: Date.parse(r.startedAt),
        endsAt: Date.parse(r.completesAt),
      }),
  });
  // 서버가 배운 섬(모든 요청의 실제 대상)이 이 카드가 받은 홈 스냅샷 섬과 다르면 — 다른 곳에서
  // 섬을 옮긴 것. 건설 버튼을 감추고 새로고침을 유도한다(잘못된 섬에 착공하지 않는다).
  const islandMismatch =
    construction.serverIslandId !== null && construction.serverIslandId !== islandId;
  // 완공 예정 시각이 지나면 「완공 확인」 버튼 없이 스스로 홈을 다시 읽는다. 완공되면 홈 스냅샷이
  // tracked 를 지워 이 effect 도 정리된다.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const timing = tracked
    ? { buildingId: tracked.building, startedAt: tracked.startedAt, completesAt: tracked.endsAt }
    : construction.serverIslandId === islandId && construction.timing?.buildingId === building
      ? construction.timing
      : null;
  const endsAt = timing
    ? typeof timing.completesAt === 'number'
      ? timing.completesAt
      : Date.parse(timing.completesAt)
    : undefined;
  useEffect(() => {
    if (endsAt == null) return;
    let poll: ReturnType<typeof setInterval> | null = null;
    const first = setTimeout(
      () => {
        onChangedRef.current();
        poll = setInterval(() => onChangedRef.current(), COMPLETION_POLL_MS);
      },
      Math.max(0, endsAt - Date.now()),
    );
    return () => {
      clearTimeout(first);
      if (poll) clearInterval(poll);
    };
  }, [endsAt]);
  const name = buildingNames[tracked?.building ?? building];
  const item = construction.options?.items.find((it) => it.id === building);

  let meta: string, bar: number, action: React.ReactNode;
  if (timing) {
    const progress = normalizedConstructionProgress(timing, now);
    meta =
      progress >= 1 ? '완공 처리 중' : `${Math.max(0, Math.ceil((endsAt! - now) / 60000))}분 남음`;
    bar = progress;
    // 완공은 서버 스케줄러 몫 — 위 effect 가 홈을 다시 읽어 자동으로 반영한다
    action = progress >= 1 && <Txt kind="meta">완공 처리 중이에요. 곧 자동으로 반영돼요.</Txt>;
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
  } else if (islandMismatch) {
    meta = '';
    bar = 0;
    action = (
      <>
        <Txt kind="meta">섬 정보가 바뀌었어요</Txt>
        <Btn
          small
          id="server-build-refresh"
          title="새로고침"
          onPress={() => {
            void construction.reload().catch(() => undefined);
            onChanged();
          }}
        />
      </>
    );
  } else if (construction.status === 'loading' || !item) {
    // 옵션에 이 건물이 없다 = 이미 완공 — 홈 스냅샷이 늦은 것이라 다시 읽는다
    meta = `섬 통장 ${villagePoints}마리`;
    bar = 0;
    action =
      construction.status === 'ready' ? (
        <Btn small id="server-build-refresh" title="새로고침" onPress={onChanged} />
      ) : (
        <Txt kind="meta">{pending ? '건설을 시작하는 중' : '건설 정보를 불러오고 있어요'}</Txt>
      );
  } else {
    meta = `${construction.options!.villagePoints}/${item.cost} 마리`;
    bar = Math.min(1, construction.options!.villagePoints / Math.max(1, item.cost));
    action = item.buildable ? (
      <Btn
        small
        id="server-build-start"
        title={pending ? '건설을 시작하는 중' : `${item.cost}마리로 건설하기`}
        disabled={pending}
        onPress={() => {
          setMessage('');
          setPending(true);
          construction.build(building).then(
            () => {
              setPending(false);
              onChanged();
            },
            (error) => {
              setPending(false);
              setMessage(error instanceof Error ? error.message : '건설을 시작하지 못했어요.');
              onChanged();
            },
          );
        }}
      />
    ) : (
      <>
        <Txt kind="meta">{buildBlockedText(item.blockedReason)}</Txt>
        {/* 다른 기기·재시작 등으로 이미 공사 중인데 receipt이 없는 경우 — 옵션을 다시 읽어야 풀린다 */}
        {item.blockedReason === 'IN_PROGRESS' && (
          <Btn
            small
            id="server-build-recheck"
            title="새로고침"
            onPress={() => {
              void construction.reload().catch(() => undefined);
              onChanged();
            }}
          />
        )}
      </>
    );
  }

  return (
    <View testID="server-build-card" style={[style, { gap: primitiveTokens.space[2] }]}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Txt style={{ fontSize: 14, lineHeight: 20.3, fontWeight: '800' }}>
          {name} {timing ? '공사 중' : '짓기'}
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
      <Bar value={bar * 100} />
      {action}
      {/* receipt 확보 뒤에는 재조회 실패 메시지가 「공사 중」과 모순되므로 감춘다 */}
      {!timing && !!message && <Txt kind="meta">{message}</Txt>}
    </View>
  );
}
