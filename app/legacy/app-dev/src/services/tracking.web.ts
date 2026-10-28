// ATT와 Meta App Events는 네이티브 광고 계측용이므로 웹에서는 no-op으로 둔다.
export async function syncAdTracking(): Promise<void> {}

export function logCompleteRegistration(): void {}
