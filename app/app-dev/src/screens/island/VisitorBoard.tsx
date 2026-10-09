import React, { useEffect, useRef, useState } from 'react';
import { IslandSheet } from '@/screens/island/IslandSheet';
import { Btn, Group, Row, Txt } from '@/design-system/patterns';
import { getNotice, listNotices, type NoticeDetail, type NoticePage } from '@/services/api/notices';
import { sessionGeneration } from '@/services/api/session';
import { islandErrorMessage } from '@/services/islandErrors';

/** 방문자·가입 대기자는 공지와 댓글만 읽는다. 주민 전용 /screens/board와 쓰기 API는 호출하지 않는다. */
export function VisitorBoard({
  islandId,
  onClose,
  backOverride,
}: {
  islandId: string;
  onClose: () => void;
  backOverride?: React.RefObject<(() => boolean) | null>;
}) {
  const [page, setPage] = useState<NoticePage>({ items: [], nextCursor: null });
  const [detail, setDetail] = useState<NoticeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [failedRead, setFailedRead] = useState<{ id?: string; cursor?: string } | null>(null);
  const epoch = useRef(0);
  const pending = useRef<object | null>(null);
  const back = () => {
    if (!detail) return onClose();
    ++epoch.current;
    setDetail(null);
    setLoading(false);
    setError('');
    setFailedRead(null);
    pending.current = null;
  };
  useEffect(() => {
    if (!backOverride) return;
    backOverride.current = () => {
      back();
      return true;
    };
    return () => {
      backOverride.current = null;
    };
  });
  useEffect(() => {
    const own = ++epoch.current;
    pending.current = null;
    setFailedRead(null);
    setDetail(null);
    setPage({ items: [], nextCursor: null });
    setError('');
    setLoading(true);
    const gen = sessionGeneration();
    const alive = () => epoch.current === own && gen === sessionGeneration();
    listNotices(islandId)
      .then((next) => {
        if (alive()) setPage(next);
      })
      .catch((thrown) => {
        if (alive()) setError(islandErrorMessage(thrown, 'board'));
      })
      .finally(() => {
        if (alive()) setLoading(false);
      });
    return () => {
      ++epoch.current;
    };
  }, [islandId, reload]);
  const read = async (id?: string, cursor?: string) => {
    if (pending.current || loading) return;
    const request = {};
    pending.current = request;
    setFailedRead(null);
    const own = epoch.current,
      gen = sessionGeneration();
    const alive = () => epoch.current === own && gen === sessionGeneration();
    setLoading(true);
    setError('');
    try {
      if (id) {
        const next = await getNotice(islandId, id, cursor);
        if (alive())
          setDetail((previous) =>
            cursor && previous?.id === id
              ? {
                  ...next,
                  comments: [
                    ...previous.comments,
                    ...next.comments.filter(
                      (item) => !previous.comments.some((old) => old.id === item.id),
                    ),
                  ],
                }
              : next,
          );
      } else {
        const next = await listNotices(islandId, cursor);
        if (alive())
          setPage((previous) => ({
            ...next,
            items: [
              ...previous.items,
              ...next.items.filter((item) => !previous.items.some((old) => old.id === item.id)),
            ],
          }));
      }
    } catch (thrown) {
      if (alive()) {
        setError(islandErrorMessage(thrown, 'board'));
        setFailedRead({ id, cursor });
      }
    } finally {
      if (pending.current === request) pending.current = null;
      if (alive()) setLoading(false);
    }
  };
  return (
    <IslandSheet
      bg="board"
      sign="bld/notice-board"
      title="게시판"
      tall
      onBack={back}
      onClose={onClose}
    >
      <Txt kind="meta">방문 중에는 공지와 댓글을 읽을 수 있어요. 작성은 주민만 할 수 있어요.</Txt>
      {detail ? (
        <>
          <Txt kind="h17">{detail.title}</Txt>
          <Txt>{detail.body}</Txt>
          <Group>
            {detail.comments.map((comment) => (
              <Row key={comment.id} title={comment.name ?? '떠난 주민'} sub={comment.text} />
            ))}
          </Group>
          {detail.nextCommentsCursor && (
            <Btn
              title="댓글 더 보기"
              disabled={loading}
              onPress={() => {
                void read(detail.id, detail.nextCommentsCursor!);
              }}
            />
          )}
        </>
      ) : (
        <>
          <Group>
            {page.items.map((notice) => (
              <Row
                key={notice.id}
                title={notice.title}
                sub={`댓글 ${notice.commentCount}개`}
                disabled={loading}
                onPress={() => {
                  void read(notice.id);
                }}
              />
            ))}
          </Group>
          {!loading && !error && !page.items.length && <Txt>아직 공지가 없어요.</Txt>}
          {page.nextCursor && (
            <Btn
              title="공지 더 보기"
              disabled={loading}
              onPress={() => {
                void read(undefined, page.nextCursor!);
              }}
            />
          )}
        </>
      )}
      {loading && <Txt>불러오고 있어요.</Txt>}
      {!!error && (
        <>
          <Txt accessibilityRole="alert">{error}</Txt>
          <Btn
            title="다시 불러오기"
            disabled={loading}
            onPress={() => {
              if (failedRead) void read(failedRead.id, failedRead.cursor);
              else setReload((value) => value + 1);
            }}
          />
        </>
      )}
    </IslandSheet>
  );
}
