import { Btn, C, Txt, art } from '@/design-system/patterns';
import type { ScreenEnvironment } from '@/navigation/ScreenEnvironment';
import { FiModal, OUTLINE } from '@/screens/focus/FishingIsland';
import { useBoardNotices } from '@/screens/interiors/useBoardNotices';
import { pendingQuestRewards } from '@/screens/island/HomeQuestIndicator';
import { ApiError } from '@/services/api/client';
import { State } from '@/services/model';
import { useAppLayout } from '@/utils/layout';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

// 퀘스트 보상받기(갤러리 49 보상 모달): 결과창 다음에 한 번. 받으면 다음 보상이 없을 때 섬으로.
export function RewardModal({
  e,
  onClaimed,
  rewardIslandId,
}: {
  e: ScreenEnvironment;
  onClaimed?: (more: boolean) => void;
  rewardIslandId?: string;
}) {
  const s: State = e.state,
    wide = useAppLayout().width >= 600,
    open = pendingQuestRewards(s.rewards, rewardIslandId),
    reward = open[0];
  if (!reward) return null;
  const owner = s.islands.find((i) => i.id === reward.islandId),
    title = owner?.quests.find((q) => q.id === reward.questId)?.title ?? '퀘스트',
    // 받침 있는 글자 뒤에는 '을'
    particle = (title.charCodeAt(title.length - 1) - 0xac00) % 28 > 0 ? '을' : '를';
  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 20, justifyContent: 'center' }]}
      accessibilityViewIsModal
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#493B3966' }]} />
      <View
        style={{
          marginHorizontal: wide ? 157 : 24,
          backgroundColor: C.paper,
          borderWidth: 2,
          borderColor: OUTLINE,
          borderRadius: 24,
          paddingTop: wide ? 14 : 20,
          paddingHorizontal: 20,
          paddingBottom: wide ? 14 : 18,
          gap: wide ? 10 : 14,
          boxShadow: `0px 6px 0px ${OUTLINE}`,
          alignItems: 'center',
        }}
      >
        <Image source={art.fish} style={{ width: 72, height: 72 }} />
        <Txt kind="h">{reward.kind === 'bonus' ? '모두 해냈어요!' : '퀘스트 달성!'}</Txt>
        <Txt style={{ color: '#796256', textAlign: 'center' }}>
          {reward.kind === 'bonus'
            ? `섬에 보너스 ${reward.amount}마리가 쌓였어요`
            : `${title}${particle} 달성했어요.\n물고기 ${reward.amount}마리를 추가로 받았어요!`}
        </Txt>
        <Btn
          title={reward.kind === 'bonus' ? '좋아요' : '보상받기'}
          id="claim-reward"
          style={{ alignSelf: 'stretch' }}
          onPress={() => {
            e.dispatch({ type: 'CLAIM', id: reward.id });
            onClaimed?.(open.length > 1);
          }}
        />
      </View>
    </View>
  );
}

// 서버 퀘스트 수령 모달 (GROMO-2014): 개인 몫만 POST claims 로 받는다. 지급량은 서버가
// 판정해 응답으로 주고, 성공 뒤 훅이 목록·지갑을 다시 읽는다 — 여기서 로컬 재화를 만지지 않는다.
// 전원 달성 보너스는 수령 버튼이 따로 없고, 서버가 함께 적립한 만큼만 알린다.
export function ServerQuestRewardModal({
  e,
  board,
  onDone,
}: {
  e: ScreenEnvironment;
  board: ReturnType<typeof useBoardNotices>;
  onDone?: (more: boolean) => void;
}) {
  const wide = useAppLayout().width >= 600;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reward = board.quests.find((q) => q.claimable);
  const rewardId = reward?.id;
  // 읽기가 끝났는데(또는 못 읽었는데) 받을 게 없으면 흐름을 닫는다 — 수령은 게시판 상세에도 있다.
  useEffect(() => {
    if ((board.error || !board.loading) && !rewardId) onDone?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.error, board.loading, rewardId]);
  if (board.loading && !reward)
    return (
      <FiModal>
        <Txt kind="h">퀘스트 보상</Txt>
        <Txt style={{ color: '#796256', textAlign: 'center' }}>
          받을 수 있는 보상을 확인하고 있어요…
        </Txt>
      </FiModal>
    );
  if (!reward) return null;
  const title = reward.title,
    // 받침 있는 글자 뒤에는 '을'
    particle = (title.charCodeAt(title.length - 1) - 0xac00) % 28 > 0 ? '을' : '를';
  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 20, justifyContent: 'center' }]}
      accessibilityViewIsModal
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#493B3966' }]} />
      <View
        style={{
          marginHorizontal: wide ? 157 : 24,
          backgroundColor: C.paper,
          borderWidth: 2,
          borderColor: OUTLINE,
          borderRadius: 24,
          paddingTop: wide ? 14 : 20,
          paddingHorizontal: 20,
          paddingBottom: wide ? 14 : 18,
          gap: wide ? 10 : 14,
          boxShadow: `0px 6px 0px ${OUTLINE}`,
          alignItems: 'center',
        }}
      >
        <Image source={art.fish} style={{ width: 72, height: 72 }} />
        <Txt kind="h">퀘스트 달성!</Txt>
        <Txt style={{ color: '#796256', textAlign: 'center' }}>
          {`${title}${particle} 달성했어요.\n물고기 ${reward.reward.amount}마리를 받을 수 있어요!`}
        </Txt>
        {!!error && <Txt style={{ color: '#994C3E', textAlign: 'center' }}>{error}</Txt>}
        <Btn
          title={busy ? '받는 중…' : '보상받기'}
          id="claim-server-reward"
          style={{ alignSelf: 'stretch' }}
          disabled={busy}
          onPress={() => {
            if (busy) return;
            setBusy(true);
            setError('');
            board.claimQuest(reward).then(
              (result) => {
                setBusy(false);
                if (result.bonusAdded > 0)
                  e?.notify?.(`전원 달성 보너스 ${result.bonusAdded}마리도 섬에 함께 쌓였어요`);
                onDone?.(
                  board.quests.some((q) => q.claimable && q.occurrenceId !== reward.occurrenceId),
                );
              },
              (err: unknown) => {
                setBusy(false);
                setError(
                  err instanceof ApiError && err.message
                    ? err.message
                    : '받지 못했어요. 다시 시도해 주세요.',
                );
              },
            );
          }}
        />
      </View>
    </View>
  );
}
