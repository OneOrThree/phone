import { GOWUN } from '@/screens/island/sceneKit';
import { useState } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { reactStyle, useKeyframe } from '../shared/motion';
import { INK, exact, gradient, textShadow, webOnly } from '../shared/styles';
import { Text } from '../shared/typography';
import { ArtifactProps } from '../types';
import { BG, HALL_OUTLINE, MUTED, hallFont, nowrap } from './hallStyles';

// ───────── 공동 가계부 ─────────

function LedgerRow({ label, sub, value }: { label: string; sub: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        columnGap: 8,
        paddingVertical: 7,
        paddingHorizontal: 1,
        borderBottomWidth: 1,
        borderStyle: 'dashed',
        borderColor: '#c9ad87',
      }}
    >
      <View>
        <Text style={hallFont(13, 20.8, '700')}>{label}</Text>
        <Text style={hallFont(12, 19.2, '400', MUTED)}>{sub}</Text>
      </View>
      <Text
        style={[hallFont(16, 16, '400', INK, GOWUN), { fontVariant: ['tabular-nums'] }, nowrap()]}
      >
        {value}
      </Text>
    </View>
  );
}

function LedgerHead({ kicker, title, total }: { kicker: string; title: string; total: string }) {
  return (
    <>
      <Text style={[hallFont(12, 19.2, '400', MUTED), { letterSpacing: 0.36 }]}>{kicker}</Text>
      <Text style={[hallFont(22, 27.5, '400', INK, GOWUN), { marginTop: 1 }]}>{title}</Text>
      <Text style={[hallFont(28, 35, '400', INK, GOWUN), { marginTop: 2 }, nowrap()]}>{total}</Text>
    </>
  );
}

export function Ledger({ concept, reduceMotion, showToast }: ArtifactProps) {
  const [tab, setTab] = useState(0);
  const [reacting, setReacting] = useState(0);
  const react = useKeyframe(reacting, 420, reduceMotion);
  const tabs = [
    ['잔액', '#f2c1c8'],
    ['적립', '#f1d77f'],
    ['지출', '#acd5df'],
  ];
  const roundButton = {
    width: 32,
    height: 32,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 2,
    borderColor: HALL_OUTLINE,
    borderRadius: 999,
    backgroundColor: BG,
    boxShadow: `0 3px 0 ${HALL_OUTLINE}`,
  };

  return (
    <Animated.View
      style={[
        { minHeight: 492 },
        webOnly({ filter: 'drop-shadow(0 11px 12px #3c261b62)' }),
        !reduceMotion && reactStyle(react),
      ]}
    >
      <View
        style={[
          {
            position: 'absolute',
            top: 9,
            right: -3,
            bottom: -5,
            left: 10,
            borderWidth: 2,
            borderColor: '#6f503a',
            borderTopLeftRadius: 7,
            borderTopRightRadius: 13,
            borderBottomRightRadius: 13,
            borderBottomLeftRadius: 6,
            boxShadow: 'inset 7px 0 #48634d',
          },
          Platform.OS === 'web'
            ? webOnly({
                backgroundImage: 'repeating-linear-gradient(#f1e4c9 0 3px,#b99b76 4px,#f1e4c9 5px)',
              })
            : { backgroundColor: '#f1e4c9' },
        ]}
      />
      <View
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          bottom: 1,
          left: 5,
          borderWidth: 2,
          borderColor: '#684d39',
          borderTopLeftRadius: 6,
          borderTopRightRadius: 12,
          borderBottomRightRadius: 12,
          borderBottomLeftRadius: 6,
          backgroundColor: '#678268',
          boxShadow: 'inset 8px 0 #405e48',
        }}
      />

      <View
        style={[
          {
            position: 'absolute',
            top: 10,
            right: 8,
            bottom: 7,
            left: 15,
            paddingTop: 47,
            paddingRight: 22,
            paddingBottom: 18,
            paddingLeft: 29,
            borderWidth: 1.5,
            borderColor: '#937154',
            borderTopLeftRadius: 4,
            borderTopRightRadius: 10,
            borderBottomRightRadius: 10,
            borderBottomLeftRadius: 5,
            boxShadow: 'inset 7px 0 9px #8d704333',
          },
          Platform.OS === 'web'
            ? webOnly({
                backgroundImage:
                  'linear-gradient(90deg,#c3a77d22 0 3%,transparent 8%),repeating-linear-gradient(#fff3d8 0 24px,#ead8b9 25px)',
              })
            : { backgroundColor: '#fff3d8' },
        ]}
      >
        <View
          style={{
            position: 'absolute',
            left: 4,
            top: '4%',
            bottom: '4%',
            width: 10,
            borderRadius: '50%',
            backgroundColor: exact('#99764b22'),
            boxShadow: 'inset -3px 0 4px #7a5a3833',
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 32,
            right: 22,
            top: 14,
            flexDirection: 'row',
            alignItems: 'center',
            columnGap: 5,
          }}
        >
          <Pressable testID="ledger-prev" style={roundButton}>
            <Text style={hallFont(13, 20.8, '850')}>‹</Text>
          </Pressable>
          <Text style={[hallFont(12, 19.2), { flex: 1, textAlign: 'center' }]}>2026년 9월</Text>
          <Pressable
            testID="ledger-next"
            disabled
            style={[roundButton, { opacity: 0.35, boxShadow: 'none' }]}
          >
            <Text style={hallFont(13, 20.8, '850')}>›</Text>
          </Pressable>
        </View>

        {tab === 0 && (
          <View>
            <LedgerHead kicker="SODA ISLAND LEDGER" title="우리 섬 물고기" total="🐟 1,240마리" />
            <Text style={hallFont(15, 24)}>
              <View
                style={{
                  marginTop: 5,
                  marginBottom: 9,
                  paddingVertical: 2,
                  paddingHorizontal: 7,
                  borderWidth: 1,
                  borderColor: '#886b53',
                  borderRadius: 5,
                  backgroundColor: '#efd070',
                  transform: [{ rotate: '-2deg' }],
                }}
              >
                <Text style={hallFont(12, 15.6)}>섬 주민이 함께 모은 물고기</Text>
              </View>
            </Text>
            <View style={{ flexDirection: 'row', columnGap: 7, marginVertical: 9 }}>
              {[
                ['이번 달 적립', '+386'],
                ['이번 달 사용', '−180'],
              ].map(([label, value]) => (
                <View
                  key={label}
                  style={{
                    flex: 1,
                    padding: 7,
                    borderWidth: 1,
                    borderColor: '#c7aa83',
                    backgroundColor: '#fff8e7',
                  }}
                >
                  <Text style={hallFont(12, 19.2)}>{label}</Text>
                  <Text style={hallFont(15, 24)}>
                    <Text
                      style={[
                        hallFont(17, 23.8, '400', INK, GOWUN),
                        { fontVariant: ['tabular-nums'] },
                      ]}
                    >
                      {value}
                    </Text>
                  </Text>
                </View>
              ))}
            </View>
            <LedgerRow label="오늘 집중 보상" sub="9월 15일" value="+125" />
            <LedgerRow label="축음기 음원 구매" sub="9월 14일" value="−80" />
          </View>
        )}
        {tab === 1 && (
          <View>
            <LedgerHead kicker="FISH IN" title="적립 내역" total="이번 달 +386마리" />
            <LedgerRow label="집중으로 획득" sub="오늘 · 주민 5명" value="+93" />
            <LedgerRow label="일일 퀘스트 보상" sub="오늘 · 전원 달성" value="+15" />
            <LedgerRow label="집중으로 획득" sub="어제 · 주민 4명" value="+74" />
          </View>
        )}
        {tab === 2 && (
          <View>
            <LedgerHead kicker="FISH OUT" title="사용 내역" total="이번 달 −180마리" />
            <LedgerRow label="축음기 음원 구매" sub="9월 14일 · 빗방울" value="−80" />
            <LedgerRow label="도서관 건설" sub="9월 10일" value="−100" />
            <Text
              style={[
                hallFont(12, 18, '400', MUTED),
                {
                  marginTop: 14,
                  padding: 7,
                  borderWidth: 1,
                  borderColor: '#c7aa83',
                  backgroundColor: '#fff8e7',
                },
              ]}
            >
              주민별 누적 획득량은 도서관에서 확인해요.
            </Text>
          </View>
        )}
      </View>

      <View
        style={[
          {
            position: 'absolute',
            zIndex: 4,
            left: 10,
            top: -34,
            minWidth: 103,
            paddingTop: 6,
            paddingHorizontal: 15,
            paddingBottom: 7,
            borderWidth: 1.5,
            borderColor: '#68482f',
            borderTopLeftRadius: 6,
            borderTopRightRadius: 6,
            borderBottomLeftRadius: 9,
            borderBottomRightRadius: 9,
            boxShadow: '0 3px 0 #68482f',
            transform: [{ rotate: '-1deg' }],
          },
          gradient('linear-gradient(90deg,#b97949,#d2a064,#bd814d)'),
        ]}
      >
        <Text
          style={[
            hallFont(15, 18, '400', '#fff8e8', GOWUN),
            { textAlign: 'center' },
            textShadow(0, 1, '#66442e'),
          ]}
        >
          공동 가계부
        </Text>
      </View>

      <View
        style={{
          position: 'absolute',
          zIndex: 5,
          right: 15,
          top: -17,
          flexDirection: 'row',
          columnGap: 3,
        }}
      >
        {tabs.map(([label, color], i) => (
          <Pressable
            key={label}
            testID={`ledger-tab-${i}`}
            onPress={() => {
              setTab(i);
              setReacting((n) => n + 1);
              showToast(`${label} 선택`);
            }}
            style={[
              {
                width: 56,
                minHeight: 40,
                paddingTop: 5,
                paddingHorizontal: 4,
                paddingBottom: 8,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1.5,
                borderColor: '#775846',
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
                borderBottomLeftRadius: 2,
                borderBottomRightRadius: 2,
                backgroundColor: color,
                boxShadow: '0 2px 0 #775846',
              },
              webOnly({ clipPath: 'polygon(0 0,100% 0,100% 100%,50% 80%,0 100%)' }),
              tab === i && [
                { transform: [{ translateY: -6 }] },
                webOnly({ filter: 'brightness(1.04)' }),
              ],
            ]}
          >
            <Text style={[hallFont(12, 15, '800'), { textAlign: 'center' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
}
