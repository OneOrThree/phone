import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type PostHog from 'posthog-react-native';

// PostHog project tokens are public client identifiers. Keep this fallback so release builds
// collect events even when the build pipeline has no EXPO_PUBLIC_POSTHOG_* variables.
const projectToken =
  process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN ??
  'phc_qMSBVxjxBxYWMvSYoNY5B9n7oL4NxdzitvhngEDfKGGC';
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let client: PostHog | null = null;

/** Product analytics only. Replay and touch capture stay off until sensitive screens are reviewed. */
export function initPostHog(): void {
  if (client || !projectToken || !host) return;
  if (__DEV__ && process.env.EXPO_PUBLIC_POSTHOG_DEV_ENABLED !== '1') return;
  if (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).has('review') ||
      new URLSearchParams(window.location.search).has('demo'))
  )
    return;

  try {
    const PostHogClient = require('posthog-react-native').default as typeof PostHog;
    client = new PostHogClient(projectToken, {
      host,
      customStorage: AsyncStorage,
      captureAppLifecycleEvents: false,
      enableSessionReplay: false,
      disableGeoip: true,
    });
  } catch {
    // Analytics must never prevent the app from starting.
  }
}

export function trackPostHogScreen(route: string): void {
  if (!client) return;
  void client.screen(route).catch(() => {});
}

export function captureProductEvent(
  event: string,
  properties?: Record<string, string | number>,
): void {
  try {
    client?.capture(event, properties);
  } catch {
    // Product actions must not fail when telemetry does.
  }
}

export function identifyPostHogUser(userId: string): void {
  try {
    client?.identify(userId);
  } catch {}
}

export function resetPostHogUser(): void {
  try {
    client?.reset();
  } catch {}
}
