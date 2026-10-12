import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { UserSafetySheet } from '@/components/UserSafetySheet';
import { Btn, CharCount, Field, Group, Row, Txt } from '@/design-system/patterns';
import { primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { ApiError } from '@/services/api/client';
import {
  deleteGuestbookEntry,
  getGuestbook,
  GUESTBOOK_CONTENT_MAX,
  GUESTBOOK_LIST_MAX,
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
 * 섬 방명록(GROMO-2263) — 최근 30개 목록 + 한 줄(20 코드포인트) 쓰기. 방문자(VisitorBoard)와 주민(게시판)이 같이 쓴다.
 * 섬장(`host`)만 항목마다 [지우기]·[신고]가 보인다(본인 글에는 [신고] 없음). 신고는 서버 엔드포인트가 없어(운영 이메일 정책) 기존 유저 신고
 * 창(UserSafetySheet)을 연다. 게시판이 없는 섬(`boardBuilt=false`)이면 통째로 숨긴다.
 */
export function Guestbook({
  islandId,
  host,
  e,
}: {
  islandId: string;
  host: boolean;
  e?: GuestbookEnv;
}) {
  // loaded === null 이면 로딩 중
  const [loaded, setLoaded] = useState<GuestbookPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // 쓰기가 위와 같은 이유로 거절되면 그 오류를 들고 있다가 칸 아래 안내로 남기고 칸을 끈다 — 섬이 바뀌거나 다시 불러오면 풀린다
  const [blocked, setBlocked] = useState<ApiError | null>(null);
  const [reporting, setReporting] = useState<GuestbookEntry | null>(null);
  const scope = useRef<object | null>(null);
  // 연타로 같은 글이 두 번 나가지 않게(둘째는 하루 1개 규칙에 걸려 409 가 된다) state 가 아니라 ref 로 막는다
  const writing = useRef(false);

  // 섬이 바뀌거나 화면을 떠난 뒤 늦게 온 응답·쓰기 결과는 버린다(세션 세대 포함).
  useEffect(() => {
    scope.current = {};
    const alive = aliveGuard(scope);
    setLoaded(null);
    setFailed(false);
    setDraft('');
    setBusy(false);
    setBlocked(null);
    writing.current = false;
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
        (page) => page && { ...page, items: [entry, ...page.items].slice(0, GUESTBOOK_LIST_MAX) },
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
      } else if (text) e?.notify?.(text);
    } finally {
      // 섬이 바뀌었으면 효과가 이미 새로 시작하며 잠금을 풀었다 — 옛 쓰기가 새 섬의 잠금을 풀지 않게 살아 있을 때만
      if (alive()) {
        writing.current = false;
        setBusy(false);
      }
    }
  };

  const drop = (id: string) =>
    setLoaded((page) => page && { ...page, items: page.items.filter((item) => item.id !== id) });

  const remove = async (entry: GuestbookEntry) => {
    const alive = aliveGuard(scope);
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
                              onPress={() => askDelete(entry)}
                              id={`guestbook-delete-${entry.id}`}
                            />
                            {/* 섬장 본인이 쓴 글은 신고·차단할 대상이 아니다 */}
                            {!entry.mine && (
                              <Btn
                                small
                                kind="sec"
                                title={t('guestbook.report')}
                                accessibilityLabel={`${t('guestbook.report')}: ${author}`}
                                onPress={() => setReporting(entry)}
                                id={`guestbook-report-${entry.id}`}
                              />
                            )}
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
        </>
      )}
      {reporting && (
        <UserSafetySheet
          visible
          targetUserId={reporting.authorId}
          targetName={reporting.authorName ?? t('guestbook.formerResident')}
          reportTargetType="USER"
          reportTargetId={reporting.authorId}
          reportEvidence={reporting.content}
          onClose={() => setReporting(null)}
          onMessage={(message) => e?.notify?.(message)}
        />
      )}
    </View>
  );
}
