import { t } from '@/i18n';
import { semanticTokens } from '@/design-system/tokens';
import { GOWUN } from '@/screens/island/sceneKit';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import { INK } from '../shared/styles';
import { Text, boardFont } from '../shared/typography';
import { Link, Track } from './BoardControls';
import { QuestView } from './types';

// .quest-sheet-card: 목록이 펼쳐질 때 @keyframes quest-paper-open .45s cubic-bezier(.16,.8,.25,1), 1~3번째는 .12/.22/.32s 늦게
export function QuestCard({
  quest,
  index,
  reduceMotion,
  onDetail,
  visitor,
}: {
  quest: QuestView;
  index: number;
  reduceMotion: boolean;
  onDetail: () => void;
  visitor?: boolean;
}) {
  const unfoldProgress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(unfoldProgress, {
      toValue: 1,
      duration: 450,
      delay: [120, 220, 320][index] ?? 0,
      easing: Easing.bezier(0.16, 0.8, 0.25, 1),
      useNativeDriver: false,
    }).start();
  }, [index, reduceMotion, unfoldProgress]);
  const complete = quest.rate === 100;
  // 웹은 부모의 perspective:700px 를 쓰고, 네이티브는 transform 안에 넣는다
  const unfold: any = reduceMotion
    ? null
    : {
        opacity: unfoldProgress,
        transform: [
          ...(Platform.OS === 'web' ? [] : [{ perspective: 700 }]),
          { translateY: unfoldProgress.interpolate({ inputRange: [0, 1], outputRange: [-18, 0] }) },
          {
            rotateX: unfoldProgress.interpolate({
              inputRange: [0, 1],
              outputRange: ['-65deg', '0deg'],
            }),
          },
          { scaleY: unfoldProgress.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
        ],
      };
  return (
    <Animated.View
      style={[
        {
          paddingVertical: 10,
          paddingHorizontal: 2,
          borderBottomWidth: 1,
          borderColor: '#b9965866',
          borderStyle: 'dashed',
          transformOrigin: 'center top',
        },
        unfold,
      ]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <Text style={boardFont(18, 1.2, '700', INK)}>{quest.title}</Text>
      </View>
      <Text style={[boardFont(12, 1.45, '400', '#786147', GOWUN), { marginTop: 5 }]}>
        {quest.type === 'phone'
          ? t('ui.board.phoneLimit', { v0: quest.target })
          : quest.startTime
            ? t('ui.board.scheduledGoal', {
                v0: quest.startTime,
                v1: quest.endTime ?? '—',
                v2: quest.target,
              })
            : t('ui.board.focusMinutes', { v0: quest.target })}
      </Text>
      {/* 방문자는 이 섬 퀘스트에 참여하지 않으므로 내 달성률이 없다 */}
      {!visitor && (
        <>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 8,
              marginVertical: 7,
            }}
          >
            <Text style={boardFont(13, 1.6, '400', '#786147')}>{t('ui.board.myProgress')}</Text>
            <Text style={boardFont(13, 1.6, '700')}>
              {quest.rate == null ? t('focusFlow.result.notMeasuredYet') : `${quest.rate}%`}
            </Text>
          </View>
          <Track
            rate={quest.rate ?? 0}
            color={complete ? '#7eaa71' : '#c9943f'}
            style={{ height: 5, backgroundColor: '#b99e5b33' }}
          />
          {/* 수령 상태는 서버 필드가 정본 — 수령 가능/완료를 진행률과 섞지 않는다 */}
          {(quest.claimed || quest.claimable) && (
            <Text
              style={[
                boardFont(12, 1.45, '700', semanticTokens.color.textMuted, GOWUN),
                { marginTop: 6 },
              ]}
            >
              {quest.claimed
                ? t('ui.board.rewardClaimed')
                : t('ui.board.rewardReady', {
                    v0:
                      quest.rewardAmount != null
                        ? t('ui.board.fishSuffix', { v0: quest.rewardAmount })
                        : '',
                  })}
            </Text>
          )}
        </>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 7 }}>
        <Link
          testID={`board-quest-detail-${index}`}
          label={t('ui.board.viewDetails')}
          onPress={onDetail}
          minTapHeight={44}
        />
      </View>
    </Animated.View>
  );
}
