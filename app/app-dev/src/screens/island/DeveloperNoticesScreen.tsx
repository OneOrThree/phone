import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { Btn, C, Txt } from '@/design-system/patterns';
import { semanticTokens } from '@/design-system/tokens';
import { IslandSheet, SheetGroup, SheetRow } from '@/screens/island/IslandSheet';
import { ApiError } from '@/services/api/client';
import {
  getDeveloperNotice,
  listDeveloperNotices,
  type DeveloperNotice,
} from '@/services/api/developerNotices';
import { sessionGeneration, subscribeSession } from '@/services/api/session';
import { t } from '@/i18n';
import { formatDate } from '@/i18n/format';

type State = {
  generation: number;
  id: string | null;
  status: 'loading' | 'ready' | 'error' | 'missing';
  items: DeveloperNotice[];
  nextCursor: string | null;
};

/** 목록과 상세 모두 서버에서 현재 게시 기간을 확인한다. 평문 공지를 HTML로 해석하지 않는다. */
export function DeveloperNoticesScreen({ e }: any) {
  const generation = useSyncExternalStore(subscribeSession, sessionGeneration, sessionGeneration);
  const id: string | null = e.route === 'developerNotice' ? e.detail : null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({
    generation,
    id,
    status: 'loading',
    items: [],
    nextCursor: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  // 효과가 다시 돌거나 화면이 내려가면(계정·경로·재시도·언마운트) 늦게 온 «더 보기» 응답을 버리기 위한 세대표
  const epoch = useRef(0);
  // 더 보기 중복 탭 방지 — loadingMore 상태는 다음 렌더 전까지 낡아 있어 동기 플래그를 따로 둔다
  const inFlight = useRef(false);
  const enabled = !!e.islands;

  useEffect(() => {
    let current = true;
    inFlight.current = false;
    setLoadingMore(false);
    setState({ generation, id, status: 'loading', items: [], nextCursor: null });
    // 목업 모드에는 운영 공지를 합성하거나 실제 서버 요청을 보내지 않는다.
    const read = !enabled
      ? Promise.resolve({ items: [] as DeveloperNotice[], nextCursor: null })
      : id
        ? getDeveloperNotice(id).then((item) => ({ items: [item], nextCursor: null }))
        : listDeveloperNotices().then((page) => ({
            items: page.items,
            // 옛 서버는 nextCursor 를 안 내린다 — 없으면 마지막 쪽이다
            nextCursor: page.nextCursor ?? null,
          }));
    read
      .then(({ items, nextCursor }) => {
        if (current && generation === sessionGeneration()) {
          setState({ generation, id, status: 'ready', items, nextCursor });
        }
      })
      .catch((error: unknown) => {
        if (current && generation === sessionGeneration()) {
          setState({
            generation,
            id,
            items: [],
            nextCursor: null,
            status: id && error instanceof ApiError && error.status === 404 ? 'missing' : 'error',
          });
        }
      });
    return () => {
      current = false;
      epoch.current += 1;
    };
  }, [generation, id, attempt, enabled]);

  const loadMore = () => {
    const cursor = state.nextCursor;
    if (!cursor || loadingMore || inFlight.current) return;
    const mine = epoch.current;
    const alive = () => mine === epoch.current && generation === sessionGeneration();
    inFlight.current = true;
    setLoadingMore(true);
    listDeveloperNotices(cursor)
      .then((page) => {
        if (!alive()) return;
        setState((prev) => {
          const seen = new Set(prev.items.map((n) => n.publicationId));
          return {
            ...prev,
            items: [...prev.items, ...page.items.filter((n) => !seen.has(n.publicationId))],
            nextCursor: page.nextCursor ?? null,
          };
        });
        inFlight.current = false;
        setLoadingMore(false);
      })
      .catch((error: unknown) => {
        if (!alive()) return;
        inFlight.current = false;
        setLoadingMore(false);
        // 커서가 만료·위조면 첫 쪽부터 다시 읽는다. 그 밖의 실패는 목록·커서를 두고 다시 누르게 한다
        if (
          error instanceof ApiError &&
          (error.code === 'CURSOR_EXPIRED' || error.code === 'INVALID_CURSOR')
        ) {
          setAttempt((value) => value + 1);
        }
      });
  };

  const visible = state.generation === generation && state.id === id ? state : null;
  const status = visible?.status ?? 'loading';
  const item = visible?.items[0];
  return (
    <IslandSheet
      bg="dock"
      sign="boat/raft"
      title={t('developerNotices.title')}
      tall
      onBack={e.back}
      onClose={e.home}
    >
      {status === 'loading' ? (
        <Txt kind="meta">{t('developerNotices.loading')}</Txt>
      ) : status === 'error' || status === 'missing' ? (
        <View style={{ gap: semanticTokens.spacing.component }}>
          <Txt
            style={{ color: status === 'error' ? C.danger : C.muted }}
            accessibilityLiveRegion="polite"
          >
            {t(status === 'missing' ? 'developerNotices.missing' : 'developerNotices.failed')}
          </Txt>
          <Btn
            kind="sec"
            title={t('common.retry')}
            onPress={() => setAttempt((value) => value + 1)}
          />
        </View>
      ) : id && item ? (
        <>
          <Txt kind="title" accessibilityRole="header">
            {item.title}
          </Txt>
          <Txt kind="meta">{formatDate(new Date(item.publishedAt))}</Txt>
          <Txt selectable>{item.body}</Txt>
        </>
      ) : visible?.items.length ? (
        <>
          <SheetGroup flat>
            {visible.items.map((notice) => (
              <SheetRow
                key={notice.publicationId}
                title={notice.title}
                sub={formatDate(new Date(notice.publishedAt))}
                chevron
                onPress={() => e.go('developerNotice', notice.publicationId)}
              />
            ))}
          </SheetGroup>
          {visible.nextCursor ? (
            <Btn
              kind="sec"
              title={t('developerNotices.more')}
              disabled={loadingMore}
              onPress={loadMore}
            />
          ) : null}
        </>
      ) : (
        <Txt kind="meta">{t('developerNotices.empty')}</Txt>
      )}
    </IslandSheet>
  );
}
