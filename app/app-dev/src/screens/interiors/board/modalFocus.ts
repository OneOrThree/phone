const BOARD_MODAL_FOCUSABLES =
  'button:not([disabled]),[role="button"]:not([aria-disabled="true"]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusBoardModal(overlay: HTMLElement | null) {
  if (!overlay?.querySelectorAll || !overlay.focus) return;
  const focusables = Array.from(
    overlay.querySelectorAll<HTMLElement>(BOARD_MODAL_FOCUSABLES),
  ).filter((element) => element.offsetParent !== null);
  (focusables[0] ?? overlay).focus();
}

export function restoreBoardModalOpener(opener: HTMLElement | null) {
  opener?.focus();
}

export function setBoardBackgroundInert(element: HTMLElement | null, inert: boolean) {
  if (!element) return;
  element.inert = inert;
  if (inert && typeof element.setAttribute === 'function') element.setAttribute('inert', '');
  else if (!inert && typeof element.removeAttribute === 'function')
    element.removeAttribute('inert');
}

export function syncBoardModalFocus(
  isOpen: boolean,
  wasOpen: boolean,
  isTopmost: boolean,
  wasTopmost: boolean,
  overlay: HTMLElement | null,
  modalDocument: Document,
  backgrounds: (HTMLElement | null)[],
  opener: HTMLElement | null,
) {
  if (isOpen && !wasOpen) {
    const capturedOpener = modalDocument.activeElement as HTMLElement | null;
    if (isTopmost) {
      setBoardBackgroundInert(overlay, false);
      focusBoardModal(overlay);
    } else setBoardBackgroundInert(overlay, true);
    backgrounds.forEach((element) => setBoardBackgroundInert(element, true));
    return capturedOpener;
  }
  if (isOpen && wasOpen && wasTopmost !== isTopmost) {
    if (isTopmost) {
      setBoardBackgroundInert(overlay, false);
      focusBoardModal(overlay);
    } else setBoardBackgroundInert(overlay, true);
    return opener;
  }
  if (!isOpen && wasOpen) {
    setBoardBackgroundInert(overlay, false);
    backgrounds.forEach((element) => setBoardBackgroundInert(element, false));
    if (wasTopmost) restoreBoardModalOpener(opener);
    return null;
  }
  return opener;
}

export function handleBoardModalKeydown(
  event: KeyboardEvent,
  overlay: HTMLElement,
  modalDocument: Document,
  onEscape: () => void,
) {
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    onEscape();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusables = Array.from(
    overlay.querySelectorAll<HTMLElement>(BOARD_MODAL_FOCUSABLES),
  ).filter((element) => element.offsetParent !== null);
  if (!focusables.length) {
    event.preventDefault();
    overlay.focus();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (
    (event.shiftKey &&
      (modalDocument.activeElement === first || !overlay.contains(modalDocument.activeElement))) ||
    (!event.shiftKey &&
      (modalDocument.activeElement === last || !overlay.contains(modalDocument.activeElement)))
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
