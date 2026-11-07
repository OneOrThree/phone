import React, { Component, Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Btn, Txt } from '@/design-system/patterns';
import { semanticTokens as s } from '@/design-system/tokens';

// 웹 루트 화면을 import()로 나눠 받는다(GROMO-2788, index.web.ts).
// 나눈 번들은 배포 직후 HTML과 어긋나거나 회선이 끊기면 받지 못할 수 있다. 한 번 더 받고, 그래도 안 되면
// 흰 화면 대신 다시 불러오기를 보인다.
export type ScreenLoader = () => Promise<{ default: ComponentType }>;

/** 실패하면 delayMs 뒤에 한 번만 더 받는다. */
export function retryOnce(load: ScreenLoader, delayMs = 1000): ScreenLoader {
  return () =>
    load().catch(() => new Promise<void>((resolve) => setTimeout(resolve, delayMs)).then(load));
}

type BoundaryProps = {
  children: ReactNode;
  onError?: (error: unknown) => void;
  reload: () => void;
};

class LoadErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError?.(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.page} accessibilityRole="alert">
        <Txt style={styles.message}>
          화면을 불러오지 못했어요. 연결을 확인하고 다시 불러와 주세요.
        </Txt>
        <Btn title="다시 불러오기" onPress={this.props.reload} />
      </View>
    );
  }
}

export function createLazyRoot(
  load: ScreenLoader,
  {
    onError,
    reload = () => window.location.reload(),
    retryDelayMs,
  }: { onError?: (error: unknown) => void; reload?: () => void; retryDelayMs?: number } = {},
) {
  const Screen = lazy(retryOnce(load, retryDelayMs));
  return function LazyRoot() {
    return (
      <LoadErrorBoundary onError={onError} reload={reload}>
        <Suspense fallback={null}>
          <Screen />
        </Suspense>
      </LoadErrorBoundary>
    );
  };
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: s.spacing.component,
    padding: s.spacing.page,
    backgroundColor: s.color.canvas,
  },
  message: { textAlign: 'center' },
});
