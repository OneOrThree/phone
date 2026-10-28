import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { Btn, CharCount, Field, Group, Row, Txt } from '@/design-system/patterns';
import { primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { ApiError } from '@/services/api/client';
import {
  deleteGuestbookEntry,
  getGuestbook,
  GUESTBOOK_CONTENT_MAX,
  writeGuestbook,
  type GuestbookEntry,
  type GuestbookPage,
} from '@/services/api/islands';
import { sessionGeneration } from '@/services/api/session';
import { islandErrorMessage } from '@/services/islandErrors';
import { clampCodePoints } from '@/utils/codePoints';

/** 앱 셸 문맥(App.tsx 의 e)에서 쓰는 것만 — 없으면 알림·확인은 건너뛴다. */
export type GuestbookEnv = {
  notify?: (text: string) => void;
  confirm?: (
    title: string,
    text: string,
    action: () => void,
    opts?: { ok?: string; destructive?: boolean },
  ) => void;
  /** 게스트 거절(403 SOCIAL_LOGIN_REQUIRED)이면 회원 전환 시트를 열고 true 를 돌려준다. */
  conversion?: { offer: (error: unknown) => boolean };
};

const styles = StyleSheet.create({
  stack: { gap: semanticTokens.spacing.control },
  entry: { gap: primitiveTokens.space[2] },
  actions: { flexDirection: 'row', gap: primitiveTokens.space[2] },
});

/**
 * 호출 시점의 화면 범위(섬·불러오기 한 번)와 로그인 세대를 잡아 둔다 — 그 뒤 섬이 바뀌거나 화면을 떠나거나
 * 계정이 바뀌면 false. 범위는 효과가 시작할 때 새 객체로 바뀌고 정리될 때 null 이 된다.
 */
const aliveGuard = (scope: { current: object | null }) => {
  const mine = scope.current;
  const gen = sessionGeneration();
  return () => mine !== null && scope.current === mine && gen === sessionGeneration();
};

/** 다시 눌러도 같은 거절이 나는 쓰기 오류 — 하루 1개 규칙(409)과 게시판 없음(403). */
const isBlocking = (error: unknown): error is ApiError =>
  error instanceof ApiError &&
  (error.code === 'GUESTBOOK_ALREADY_WRITTEN_TODAY' || error.code === 'FACILITY_LOCKED');

const writeErrorText = (error: unknown): string => {
  const code = error instanceof ApiError ? error.code : '';
  if (code === 'FACILITY_LOCKED') return t('guestbook.error.boardLocked');
  if (code === 'GUESTBOOK_ALREADY_WRITTEN_TODAY') return t('guestbook.error.alreadyWritten');
  if (code === 'SOCIAL_LOGIN_REQUIRED') return t('errors.SOCIAL_LOGIN_REQUIRED');
  return islandErrorMessage(error);
};

/**
 * 섬 방명록 — 30개씩 이어 읽기 + 한 줄(20 코드포인트) 쓰기. 방문자(VisitorBoard)와 주민(게시판)이 같이 쓴다.
 * 섬장(`host`)만 항목마다 [지우기]가 보인다. 차단은 친구 관리, 신고는 설정의 단일 신고센터에서 한다.
 * 게시판이 없는 섬(`boardBuilt=false`)이면 통째로 숨긴다.
 */
export function Guestbook({
  islandId,
  host,
  e,
  onLoadMoreReady,
}: {
  islandId: string;
  host: boolean;
  e?: GuestbookEnv;
  /** 부모의 실제 스크롤이 바닥에 닿으면 부를 함수. 별도의 세로 목록을 중첩하지 않는다. */
  onLoadMoreReady?: (load: (() => void) | null) => void;
}) {
  // loaded === null 이면 로딩 중
  const [loaded, setLoaded] = useState<GuestbookPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const pageRequest = useRef<object | null>(null);
  const failedCursor = useRef<string | null>(null);
  const readCursors = useRef(new Set<string>());
  const deletedIds = useRef(new Set<string>());
  // 쓰기가 위와 같은 이유로 거절되면 그 오류를 들고 있다가 칸 아래 안내로 남기고 칸을 끈다. 섬이 바뀌거나 [다시 불러오기]를
  // 누르면 풀린다 — 목록 응답엔 «오늘 썼는지»가 없어(mine 은 지운 글·30개 밖을 못 본다) 일단 풀고, 서버가 아직 막고 있으면
  // 다음 쓰기의 거절이 다시 막는다. 자정(KST)이 지나도 화면을 나갔다 오지 않고 쓸 수 있게 한다
  const [blocked, setBlocked] = useState<ApiError | null>(null);
  const scope = useRef<object | null>(null);
  // 연타로 같은 글이 두 번 나가지 않게(둘째는 하루 1개 규칙에 걸려 409 가 된다) state 가 아니라 ref 로 막는다
  const writing = useRef(false);
  // 지우는 중인 글 id — ref 는 두 번 확인을 바로 막고, state 는 그 글의 [지우기]를 끄려고 둔다(같이 바뀐다)
  const deleting = useRef(new Set<string>());
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(() => new Set());
  const markDeleting = (id: string, on: boolean) => {
    if (on) deleting.current.add(id);
    else deleting.current.delete(id);
    setDeletingIds(new Set(deleting.current));
  };

  // 쓰던 글은 섬이 바뀔 때만 비운다(다른 섬에 옛 초안이 남지 않게). 같은 섬의 [다시 불러오기]는 아래 효과가 잠금·목록만 새로
  // 받으므로 자정이 지나 잠금이 풀려도 쓰던 글은 그대로 남는다
  useEffect(() => {
    setDraft('');
  }, [islandId]);

  // 섬이 바뀌거나 화면을 떠난 뒤 늦게 온 응답·쓰기 결과는 버린다(세션 세대 포함).
  useEffect(() => {
    scope.current = {};
    const alive = aliveGuard(scope);
    setLoaded(null);
    setFailed(false);
    setBusy(false);
    setBlocked(null);
    setLoadingMore(false);
    setMoreFailed(false);
    pageRequest.current = null;
    failedCursor.current = null;
    readCursors.current.clear();
    deletedIds.current.clear();
    writing.current = false;
    deleting.current.clear();
    setDeletingIds(new Set());
    getGuestbook(islandId)
      .then((page) => {
        if (!alive()) return;
        if (Array.isArray(page?.items)) setLoaded(page);
        else setFailed(true);
      })
      .catch(() => {
        if (alive()) setFailed(true);
      });
    return () => {
      scope.current = null;
    };
  }, [islandId, reload]);

  const loadMore = useCallback(
    async (retry = false) => {
      const cursor = loaded?.nextCursor;
      if (
        !cursor ||
        pageRequest.current ||
        readCursors.current.has(cursor) ||
        (!retry && failedCursor.current === cursor)
      )
        return;
      const own = {};
      pageRequest.current = own;
      const alive = aliveGuard(scope);
      setLoadingMore(true);
      setMoreFailed(false);
      try {
        const page = await getGuestbook(islandId, cursor);
        if (!alive() || pageRequest.current !== own) return;
        if (!Array.isArray(page?.items)) throw new Error('계약과 다른 방명록 페이지예요.');
        readCursors.current.add(cursor);
        setLoaded((current) => {
          if (!current) return current;
          const seen = new Set([...current.items.map((item) => item.id), ...deletedIds.current]);
          const items = page.items.filter((item) => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          });
          return {
            ...current,
            items: [...current.items, ...items],
            nextCursor:
              page.nextCursor && !readCursors.current.has(page.nextCursor) ? page.nextCursor : null,
          };
        });
        failedCursor.current = null;
      } catch {
        if (alive() && pageRequest.current === own) {
          failedCursor.current = cursor;
          setMoreFailed(true);
        }
      } finally {
        if (alive() && pageRequest.current === own) {
          pageRequest.current = null;
          setLoadingMore(false);
        }
      }
    },
    [islandId, loaded?.nextCursor],
  );

  useEffect(() => {
    onLoadMoreReady?.(() => void loadMore());
    return () => onLoadMoreReady?.(null);
  }, [loadMore, onLoadMoreReady]);

  // 서버 목록으로 조용히 다시 맞춘다 — 화면을 비우지 않고 막은 칸·쓰던 글도 그대로 둔다. 실패하면 지금 화면을 둔다
  const refetch = () => {
    const alive = aliveGuard(scope);
    // 목록을 새로 맞추는 동안 옛 커서 요청이 들어와 섞이지 않게 한다.
    pageRequest.current = {};
    failedCursor.current = null;
    readCursors.current.clear();
    setLoadingMore(false);
    setMoreFailed(false);
    getGuestbook(islandId)
      .then((page) => {
        if (alive() && Array.isArray(page?.items)) {
          setLoaded({
            ...page,
            items: page.items.filter((item) => !deletedIds.current.has(item.id)),
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive()) pageRequest.current = null;
      });
  };

  const submit = async () => {
    const content = draft.trim();
    if (!content || writing.current) return;
    const alive = aliveGuard(scope);
    const sent = draft;
    writing.current = true;
    setBusy(true);
    try {
      const entry = await writeGuestbook(islandId, content);
      if (!alive()) return;
      // 칸은 보내는 동안에도 고칠 수 있다 — 보낸 그대로일 때만 비우고, 그새 더 쓴 글은 남긴다
      setDraft((current) => (current === sent ? '' : current));
      setLoaded(
        (page) =>
          page && { ...page, items: [entry, ...page.items.filter((item) => item.id !== entry.id)] },
      );
    } catch (error) {
      if (!alive()) return;
      // 게스트는 친구·편지와 같은 길로 회원 전환 시트에 보낸다
      if (e?.conversion?.offer(error)) return;
      const text = writeErrorText(error);
      if (isBlocking(error)) {
        // 다시 눌러도 같은 거절이다 — 칸 아래 안내만 남기고 칸과 버튼을 끈다. 토스트(전역 live region)를 같이 띄우면
        // 안드로이드가 같은 문장을 두 번 읽는다. 안내의 live region 은 안드로이드 전용이라 iOS 는 한 번 직접 읽어 준다
        setBlocked(error);
        if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text);
        // 응답을 잃은 쓰기도 서버엔 저장됐을 수 있다(재시도가 409) — 서버 목록으로 맞춰 내 글이 보이게 한다
        if (error.code === 'GUESTBOOK_ALREADY_WRITTEN_TODAY') refetch();
      } else if (text) e?.notify?.(text);
    } finally {
      // 섬이 바뀌었으면 효과가 이미 새로 시작하며 잠금을 풀었다 — 옛 쓰기가 새 섬의 잠금을 풀지 않게 살아 있을 때만
      if (alive()) {
        writing.current = false;
        setBusy(false);
      }
    }
  };

  const drop = (id: string) => {
    deletedIds.current.add(id);
    setLoaded((page) => page && { ...page, items: page.items.filter((item) => item.id !== id) });
  };

  const remove = async (entry: GuestbookEntry) => {
    if (deleting.current.has(entry.id)) return; // 이미 지우는 중 — 두 번째 확인은 무시한다
    const alive = aliveGuard(scope);
    markDeleting(entry.id, true);
    try {
      await deleteGuestbookEntry(islandId, entry.id);
      if (!alive()) return;
      drop(entry.id);
      e?.notify?.(t('guestbook.deleted'));
    } catch (error) {
      if (!alive()) return;
      // 이미 지워진 글(404)은 목록에서도 뺀다
      if (error instanceof ApiError && error.code === 'NOT_FOUND') drop(entry.id);
      const text = islandErrorMessage(error);
      if (text) e?.notify?.(text);
    } finally {
      // 섬이 바뀌었으면 효과가 이미 표시를 비웠다
      if (alive()) markDeleting(entry.id, false);
    }
  };

  const askDelete = (entry: GuestbookEntry) =>
    e?.confirm?.(t('guestbook.deleteTitle'), t('guestbook.deleteBody'), () => void remove(entry), {
      ok: t('guestbook.delete'),
      destructive: true,
    });

  // 게시판이 없는 섬 — 방명록을 보이지 않는다
  if (loaded && !loaded.boardBuilt) return null;

  return (
    <View style={styles.stack}>
      <Txt kind="h17">{t('guestbook.title')}</Txt>
      {failed ? (
        <>
          <Txt accessibilityRole="alert">{t('guestbook.loadFailed')}</Txt>
          <Btn
            title={t('guestbook.reload')}
            onPress={() => setReload((count) => count + 1)}
            id="guestbook-reload"
          />
        </>
      ) : !loaded ? (
        <Txt kind="meta" accessibilityLiveRegion="polite">
          {t('guestbook.loading')}
        </Txt>
      ) : (
        <>
          {/* 한 줄 20 코드포인트 — TextInput maxLength 는 UTF-16 이라 🐟 가 2로 세어 onChange 에서 자른다 */}
          <Field
            label={t('guestbook.inputLabel')}
            placeholder={t('guestbook.inputPlaceholder', { max: GUESTBOOK_CONTENT_MAX })}
            value={draft}
            onChange={(value: string) => setDraft(clampCodePoints(value, GUESTBOOK_CONTENT_MAX))}
            disabled={!!blocked}
          />
          <CharCount value={draft} max={GUESTBOOK_CONTENT_MAX} codePoints />
          {!!blocked && (
            <Txt
              kind="meta"
              accessibilityLiveRegion="polite"
              style={{ color: semanticTokens.color.danger }}
            >
              {writeErrorText(blocked)}
            </Txt>
          )}
          <Btn
            title={busy ? t('guestbook.writing') : t('guestbook.write')}
            disabled={busy || !draft.trim() || !!blocked}
            onPress={() => void submit()}
            id="guestbook-submit"
          />
          {!!blocked && (
            <Btn
              title={t('guestbook.reload')}
              kind="sec"
              onPress={() => setReload((count) => count + 1)}
              id="guestbook-reload"
            />
          )}
          {loaded.items.length ? (
            <Group>
              {loaded.items.map((entry) => {
                const author = entry.authorName ?? t('guestbook.formerResident');
                return (
                  <Row
                    key={entry.id}
                    title={entry.content}
                    sub={
                      <View style={styles.entry}>
                        <Txt kind="meta">{author}</Txt>
                        {host && (
                          <View style={styles.actions}>
                            {/* 같은 제목의 버튼이 항목마다 되풀이된다 — 읽는 이름에 어느 글·누구인지 담는다 */}
                            <Btn
                              small
                              kind="sec"
                              title={t('guestbook.delete')}
                              accessibilityLabel={`${t('guestbook.delete')}: ${entry.content}`}
                              disabled={deletingIds.has(entry.id)}
                              onPress={() => askDelete(entry)}
                              id={`guestbook-delete-${entry.id}`}
                            />
                          </View>
                        )}
                      </View>
                    }
                  />
                );
              })}
            </Group>
          ) : (
            <Txt kind="meta" accessibilityLiveRegion="polite">
              {t('guestbook.empty')}
            </Txt>
          )}
          {loadingMore && (
            <Txt kind="meta" accessibilityLiveRegion="polite">
              {t('guestbook.loading')}
            </Txt>
          )}
          {moreFailed && (
            <>
              <Txt kind="meta" accessibilityRole="alert">
                {t('guestbook.loadMoreFailed')}
              </Txt>
              <Btn
                kind="sec"
                id="guestbook-more-retry"
                title={t('common.retry')}
                onPress={() => void loadMore(true)}
              />
            </>
          )}
        </>
      )}
    </View>
  );
}
