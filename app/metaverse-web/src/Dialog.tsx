import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

// 모든 안내창이 같이 쓰는 모달. 열 때 포커스를 안으로 옮기고 닫으면 연 자리로 돌려준다.
export function Dialog({
  title,
  close,
  children,
  dismissible = true,
  className,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  dismissible?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // 창이 열린 뒤 이 창에서 시작한 누름만 받는다. 길게 눌러 종료하기처럼 창이 열리기 전에
  // 시작한 터치가 끝나며 만드는 클릭은 바깥 막이나 새 창의 버튼을 누르지 않는다.
  const press = useRef<{ inside: boolean; backdrop: boolean; up: boolean }>({
    inside: false,
    backdrop: false,
    up: false,
  });
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) close();
      }}
      onPointerDownCapture={(e) => {
        press.current = {
          inside: true,
          backdrop: e.target === ref.current,
          up: false,
        };
      }}
      onPointerUpCapture={(e) => {
        press.current.up = e.target === ref.current;
      }}
      onClickCapture={(e) => {
        // 같은 누름에서 이어지는 클릭(라벨이 체크박스로 넘기는 클릭 등)도 통과해야 하므로
        // 누름 정보는 다음 pointerdown에서만 바꾼다.
        const started = press.current;
        // detail 0은 키보드·화면 읽기 클릭이다. 포인터 클릭은 이 창에서 누른 것만 통과한다.
        if (e.detail !== 0 && !started.inside) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (
          dismissible &&
          e.target === ref.current &&
          started.backdrop &&
          started.up
        )
          close();
      }}
      aria-labelledby={titleId}
    >
      <div className="dialog-inner">
        <header>
          <h2 id={titleId}>{title}</h2>
          {dismissible && (
            <button className="icon-button" aria-label="닫기" onClick={close}>
              <Icon name="close" />
            </button>
          )}
        </header>
        {children}
      </div>
    </dialog>
  );
}
