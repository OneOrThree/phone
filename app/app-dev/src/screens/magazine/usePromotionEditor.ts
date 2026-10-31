import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText, t } from '@/i18n';
import { ApiError, uuid } from '@/services/api/client';
import { sessionGeneration, subscribeSession } from '@/services/api/session';
import { captureProductEvent } from '@/services/posthog';
import * as live from '@/services/api/magazine';
import type { MagazineAssets, PromotionDraft, PromotionEditor } from '@/services/api/magazine';
import { magazineMock } from '@/services/api/magazineMock';
import { isMockMode } from '@/services/demoMode';
import { isMemberGateError } from '@/services/memberConversion';
import { intentKeyPool } from '@/services/model';

const DAY = 86_400_000;
/** 호는 그 날짜 KST 07:00 에 나온다 — 마감(KST 00:00)에서 7시간 뒤. */
const PUBLISH_AFTER_DEADLINE = 7 * 3_600_000;

/**
 * 신청 성공을 받은 때가 그 호의 어디인가 — 마감(호 날짜 KST 00:00) 전이면 고칠 수 있고, 마감 뒤 발행(07:00) 전이면 잠긴 칸,
 * 발행 뒤면 이미 나온 호다(늦은 응답 · 응답 유실 뒤 같은 키 재시도의 재생). issueDate 가 어긋난 값이면 고칠 수 있다고 본다.
 */
export type AppliedPhase = 'open' | 'locked' | 'published';
export function appliedPhase(issueDate: string, at: number): AppliedPhase {
  const deadline = Date.parse(`${issueDate}T00:00:00+09:00`);
  if (at >= deadline + PUBLISH_AFTER_DEADLINE) return 'published';
  return at >= deadline ? 'locked' : 'open';
}

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
      // 연 뒤에 다른 주민·기기가 섬 통장을 써서 줄었을 수 있다 — 다시 읽어 실제 잔액과 꺼진 버튼을 보인다
      return { message: t('magazine.editor.problem.poor'), reload: true };
    case 'PROMOTION_WINDOW_CLOSED':
      return { message: t('magazine.editor.problem.windowClosed'), reload: true };
    case 'PROMOTION_ALREADY_REQUESTED_TODAY':
      return { message: t('errors.PROMOTION_ALREADY_REQUESTED_TODAY'), reload: true };
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
    setAssets(null);
    const api = magazineApi();
    try {
      // 보유 재료가 확인된 뒤 편집을 연다. 실패하면 기존 오류 화면에서 다시 읽는다.
      const [nextEditor, nextAssets] = await Promise.all([
        api.getPromotionEditor(islandId),
        api.getMagazineAssets(),
      ]);
      if (mine !== generation.current) return;
      setAssets(nextAssets);
      setEditor(nextEditor);
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

  // 신청 창이 바뀌는 시각에 다시 읽는다 — 열려 있으면 자정(closesAt)에 읽기 전용으로, 00~07시면 07시(opensAt)에 다시 연다
  const switchAt = editor
    ? Date.parse(editor.window.open ? editor.window.closesAt : editor.window.opensAt)
    : NaN;
  useEffect(() => {
    // 이미 지난 시각이면(기기 시계가 서버보다 빠름) 바로 다시 읽기를 되풀이하지 않는다 — 서버 거절 코드가 다시 읽게 한다
    if (!Number.isFinite(switchAt) || switchAt <= now()) return;
    const id = setTimeout(reload, Math.min(switchAt - now() + 1000, DAY));
    return () => clearTimeout(id);
  }, [switchAt, reload, now]);

  // 게스트 섬장이 회원 전환을 마치면(새 세션) 그 자리에서 다시 읽는다 — 화면을 나갔다 들어오지 않아도 된다
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    let seen = sessionGeneration();
    return subscribeSession(() => {
      if (sessionGeneration() === seen) return;
      seen = sessionGeneration();
      if (statusRef.current === 'guest') reload();
    });
  }, [reload]);

  /**
   * 신청(다음 호에 아직 안 냈을 때) 또는 고치기(신청 창 안에서 이미 냈을 때). 성공하면 'applied' · 'updated',
   * 실패하면 화면 안내(EditorProblem)를 돌려준다. 신청은 같은 본문 재시도에 같은 멱등 키가 나간다.
   */
  const submit = useCallback(
    async (
      draft: PromotionDraft,
    ): Promise<
      | { ok: 'updated' }
      | { ok: 'applied'; issueDate: string; phase: AppliedPhase }
      | { problem: EditorProblem }
    > => {
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
        // 신규 홍보 신청으로 섬 통장(물고기)에서 실제 차감된 수수료 1회 — 창 안 수정(editor.next)은 무료라 제외
        captureProductEvent('fish_spent', { reason: 'promotion', amount: applied.feeFish });
        const phase = appliedPhase(applied.issueDate, now());
        if (phase === 'published') {
          // 이미 나온 호다 — 앞으로 실릴 칸(next)으로 넣지 않고 지난 칸(latest)으로만 둔다. 07시 다시 읽기가 먼저 받아 온
          // 새 신청 창(window · next · 잔액)은 덮지 않고, 서버 상태는 다시 읽어 맞춘다
          setEditor(
            (cur) =>
              cur && {
                ...cur,
                latest:
                  cur.latest && cur.latest.issueDate >= applied.issueDate
                    ? cur.latest
                    : { ...draft, promotionId: applied.promotionId, issueDate: applied.issueDate },
              },
          );
          reload();
          return { ok: 'applied', issueDate: applied.issueDate, phase };
        }
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
                // 응답이 늦는 사이 자정 재조회가 창 닫힘을 받아 왔거나 이미 마감이 지났으면 그대로 잠근다(늦은 성공이 마감을 덮지 않게)
                editable: phase === 'open' && cur.window.open && cur.next?.editable !== false,
              },
            },
        );
        return { ok: 'applied', issueDate: applied.issueDate, phase };
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
