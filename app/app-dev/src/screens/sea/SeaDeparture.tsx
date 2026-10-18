import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sailing } from '@/screens/world/WorldViews';
import { Btn } from '@/design-system/patterns';
import { useScreenInsets } from '@/design-system/primitives';
import { semanticTokens } from '@/design-system/tokens';
import type { State } from '@/services/model';
import { t } from '@/i18n';

/** 최초 출항 여부는 호스트가 보관한다. 연출 완료는 집중 세션 종료와 무관하다. */
export function SeaDeparture({
  state,
  hasDepartedBefore,
  onComplete,
}: {
  state: State;
  hasDepartedBefore: boolean;
  onComplete: () => void;
}) {
  const completed = useRef(false);
  const insets = useScreenInsets();
  const finish = () => {
    if (completed.current) return;
    completed.current = true;
    onComplete();
  };
  return (
    <View style={styles.root}>
      <Sailing state={state} destination={t('openSea.name')} onArrive={finish} />
      {hasDepartedBefore && (
        <View
          style={[
            styles.skip,
            {
              right: semanticTokens.spacing.page + insets.right,
              bottom: semanticTokens.spacing.page + insets.bottom,
            },
          ]}
        >
          <Btn title={t('openSea.skip')} kind="glass" onPress={finish} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 }, skip: { position: 'absolute' } });
