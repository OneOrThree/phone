import { GOWUN } from '@/screens/island/sceneKit';
import React, { useState } from 'react';
import { Animated, Platform, Pressable, TextInput, View } from 'react-native';
import { interiorArt } from '../assets';
import { Art } from '../shared/Art';
import { useEased } from '../shared/motion';
import { INK, gradient, webOnly } from '../shared/styles';
import { Text } from '../shared/typography';
import { HallPill } from './Construction';
import {
  BG,
  HALL_OUTLINE,
  HALL_SKY,
  MUTED,
  PAPER_INK,
  PRIMARY,
  SURFACE,
  Tab,
  hallFont,
} from './hallStyles';

// ───────── 섬 관리 (섬 등록부) ─────────

type Cat = keyof (typeof interiorArt)['avatars'];

const residents: [string, Cat][] = [
  ['나', 'black'],
  ['민지', 'calico'],
  ['두부', 'white'],
  ['수아', 'cream'],
  ['밤이', 'gray'],
  ['보리', 'ginger'],
  ['구름', 'white'],
  ['소금', 'calico'],
];

const avatarBg = ['#dfe9cc', '#f3d4d4', '#d4e7e9'];

// .resident-avatar: 둥근 틀 안에서 그림을 아래 기준으로 1.2배 키운다
function Avatar({ color, bg }: { color: Cat; bg: string }) {
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderWidth: 1,
        borderColor: '#c4af88',
        borderRadius: 16,
        backgroundColor: bg,
        overflow: 'hidden',
      }}
    >
      <Art
        source={interiorArt.avatars[color]}
        style={{ width: 30, height: 30, transform: [{ scale: 1.2 }], transformOrigin: '50% 100%' }}
      />
    </View>
  );
}

// 주민 정원: 웹은 원본과 같은 <select>, 네이티브는 누를 때마다 다음 값으로 바꾼다
function QuotaSelect() {
  const options = ['8명', '10명', '15명'];
  const [value, setValue] = useState('15명');
  if (Platform.OS === 'web')
    return React.createElement(
      'select',
      {
        'aria-label': '주민 정원',
        'data-testid': 'quota-select',
        value,
        onChange: (e: any) => setValue(e.target.value),
        style: {
          boxSizing: 'border-box',
          margin: 0,
          padding: '4px 6px',
          border: '1px solid #a88b69',
          borderRadius: 5,
          background: '#fffaf0',
          font: '12px Gowun',
          color: '#493b39',
        },
      },
      options.map((option) =>
        React.createElement('option', { key: option, value: option }, option),
      ),
    );
  return (
    <Pressable
      testID="quota-select"
      onPress={() => setValue(options[(options.indexOf(value) + 1) % options.length])}
      style={{
        paddingVertical: 4,
        paddingHorizontal: 6,
        borderWidth: 1,
        borderColor: '#a88b69',
        borderRadius: 5,
        backgroundColor: '#fffaf0',
      }}
    >
      <Text style={{ fontFamily: GOWUN, fontSize: 12, color: INK }}>{value} ▾</Text>
    </Pressable>
  );
}

// .management-info input · textarea: 원본처럼 값은 입력칸에만 두고, 저장에 쓰는 이름만 받아 둔다
function HallField({
  testID,
  defaultValue,
  onChangeText,
  maxLength,
  multiline = false,
}: {
  testID: string;
  defaultValue: string;
  onChangeText?: (text: string) => void;
  maxLength: number;
  multiline?: boolean;
}) {
  return (
    <TextInput
      testID={testID}
      defaultValue={defaultValue}
      onChangeText={onChangeText}
      maxLength={maxLength}
      multiline={multiline}
      style={[
        {
          paddingVertical: 7,
          paddingHorizontal: 8,
          borderWidth: 1,
          borderColor: '#b9a081',
          borderRadius: 5,
          backgroundColor: '#fffaf0',
          ...hallFont(13, 18.2, '400', PAPER_INK, GOWUN),
        },
        multiline && { height: 52 },
      ]}
    />
  );
}

export function IslandManagement({
  width,
  isStatic,
  initialTab,
  shown,
  reduceMotion,
  showToast,
  onClose,
}: {
  width: number;
  isStatic: boolean;
  initialTab: Tab;
  shown: boolean;
  reduceMotion: boolean;
  showToast: (message: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [heading, setHeading] = useState('소다 섬');
  const [name, setName] = useState('소다 섬');
  const [approval, setApproval] = useState(true);
  const [requests, setRequests] = useState<[string, Cat][]>([
    ['모카', 'cream'],
    ['치즈', 'ginger'],
  ]);
  const [confirm, setConfirm] = useState<[string, string] | null>(null);
  // transition: transform .3s, opacity .2s
  const move = useEased(shown ? 1 : 0, 300, reduceMotion);
  const opacity = useEased(shown ? 1 : 0, 200, reduceMotion);

  const tabBase = {
    minHeight: 32,
    paddingVertical: 5,
    paddingHorizontal: 7,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 2,
    borderColor: HALL_OUTLINE,
    borderRadius: 99,
  };
  const label = hallFont(13, 20.8, '800', PAPER_INK);
  const setting = {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    columnGap: 8,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderStyle: 'dashed' as const,
    borderColor: '#cdb58e',
  };
  const sectionTitle = {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    columnGap: 5,
    marginTop: 3,
    marginBottom: 12,
  };
  const note = [hallFont(12, 18, '400', MUTED), { marginTop: 10 }];
  const count = String(requests.length);
  // grid 1fr 1fr 1.2fr: flex-grow는 안쪽 여백을 뺀 나머지만 나눠 너비가 달라지므로 칸 너비를 직접 구한다 (좌우 14 · 테두리 2 · 안쪽 13 · 간격 5×2)
  const fr = (width - 58 - 10) / 3.2;

  const leave = () =>
    setConfirm(['소다 섬에서 나갈까요?', '섬장은 다른 주민에게 먼저 섬장을 위임해야 해요.']);

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          zIndex: 13,
          left: 14,
          right: 14,
          top: '50%',
          height: 580,
          paddingTop: 15,
          paddingHorizontal: 13,
          paddingBottom: 10,
          borderWidth: 2,
          borderColor: '#806449',
          borderRadius: 14,
          backgroundColor: '#fff3d8',
          boxShadow: 'inset 0 0 0 4px #ead6b1,0 12px 26px #3b2c2380',
          opacity,
          pointerEvents: shown ? 'auto' : 'none',
          transform: [
            { translateY: move.interpolate({ inputRange: [0, 1], outputRange: ['-45%', '-50%'] }) },
            { scale: move.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        },
        gradient('linear-gradient(90deg,#ead6b126,transparent 12%)'),
      ]}
    >
      <View style={{ marginBottom: 9 }}>
        <Text testID="management-heading" style={hallFont(12, 19.2, '400', MUTED)}>
          {heading} · 섬 등록부
        </Text>
        <Text style={[hallFont(24, 28.8, '400', PAPER_INK, GOWUN), { marginTop: 3 }]}>
          {'섬 관리 '}
          <View
            style={[
              {
                paddingVertical: 2,
                paddingHorizontal: 7,
                borderWidth: 1,
                borderColor: '#75946e',
                borderRadius: 99,
                backgroundColor: '#deebcf',
              },
              webOnly({ verticalAlign: '3px' }),
            ]}
          >
            <Text style={hallFont(11, 13.2, '400', '#44643d', GOWUN)}>섬장</Text>
          </View>
        </Text>
        <Pressable
          testID="management-close"
          accessibilityLabel="섬 관리 닫기"
          onPress={() => (isStatic ? showToast('섬 관리 화면 시안이에요') : onClose())}
          // 줄높이 27.2가 안쪽 23보다 커서 <button>은 가운데가 아니라 위에 붙인다
          style={{
            position: 'absolute',
            right: 0,
            top: 2,
            width: 27,
            height: 27,
            alignItems: 'center',
            borderWidth: 2,
            borderColor: HALL_OUTLINE,
            borderRadius: 999,
            backgroundColor: BG,
            boxShadow: `0 3px 0 ${HALL_OUTLINE}`,
          }}
        >
          <Text style={hallFont(17, 27.2, '850')}>×</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', columnGap: 5, marginBottom: 13 }}>
        {(
          [
            ['info', '섬 정보', ''],
            ['residents', '주민', '8'],
            ['requests', '가입 신청', count],
          ] as const
        ).map(([key, text, badge], i) => (
          <Pressable
            key={key}
            testID={`management-tab-${i}`}
            onPress={() => setTab(key)}
            style={[
              tabBase,
              { width: (i === 2 ? 1.2 : 1) * fr, backgroundColor: tab === key ? PRIMARY : SURFACE },
              tab === key && { boxShadow: `0 2px 0 ${HALL_OUTLINE}` },
            ]}
          >
            <Text style={[hallFont(12, 14.4, '800'), { textAlign: 'center' }]}>
              {text}
              {badge !== '' && ' '}
              {badge !== '' && <Text style={{ marginLeft: 2, fontWeight: '900' }}>{badge}</Text>}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'info' && (
          <View>
            <View style={{ rowGap: 4, marginBottom: 9 }}>
              <Text style={label}>섬 이름</Text>
              <HallField
                testID="island-name-input"
                defaultValue="소다 섬"
                onChangeText={setName}
                maxLength={20}
              />
            </View>
            <View style={{ rowGap: 4, marginBottom: 9 }}>
              <Text style={label}>섬 소개</Text>
              <HallField
                testID="island-intro-input"
                defaultValue="함께 집중하고, 느긋하게 쉬어가는 섬."
                maxLength={100}
                multiline
              />
            </View>
            <View style={setting}>
              <View style={{ rowGap: 1 }}>
                <Text style={hallFont(13, 20.8, '700', PAPER_INK)}>가입 승인</Text>
                <Text style={hallFont(12, 16.8, '400', MUTED)}>
                  {approval ? '섬장 승인 후 가입해요' : '승인 없이 바로 가입해요'}
                </Text>
              </View>
              <Pressable
                testID="approval-toggle"
                accessibilityLabel="가입 승인 필요"
                onPress={() => setApproval(!approval)}
                style={{
                  width: 32,
                  height: 19,
                  borderWidth: 2,
                  borderColor: HALL_OUTLINE,
                  borderRadius: 99,
                  backgroundColor: approval ? PRIMARY : BG,
                }}
              >
                <Knob on={approval} reduceMotion={reduceMotion} />
              </Pressable>
            </View>
            <View style={setting}>
              <View style={{ rowGap: 1 }}>
                <Text style={hallFont(13, 20.8, '700', PAPER_INK)}>주민 정원</Text>
                <Text style={hallFont(12, 16.8, '400', MUTED)}>현재 주민 8명 · 최대 15명</Text>
              </View>
              <QuotaSelect />
            </View>
            <HallPill
              testID="management-invite"
              onPress={() => showToast('섬 초대 링크를 공유하는 화면으로 이어져요')}
              style={{ marginTop: 8, justifyContent: 'space-between', backgroundColor: HALL_SKY }}
            >
              <Text style={hallFont(13, 16.25, '850')}>섬 초대 링크 공유</Text>
              <Text style={hallFont(13, 16.25, '850')}>↗</Text>
            </HallPill>
            <HallPill
              testID="management-save"
              onPress={() => {
                const trimmed = name.trim();
                if (!trimmed) return showToast('섬 이름을 적어주세요');
                setHeading(trimmed);
                showToast('섬 정보를 저장했어요');
              }}
              style={{ marginTop: 8 }}
            >
              변경사항 저장
            </HallPill>
          </View>
        )}

        {tab === 'residents' && (
          <View>
            <View style={sectionTitle}>
              <Text style={hallFont(14, 22.4, '700', PAPER_INK)}>함께 사는 주민</Text>
              <Text style={hallFont(12, 19.2, '400', MUTED)}>8 / 15명</Text>
            </View>
            <View style={{ rowGap: 6 }}>
              {[0, 2, 4, 6].map((start) => (
                <View key={start} style={{ flexDirection: 'row', columnGap: 6 }}>
                  {residents.slice(start, start + 2).map(([resident, color], offset) => {
                    const i = start + offset;
                    return (
                      <Pressable
                        key={resident + i}
                        testID={`resident-${i}`}
                        onPress={() =>
                          i === 0
                            ? showToast('현재 소다 섬의 섬장이에요')
                            : setConfirm([
                                `${resident}에게 섬장 위임`,
                                '섬장 권한을 넘기고 나는 주민으로 남아요.',
                              ])
                        }
                        style={{
                          flex: 1,
                          minHeight: 60,
                          padding: 6,
                          flexDirection: 'row',
                          alignItems: 'center',
                          columnGap: 7,
                          borderWidth: 2,
                          borderColor: HALL_OUTLINE,
                          borderRadius: 13,
                          backgroundColor: SURFACE,
                        }}
                      >
                        <Avatar color={color} bg={avatarBg[i % 3]} />
                        <View style={{ rowGap: 2 }}>
                          <Text style={hallFont(14, 22.4, '700', PAPER_INK)}>{resident}</Text>
                          <Text style={hallFont(12, 15.6, '400', MUTED)}>
                            {i === 0 ? '섬장' : '주민'}
                          </Text>
                        </View>
                        <Text style={[hallFont(15, 24, '400', '#8c765e'), { marginLeft: 'auto' }]}>
                          {i === 0 ? '♛' : '›'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
            <Text style={note}>주민을 눌러 섬장 위임·주민 관리를 할 수 있어요.</Text>
          </View>
        )}

        {tab === 'requests' && (
          <View>
            <View style={sectionTitle}>
              <Text style={hallFont(14, 22.4, '700', PAPER_INK)}>새 이웃이 기다리고 있어요</Text>
              <Text style={hallFont(12, 19.2, '400', MUTED)}>
                <Text style={{ fontWeight: '700' }}>{count}</Text>명
              </Text>
            </View>
            {requests.map(([neighbor, color], i) => {
              const settle = (approve: boolean) => {
                setRequests(requests.filter((_, j) => j !== i));
                showToast(approve ? '새 이웃의 가입을 승인했어요' : '가입 신청을 거절했어요');
              };
              return (
                <View
                  key={neighbor}
                  style={{
                    minHeight: 72,
                    marginBottom: 8,
                    paddingVertical: 12,
                    paddingHorizontal: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    columnGap: 7,
                    borderWidth: 1,
                    borderColor: '#c5ad8a',
                    borderRadius: 7,
                    backgroundColor: '#fffaf0',
                  }}
                >
                  <Avatar color={color} bg={avatarBg[0]} />
                  <View style={{ flex: 1, rowGap: 3 }}>
                    <Text style={hallFont(14, 22.4, '700', PAPER_INK)}>{neighbor}</Text>
                    <Text style={hallFont(12, 15.6, '400', MUTED)}>같이 집중하고 싶어요!</Text>
                  </View>
                  <HallPill
                    testID={`request-approve-${i}`}
                    shadow={3}
                    onPress={() => settle(true)}
                    style={{ minHeight: 32, paddingVertical: 5, paddingHorizontal: 8 }}
                  >
                    <Text style={hallFont(12, 15, '850')}>승인</Text>
                  </HallPill>
                  <HallPill
                    testID={`request-reject-${i}`}
                    shadow={3}
                    onPress={() => settle(false)}
                    style={{
                      width: 32,
                      minHeight: 32,
                      paddingVertical: 0,
                      paddingHorizontal: 0,
                      backgroundColor: BG,
                    }}
                  >
                    <Text style={hallFont(17, 21.25, '850')}>×</Text>
                  </HallPill>
                </View>
              );
            })}
            {/* 블록 여백 겹침: 행 margin-bottom 8 · 제목 margin-bottom 12 와 note margin-top 10 중 큰 값만 남는다 */}
            <Text style={[note, { marginTop: requests.length ? 2 : 0 }]}>
              승인한 이웃은 소다 섬에 들어올 수 있어요.
            </Text>
          </View>
        )}
      </View>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          columnGap: 10,
          paddingTop: 10,
          borderTopWidth: 1,
          borderColor: '#ccb48f',
        }}
      >
        <Pressable
          testID="management-delegate"
          onPress={() => {
            setTab('residents');
            showToast('섬장을 맡길 주민을 골라주세요');
          }}
          style={[tabBase, { backgroundColor: BG }]}
        >
          <Text style={hallFont(12, 14.4, '800')}>섬장 위임</Text>
        </Pressable>
        <Pressable
          testID="management-leave"
          onPress={leave}
          style={[tabBase, { backgroundColor: SURFACE }]}
        >
          <Text style={hallFont(12, 14.4, '800')}>섬 탈퇴</Text>
        </Pressable>
      </View>

      {confirm && (
        <View
          style={{
            position: 'absolute',
            zIndex: 5,
            left: 16,
            right: 16,
            top: '50%',
            transform: [{ translateY: '-50%' }],
            paddingVertical: 16,
            paddingHorizontal: 13,
            borderWidth: 2,
            borderColor: '#806449',
            borderRadius: 9,
            backgroundColor: '#fffaf0',
            boxShadow: '0 0 0 150px #44362966,0 8px 16px #3b2c2355',
          }}
        >
          <Text style={hallFont(15, 24, '400', PAPER_INK)}>
            <Text style={hallFont(17, 27.2, '700', PAPER_INK)}>{confirm[0]}</Text>
          </Text>
          <Text style={[hallFont(13, 20.8, '400', PAPER_INK), { marginVertical: 13 }]}>
            {confirm[1]}
          </Text>
          <View style={{ flexDirection: 'row', columnGap: 8 }}>
            <HallPill
              testID="confirm-cancel"
              onPress={() => setConfirm(null)}
              style={{ flex: 1, minHeight: 37, backgroundColor: BG }}
            >
              취소
            </HallPill>
            <HallPill
              testID="confirm-ok"
              onPress={() => {
                setConfirm(null);
                showToast('확인 후 처리 화면으로 이어져요');
              }}
              style={{ flex: 1, minHeight: 37 }}
            >
              확인
            </HallPill>
          </View>
        </View>
      )}
    </Animated.View>
  );
}

// .approval-toggle i: transition left .2s
function Knob({ on, reduceMotion }: { on: boolean; reduceMotion: boolean }) {
  const left = useEased(on ? 15 : 2, 200, reduceMotion);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left,
        top: 1,
        width: 13,
        height: 13,
        borderRadius: '50%',
        backgroundColor: '#fffaf0',
        boxShadow: '0 1px 2px #4b382940',
      }}
    />
  );
}
