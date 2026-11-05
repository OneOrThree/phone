import { Btn, Page } from '@/design-system/patterns';
import { t } from '@/i18n';
import type { ScreenContext } from './useScreenState';

export function renderScreenFallback(context: ScreenContext) {
  const { home } = context;

  return (
    <Page title={t('onboardingStory.brand')} back={home}>
      <Btn title="섬으로 돌아가기" onPress={home} />
    </Page>
  );
}
