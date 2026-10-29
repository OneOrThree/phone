import React, { useEffect, useState, useSyncExternalStore } from 'react';
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
};

/** 목록과 상세 모두 서버에서 현재 게시 기간을 확인한다. 평문 공지를 HTML로 해석하지 않는다. */
export function DeveloperNoticesScreen({ e }: any) {
  const generation = useSyncExternalStore(subscribeSession, sessionGeneration, sessionGeneration);
  const id: string | null = e.route === 'developerNotice' ? e.detail : null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ generation, id, status: 'loading', items: [] });
  const enabled = !!e.islands;

  useEffect(() => {
    let current = true;
    setState({ generation, id, status: 'loading', items: [] });
    // 목업 모드에는 운영 공지를 합성하거나 실제 서버 요청을 보내지 않는다.
    const read = !enabled
      ? Promise.resolve([])
      : id
        ? getDeveloperNotice(id).then((item) => [item])
        : listDeveloperNotices().then((page) => page.items);
    read
      .then((items) => {
        if (current && generation === sessionGeneration()) {
          setState({ generation, id, status: 'ready', items });
        }
      })
      .catch((error: unknown) => {
        if (current && generation === sessionGeneration()) {
          setState({
            generation,
            id,
            items: [],
            status: id && error instanceof ApiError && error.status === 404 ? 'missing' : 'error',
          });
        }
      });
    return () => {
      current = false;
    };
  }, [generation, id, attempt, enabled]);

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
      ) : (
        <Txt kind="meta">{t('developerNotices.empty')}</Txt>
      )}
    </IslandSheet>
  );
}
