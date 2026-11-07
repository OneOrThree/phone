import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

// 앱의 집중 종료 버튼과 같은 1.5초 길게 누르기. componentTokens.focusEndHold.durationMs와 맞춘다.
export const HOLD_MS = 1500;
const TAP_MS = 350;
type Source = "pointer" | "key" | "assist";

// 누르는 동안만 진행한다. 손을 떼거나, 버튼 밖으로 나가거나, 창이 가려지면 취소한다.
// 화면 읽기 프로그램처럼 누름을 유지할 수 없는 입력은 한 번 누르면 1.5초 뒤 실행하고 다시 누르면 취소한다.
export function HoldButton({
  label,
  cancelLabel,
  hint,
  icon,
  disabled = false,
  onConfirm,
  onMessage,
}: {
  label: string;
  cancelLabel: string;
  hint: string;
  icon: IconName;
  disabled?: boolean;
  onConfirm: () => void;
  onMessage?: (text: string) => void;
}) {
  const [holding, setHolding] = useState<Source | null>(null);
  const source = useRef<Source | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startedAt = useRef(0);
  const lastKeyAt = useRef(-Infinity);
  const confirm = useRef(onConfirm);
  confirm.current = onConfirm;
  const hintId = useId();

  const stop = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    source.current = null;
    setHolding(null);
  }, []);
  const start = (from: Source) => {
    if (disabled) return;
    stop();
    source.current = from;
    startedAt.current = performance.now();
    setHolding(from);
    timer.current = setTimeout(() => {
      if (source.current !== from) return;
      stop();
      confirm.current();
    }, HOLD_MS);
  };
  const release = (from: Source) => {
    if (source.current !== from) return;
    const tapped = performance.now() - startedAt.current < TAP_MS;
    stop();
    if (tapped) onMessage?.(hint);
  };

  useEffect(() => {
    const cancel = () => stop();
    const hidden = () => {
      if (document.visibilityState !== "visible") stop();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hidden);
      stop();
    };
  }, [stop]);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);

  const holdKey = (key: string) => key === " " || key === "Enter";
  return (
    <>
      <button
        type="button"
        className="hold-button"
        data-holding={holding ?? undefined}
        disabled={disabled}
        aria-describedby={hintId}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // 터치는 누른 버튼에 포인터가 묶여 버튼 밖으로 나가도 leave가 오지 않는다.
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
          start("pointer");
        }}
        onPointerUp={() => release("pointer")}
        onPointerCancel={() => source.current === "pointer" && stop()}
        onPointerLeave={() => source.current === "pointer" && stop()}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (!holdKey(e.key)) return;
          e.preventDefault();
          lastKeyAt.current = performance.now();
          if (!e.repeat && source.current !== "key") start("key");
        }}
        onKeyUp={(e) => {
          if (!holdKey(e.key)) return;
          e.preventDefault();
          lastKeyAt.current = performance.now();
          release("key");
        }}
        onBlur={() => source.current === "key" && stop()}
        onClick={(e) => {
          // 마우스·터치·키보드 누름은 위에서 처리했다. 남은 클릭은 보조 기술이 보낸 것이다.
          if (e.detail !== 0 || performance.now() - lastKeyAt.current < 120)
            return;
          if (source.current === "assist") {
            stop();
            onMessage?.("집중 종료를 취소했어요.");
          } else {
            start("assist");
            onMessage?.("1.5초 후 종료해요. 다시 누르면 취소해요.");
          }
        }}
      >
        <span className="hold-fill" aria-hidden="true" />
        <Icon name={icon} />
        <span>{holding === "assist" ? cancelLabel : label}</span>
      </button>
      <span id={hintId} hidden>
        {hint}
      </span>
    </>
  );
}
