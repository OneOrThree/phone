export function confirmEditorLeave(contentDirty: boolean, policyDirty: boolean, confirmDiscard: () => boolean): boolean {
  return (!contentDirty && !policyDirty) || confirmDiscard();
}
