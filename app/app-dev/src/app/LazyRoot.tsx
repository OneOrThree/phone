import { t } from '@/i18n';
import React, { Component, Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Btn, Txt } from '@/design-system/patterns';
import { semanticTokens as s } from '@/design-system/tokens';

// 웹 전용: index.web.ts가 루트 화면을 import()로 나눠 받을 때 쓴다(GROMO-2788). 네이티브 진입은 쓰지 않는다.
// 나눈 번들은 배포 직후 HTML과 어긋나거나 회선이 끊기면 받지 못할 수 있다. 한 번 더 받고, 그래도 안 되면
// 흰 화면 대신 다시 불러오기를 보인다. 경계는 화면이 그리다 실패한 경우도 잡으므로 둘을 나눠 알린다.
export type ScreenLoader = () => Promise<{ default: ComponentType }>;
export type ScreenFailure = 'chunk' | 'render';

const CHUNK_FAILED = 'screenChunkFailed';

/** 실패하면 delayMs 뒤에 한 번만 더 받는다. 그래도 실패하면 번들을 받지 못했다는 표식을 단 오류를 던진다. */
export function retryOnce(load: ScreenLoader, delayMs = 1000): ScreenLoader {
  return () =>
    load()
      .catch(() => new Promise<void>((resolve) => setTimeout(resolve, delayMs)).then(load))
      .catch((cause: unknown) => {
        throw Object.assign(new Error('화면 번들을 받지 못했다'), {
          name: 'ScreenChunkError',
          cause,
          [CHUNK_FAILED]: true,
        });
      });
}

const failureOf = (error: unknown): ScreenFailure =>
  (error as Record<string, unknown> | null)?.[CHUNK_FAILED] === true ? 'chunk' : 'render';

type BoundaryProps = {
  children: ReactNode;
  onError?: (failure: ScreenFailure, error: unknown) => void;
  reload: () => void;
};

class LoadErrorBoundary extends Component<BoundaryProps, { failed: ScreenFailure | null }> {
  state: { failed: ScreenFailure | null } = { failed: null };

  static getDerivedStateFromError(error: unknown) {
    return { failed: failureOf(error) };
  }

  componentDidCatch(error: unknown) {
    this.props.onError?.(failureOf(error), error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.page} accessibilityRole="alert">
        <Txt style={styles.message}>
          {this.state.failed === 'chunk' ? t('ui.misc.chunkFailed') : t('ui.misc.renderFailed')}
        </Txt>
        <Btn title={t('onboarding.joinIsland.reload')} onPress={this.props.reload} />
      </View>
    );
  }
}

export function createLazyRoot(
  load: ScreenLoader,
  {
    onError,
    reload,
    retryDelayMs,
  }: {
    onError?: (failure: ScreenFailure, error: unknown) => void;
    reload: () => void;
    retryDelayMs?: number;
  },
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
