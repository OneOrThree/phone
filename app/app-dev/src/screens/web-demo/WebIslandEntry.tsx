import { Btn, Txt } from '@/design-system/patterns';
import { primitiveTokens, semanticTokens } from '@/design-system/tokens';
import type { ScreenEnvironment } from '@/navigation/ScreenEnvironment';
import { sessionGeneration } from '@/services/api/session';
import { enterSharedWebIsland } from '@/services/webIsland';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/** 온보딩 완료·재접속 실패 모두 같은 입장 재시도를 제공한다. */
export function WebIslandEntry({ e }: { e: ScreenEnvironment }) {
  const latest = useRef(e);
  latest.current = e;
  const mounted = useRef(false);
  const busy = useRef(false);
  const [pending, setPending] = useState(true);
  const [failed, setFailed] = useState(false);
  const enter = async () => {
    if (busy.current) return;
    busy.current = true;
    const generation = sessionGeneration();
    const live = () => mounted.current && generation === sessionGeneration();
    setPending(true);
    setFailed(false);
    try {
      const assigned = await enterSharedWebIsland();
      if (!live()) return;
      const current = await latest.current.islands?.sync();
      if (!current || current.currentIslandId !== assigned.id)
        throw new Error('웹 섬 상태를 다시 확인해야 해요.');
      if (!live()) return;
      latest.current.dispatch({ type: 'ONBOARDING_STORY', checkpoint: 'done' });
      latest.current.reset('home');
    } catch {
      if (live()) setFailed(true);
    } finally {
      busy.current = false;
      if (live()) setPending(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void enter();
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <View style={styles.page} testID="web-island-entry">
      <Txt style={styles.title}>함께 집중할고양</Txt>
      <Txt>웹에서 만난 고양이들과 같은 섬에서 집중해요.</Txt>
      {failed && (
        <Txt accessibilityRole="alert">섬에 들어가지 못했어요. 잠시 뒤 다시 시도해 주세요.</Txt>
      )}
      <Btn
        title={pending ? '섬에 들어가는 중…' : '다시 들어가기'}
        disabled={pending}
        onPress={enter}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: primitiveTokens.space[6],
    padding: primitiveTokens.space[6],
    backgroundColor: semanticTokens.color.canvas,
  },
  title: { fontSize: primitiveTokens.fontSize.xl, color: semanticTokens.color.text },
});
