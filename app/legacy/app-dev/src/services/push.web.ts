// 웹 배포에서는 네이티브 FCM/APNs 기능을 제공하지 않는다.
export async function registerPushToken(): Promise<string | null> {
  return null;
}

export function setupPushListeners(): () => void {
  return () => {};
}

export async function handleInitialNotification(): Promise<void> {}
