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
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(t, {
      toValue: 1,
      duration: 450,
      delay: [120, 220, 320][index] ?? 0,
      easing: Easing.bezier(0.16, 0.8, 0.25, 1),
      useNativeDriver: false,
    }).start();
  }, [index, reduceMotion, t]);
  const complete = quest.rate === 100;
  // 웹은 부모의 perspective:700px 를 쓰고, 네이티브는 transform 안에 넣는다
  const unfold: any = reduceMotion
    ? null
    : {
        opacity: t,
        transform: [
          ...(Platform.OS === 'web' ? [] : [{ perspective: 700 }]),
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-18, 0] }) },
          { rotateX: t.interpolate({ inputRange: [0, 1], outputRange: ['-65deg', '0deg'] }) },
          { scaleY: t.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
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
          ? `하루 폰 사용 ${quest.target}분 이하`
          : quest.startTime
            ? `${quest.startTime}–${quest.endTime} · ${quest.target}분 집중`
            : `${quest.target}분 집중`}
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
            <Text style={boardFont(13, 1.6, '400', '#786147')}>내 달성률</Text>
            <Text style={boardFont(13, 1.6, '700')}>
              {quest.rate == null ? '측정 전' : `${quest.rate}%`}
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
                ? '보상 수령 완료'
                : `보상 받을 수 있어요${quest.rewardAmount != null ? ` · ${quest.rewardAmount}마리` : ''}`}
            </Text>
          )}
        </>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 7 }}>
        <Link
          testID={`board-quest-detail-${index}`}
          label="자세히 보기 ›"
          onPress={onDetail}
          minTapHeight={44}
        />
      </View>
    </Animated.View>
  );
}
