// 한글 입력 모드에서도 같은 물리 키로 이동한다. code가 없는 보조 입력만 key로 보완한다.
const movementCodes: Record<string, string> = {
  KeyW: "w",
  KeyA: "a",
  KeyS: "s",
  KeyD: "d",
  ArrowUp: "arrowup",
  ArrowDown: "arrowdown",
  ArrowLeft: "arrowleft",
  ArrowRight: "arrowright",
};
export function movementKey(
  event: Pick<KeyboardEvent, "code" | "key">,
): string | undefined {
  if (event.code) return movementCodes[event.code];
  const key = event.key.toLowerCase();
  return Object.values(movementCodes).includes(key) ? key : undefined;
}
export function editingText(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "input,textarea,select,dialog,[contenteditable]:not([contenteditable='false'])",
      ),
    )
  );
}
