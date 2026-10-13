import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText, t } from '@/i18n';
import { ApiError, uuid } from '@/services/api/client';
import * as live from '@/services/api/magazine';
import type { MagazineAssets, PromotionDraft, PromotionEditor } from '@/services/api/magazine';
import { magazineMock } from '@/services/api/magazineMock';
import { isMockMode } from '@/services/demoMode';
import { isMemberGateError } from '@/services/memberConversion';
import { intentKeyPool } from '@/services/model';

const DAY = 86_400_000;

/** 목업 모드면 메모리 서버(magazineMock), 아니면 실제 API — 같은 함수 모양이다. */
export const magazineApi = () => (isMockMode() ? magazineMock : live);

export type EditorStatus = 'loading' | 'ready' | 'error' | 'guest' | 'forbidden';
/** 저장 실패 안내 — field 'body' 면 글 칸 아래에, 아니면 화면 아래 줄에 보인다. */
export type EditorProblem = { message: string; field?: 'body' };

/**
 * 오류 코드 → 쓰기 화면 안내(구현계획 5-4 표). reload 는 서버 상태가 바뀌었을 수 있어 화면을 다시 읽어야 하는 경우다.
 * 표에 없는 코드는 공용 errorText 를 쓴다.
 */
export function promotionProblem(err: unknown): EditorProblem & { reload?: boolean } {
  const code = err instanceof ApiError ? err.code : '';
  switch (code) {
    case 'INSUFFICIENT_FUNDS':
      return { message: t('magazine.editor.problem.poor') };
    case 'PROMOTION_WINDOW_CLOSED':
      return { message: t('magazine.editor.problem.windowClosed'), reload: true };
    case 'PROMOTION_ALREADY_REQUESTED_TODAY':
      return { message: t('errors.PROMOTION_ALREADY_REQUESTED_TODAY'), reload: true };
    case 'PROMOTION_PRIVATE_ISLAND':
      return { message: t('magazine.editor.problem.private'), reload: true };
    case 'BANNED_WORD':
    case 'PROMOTION_TEXT_TOO_LONG':
      return { message: errorText(err) || t('magazine.editor.problem.body'), field: 'body' };
    case 'PROMOTION_ASSET_NOT_OWNED':
    case 'PROMOTION_LAYOUT_INVALID':
      return { message: t('magazine.editor.problem.layout'), reload: true };
    case 'PROMOTION_LOCKED':
      return { message: t('magazine.editor.problem.locked'), reload: true };
    case 'PROMOTION_NOT_FOUND':
      return { message: t('magazine.editor.problem.gone'), reload: true };
    case 'FORBIDDEN':
    case 'NOT_OWNER':
      return { message: t('magazine.editor.hostOnly'), reload: true };
    case 'SERVICE_UNAVAILABLE':
    case 'MAGAZINE_NOT_READY':
      return { message: t('magazine.editor.problem.notReady') };
    default:
      return { message: errorText(err) || t('magazine.editor.problem.generic') };
  }
}

/**
 * 홍보 쓰기 화면의 서버 상태 — 불러오기(editor + 재료), 신청·고치기, 07시 다시 열림.
 * 그리는 값(글·틀·스티커)은 화면이 들고, 이 훅은 서버와 오가는 것만 맡는다.
 */
export function usePromotionEditor({
  islandId,
  offerConversion,
  now = Date.now,
}: {
  islandId: string | null;
  /** 게스트 게이트(403 SOCIAL_LOGIN_REQUIRED)면 회원 전환 시트를 연다 — e.conversion?.offer. 열었으면 true */
  offerConversion?: (error: unknown) => boolean;
  now?: () => number;
}) {
  const [status, setStatus] = useState<EditorStatus>('loading');
  const [editor, setEditor] = useState<PromotionEditor | null>(null);
  const [assets, setAssets] = useState<MagazineAssets | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const generation = useRef(0);
  const keys = useRef(intentKeyPool(uuid)).current;
  const offerRef = useRef(offerConversion);
  offerRef.current = offerConversion;

  const reload = useCallback(async () => {
    if (!islandId) return;
    const mine = ++generation.current;
    setStatus('loading');
    const api = magazineApi();
    try {
      // 재료 목록은 실패해도 쓰기는 된다 — 지금 재료는 전부 무료라 앱 표를 그대로 쓴다(보유 검사는 서버가 한다)
      const [nextEditor, nextAssets] = await Promise.all([
        api.getPromotionEditor(islandId),
        api.getMagazineAssets().catch(() => null),
      ]);
      if (mine !== generation.current) return;
      setEditor(nextEditor);
      setAssets(nextAssets);
      setError(null);
      setStatus('ready');
    } catch (err) {
      if (mine !== generation.current) return;
      setError(err);
      if (isMemberGateError(err)) {
        offerRef.current?.(err);
        setStatus('guest');
      } else if (err instanceof ApiError && (err.code === 'FORBIDDEN' || err.code === 'NOT_OWNER'))
        setStatus('forbidden');
      else setStatus('error');
    }
  }, [islandId]);

  useEffect(() => {
    reload();
    return () => {
      generation.current++;
    };
  }, [reload]);

  // 00~07시에 열어 둔 화면은 07시(opensAt)에 다시 읽어 신청 창을 연다
  const opensAt = editor && !editor.window.open ? Date.parse(editor.window.opensAt) : NaN;
  useEffect(() => {
    if (!Number.isFinite(opensAt)) return;
    const id = setTimeout(reload, Math.max(0, Math.min(opensAt - now() + 1000, DAY)));
    return () => clearTimeout(id);
  }, [opensAt, reload, now]);

  /**
   * 신청(다음 호에 아직 안 냈을 때) 또는 고치기(신청 창 안에서 이미 냈을 때). 성공하면 'applied' · 'updated',
   * 실패하면 화면 안내(EditorProblem)를 돌려준다. 신청은 같은 본문 재시도에 같은 멱등 키가 나간다.
   */
  const submit = useCallback(
    async (
      draft: PromotionDraft,
    ): Promise<{ ok: 'applied' | 'updated' } | { problem: EditorProblem }> => {
      if (!islandId || !editor || submitting) return { problem: { message: '' } };
      const api = magazineApi();
      const exact = JSON.stringify(draft);
      setSubmitting(true);
      try {
        if (editor.next) {
          const saved = await api.updatePromotion(islandId, editor.next.promotionId, draft);
          setEditor((cur) => cur && { ...cur, next: cur.next && { ...cur.next, ...saved } });
          return { ok: 'updated' };
        }
        const applied = await api.applyPromotion(islandId, draft, keys.key('apply', exact));
        keys.release('apply', exact);
        setEditor(
          (cur) =>
            cur && {
              ...cur,
              balance: applied.balanceAfter,
              next: {
                ...draft,
                promotionId: applied.promotionId,
                issueDate: applied.issueDate,
                appliedAt: new Date(now()).toISOString(),
                editable: true,
              },
            },
        );
        return { ok: 'applied' };
      } catch (err) {
        if (isMemberGateError(err) && offerRef.current?.(err)) return { problem: { message: '' } };
        const problem = promotionProblem(err);
        if (problem.reload) reload();
        return { problem: { message: problem.message, field: problem.field } };
      } finally {
        setSubmitting(false);
      }
    },
    [islandId, editor, submitting, keys, reload, now],
  );

  return { status, editor, assets, error, submitting, reload, submit };
}
