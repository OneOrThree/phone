import { isNearScrollEnd } from '@/utils/scrollEnd';
import React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { webOnly } from './styles';

// 스크롤 패널: 웹은 원본처럼 overflow-y:auto 인 div (ScrollView는 translateZ(0)을 붙여 그리기가 달라진다)
// overscroll-behavior 는 원본처럼 공지 패널에만 준다: 붙이면 크롬이 패널을 합성 레이어로 올려 색이 1씩 달라진다
export function Scroll({
  style,
  children,
  testID,
  onEndReached,
  scrollEnabled = true,
  contentContainerStyle,
}: {
  style: any;
  children: React.ReactNode;
  testID?: string;
  onEndReached?: () => void;
  // 스크롤을 잠가도 같은 트리를 유지한다 — 감싸는 요소가 바뀌면 안의 TextInput 이 새로 마운트돼 포커스·키보드를 잃는다
  scrollEnabled?: boolean;
  contentContainerStyle?: any;
}) {
  if (Platform.OS !== 'web')
    return (
      <ScrollView
        testID={testID}
        style={style}
        scrollEnabled={scrollEnabled}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={
          onEndReached
            ? (event) => {
                if (isNearScrollEnd(event)) onEndReached();
              }
            : undefined
        }
      >
        {children}
      </ScrollView>
    );
  return (
    <View
      testID={testID}
      {...(onEndReached
        ? {
            onScroll: (event: React.UIEvent<HTMLElement>) => {
              if (isNearScrollEnd(event)) onEndReached();
            },
          }
        : {})}
      style={[style, webOnly({ overflowX: 'auto', overflowY: 'auto' })]}
    >
      {children}
    </View>
  );
}
