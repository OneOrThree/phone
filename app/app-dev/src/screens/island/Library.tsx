import React, { useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Polygon } from 'react-native-svg';
import { art } from '@/design-system/patterns';
import { useAppLayout } from '@/utils/layout';
import {
  State,
  currentIsland,
  dayKey,
  earnedBy,
  kstDayStart,
  periodBounds,
  recordSecondsBetween,
} from '@/services/model';
import { BROWN, T, fill, hm, useGowun, web } from '@/screens/island/sceneKit';

// v2 시안(036~041) 도서관: 원형 테이블 위 일기장 두 권 → 한 권씩 펼치는 책
type Period = '일' | '주' | '월';
const md = (at: number) => {
  const [, m, d] = dayKey(at).split('-').map(Number);
  return `${m}.${d}`;
};
function Flower({ outline }: { outline: boolean }) {
  return (
    <Svg width={26} height={26} viewBox="-12 -12 24 24">
      <G
        fill={outline ? 'none' : '#fff5cf'}
        stroke={outline ? '#fff5cf' : undefined}
        strokeWidth={1.6}
      >
        {[0, 72, 144, 216, 288].map((r) => (
          <Ellipse key={r} rx={3.4} ry={6} cy={-5.4} rotation={r} />
        ))}
      </G>
      <Circle r={2.4} fill="#e8c46a" />
    </Svg>
  );
}
function Cover({ nb, x, y, w, h, land, font, onPress }: any) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={nb ? '이웃들의 일기장' : '내 일기장'}
      testID={nb ? 'diary-neighbors' : 'diary-mine'}
      onPress={onPress}
      style={[
        {
          position: 'absolute',
          left: x,
          top: y,
          width: w,
          height: h,
          transform: [
            { perspective: 650 },
            { rotateX: '28deg' },
            { rotateZ: nb ? '9deg' : '-10deg' },
          ],
        },
        web({ filter: 'drop-shadow(rgba(96, 67, 44, 0.44) 3px 9px 3px)' }),
      ]}
    >
      {/* 책 옆면 종이 겹 */}
      <View
        style={[
          {
            position: 'absolute',
            top: h * 0.03,
            right: -w * 0.05,
            bottom: -h * 0.01,
            left: w * 0.06,
            borderWidth: 2,
            borderColor: '#795d44',
            borderTopLeftRadius: 4,
            borderBottomLeftRadius: 4,
            borderTopRightRadius: 8,
            borderBottomRightRadius: 8,
            backgroundColor: '#f4e9cf',
          },
          web({
            backgroundImage:
              'repeating-linear-gradient(rgb(244, 233, 207) 0px, rgb(244, 233, 207) 3px, rgb(195, 164, 129) 4px, rgb(244, 233, 207) 5px)',
          }),
        ]}
      />
      <View
        style={{
          ...fill,
          alignItems: 'center',
          justifyContent: 'space-around',
          borderWidth: 2,
          borderColor: '#775342',
          borderTopLeftRadius: 5,
          borderBottomLeftRadius: 5,
          borderTopRightRadius: 10,
          borderBottomRightRadius: 10,
          backgroundColor: nb ? '#b4d4db' : '#e8adb3',
          boxShadow: nb
            ? 'inset 6px 0 0 rgb(115, 158, 174), inset 10px 0 0 rgba(255, 255, 255, 0.27)'
            : 'inset 6px 0 0 rgb(189, 121, 129), inset 10px 0 0 rgba(255, 255, 255, 0.208)',
          paddingTop: w * 0.13,
          paddingRight: w * 0.08,
          paddingBottom: w * 0.12,
          paddingLeft: w * 0.13,
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 7,
            right: 6,
            bottom: 7,
            left: 13,
            borderWidth: 1,
            borderColor: '#b8897e',
            borderRadius: 3,
          }}
        />
        <T
          style={{
            fontFamily: font,
            fontSize: nb ? (land ? 16 : 18) : land ? 20 : 22,
            lineHeight: (nb ? (land ? 16 : 18) : land ? 20 : 22) * 1.25,
            textAlign: 'center',
          }}
        >
          {nb ? '이웃들의\n일기장' : '내\n일기장'}
        </T>
        <View style={{ height: 30 }}>
          <Flower outline={nb} />
        </View>
        <T style={{ fontSize: 7, lineHeight: 10.15 }}>
          {nb ? '함께 자라는 이야기' : '나의 하루를 차곡차곡'}
        </T>
      </View>
      <Svg
        width={w * 0.13}
        height={h * 0.1}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: 'absolute', top: h * 0.97, left: w * 0.7 }}
      >
        <Polygon points="0,0 100,0 100,100 50,75 0,100" fill="#ffe08a" />
      </Svg>
    </Pressable>
  );
}
function Round({ title, glyph, onPress, disabled, size, style, testID }: any) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={testID}
      hitSlop={8}
      onPress={onPress}
      style={style}
    >
      <T style={{ fontSize: size, fontWeight: '800', lineHeight: size * 1.45 }}>{glyph}</T>
    </Pressable>
  );
}
export function Library({ e }: any) {
  const font = useGowun();
  const L = useAppLayout(),
    land = L.landscape,
    W = L.width,
    H = L.height;
  if (e.route === 'library') {
    // 원형 테이블: 세로는 583px 폭 장면을 가운데에, 가로는 화면 폭 전체 기준
    const rw = land ? W : 583,
      rx = (W - rw) / 2,
      cw = rw * (land ? 0.135 : 0.23),
      ch = H * (land ? 0.34 : 0.18),
      cy = H * (land ? 0.53 : 0.47);
    return (
      <View style={{ flex: 1 }}>
        <Image source={art[land ? 'L/lib/room' : 'lib/room']} style={fill} resizeMode="cover" />
        {[false, true].map((nb) => (
          <Cover
            key={String(nb)}
            nb={nb}
            land={land}
            font={font}
            x={rx + rw * (nb ? (land ? 0.525 : 0.52) : land ? 0.34 : 0.25)}
            y={cy}
            w={cw}
            h={ch}
            onPress={() => e.go('diary', nb ? 'residents' : '')}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={e.home}
          style={{
            position: 'absolute',
            right: land ? 56 : 16,
            top: land ? 14 : 62,
            width: 42,
            height: 42,
            borderRadius: 21,
            borderWidth: 2,
            borderColor: BROWN,
            backgroundColor: '#fff7eb',
            boxShadow: `0px 3px 0px ${BROWN}`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <T style={{ fontSize: 24, fontWeight: '800', lineHeight: 34.8 }}>×</T>
        </Pressable>
      </View>
    );
  }
  return <Diary e={e} font={font} />;
}
function Diary({ e, font }: any) {
  const s: State = e.state,
    i = currentIsland(s),
    L = useAppLayout(),
    land = L.landscape,
    W = L.width,
    H = L.height,
    nb = e.detail === 'residents';
  const [page, setPage] = useState(e.tab === 'screen' ? 1 : e.tab === 'fish' && nb ? 2 : 0),
    [member, setMember] = useState(e.body || i.members[0]?.id || ''),
    [period, setPeriod] = useState<Period>('주'),
    [offset, setOffset] = useState(0);
  const resident = nb ? i.members.find((m) => m.id === member) : undefined,
    // 이웃이 한 명도 없으면 '이웃의 하루' 빈 장을 보여 준다
    lonely = nb && !resident,
    name = nb ? (resident?.name ?? '이웃') : '나',
    bounds = periodBounds(period, offset, e.now);
  // 기간 안에 걸친 집중 시간만 센다(여러 날에 걸친 기록은 겹친 만큼만)
  const records = (nb ? (resident?.records ?? []) : s.records).filter(
      (r) => r.islandId === i.id && recordSecondsBetween(r, bounds.from, bounds.until) > 0,
    ),
    focus = records.reduce((n, r) => n + recordSecondsBetween(r, bounds.from, bounds.until), 0);
  // 스크린타임: 권한 없음(undefined) · 측정 안 됨(null) · 실제 값(0 포함)을 구분한다
  const days = nb ? resident?.screenDays : s.settings.permission ? s.screenDays : undefined,
    screen = Object.entries(days ?? {}).filter(([d, v]) => {
      const at = kstDayStart(d);
      return v != null && at >= bounds.from && at < bounds.until;
    }) as [string, number][];
  const label =
    period === '일'
      ? (() => {
          const [y, m, d] = dayKey(bounds.from).split('-').map(Number);
          return `${y}년 ${m}월 ${d}일`;
        })()
      : period === '주'
        ? `${md(bounds.from)} — ${md(bounds.until - 1)}`
        : `${dayKey(bounds.from).slice(0, 4)}년 ${Number(dayKey(bounds.from).slice(5, 7))}월`;
  const sumLabel =
    period === '일'
      ? offset
        ? '그날'
        : '오늘'
      : `${offset ? '그' : '이번'} ${period === '주' ? '주' : '달'} 합계`;
  // 막대: 일 = 6시간씩 4칸, 주·월 = 하루씩
  const bins = period === '일' ? 4 : Math.round((bounds.until - bounds.from) / 864e5),
    binMs = (bounds.until - bounds.from) / bins;
  const values = Array.from({ length: bins }, (_, n) => {
    const from = bounds.from + binMs * n,
      until = from + binMs;
    return page === 0
      ? records.reduce((sum, r) => sum + recordSecondsBetween(r, from, until), 0)
      : screen
          .filter(([d]) => kstDayStart(d) >= from && kstDayStart(d) < until)
          .reduce((sum, [, v]) => sum + v, 0);
  });
  const barLabel = (n: number) =>
    period === '일'
      ? `${n * 6}시`
      : period === '주' || (n + 1) % 5 === 0 || n === 0
        ? md(bounds.from + binMs * n)
        : '';
  const bySubject = Object.entries(
    records.reduce<Record<string, number>>((acc, r) => {
      acc[r.subject] = (acc[r.subject] ?? 0) + recordSecondsBetween(r, bounds.from, bounds.until);
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const screenTotal = screen.reduce((n, [, v]) => n + v, 0);
  const lastPage = nb ? 2 : 1;
  const flip = page === 1;

  // 책 크기: 세로 360×480, 가로 펼친 두 쪽 524×350
  const bw = land ? 524 : 360,
    bh = land ? (nb ? 344 : 350) : 480,
    bx = (W - bw) / 2,
    by = land ? (H - bh) / 2 + (nb ? 11 : 8) : (H - bh) / 2 + (nb ? 55 : 39);
  const pw = land ? bw / 2 : bw;

  const t = (size: number, lh: number, extra?: object) => ({
    fontSize: size,
    lineHeight: lh,
    ...extra,
  });
  const filter = page !== 2 && (
    <View
      style={{
        position: 'absolute',
        left: pw * 0.1,
        right: pw * 0.1,
        top: bh * (land ? 0.08 : 0.085),
        alignItems: 'center',
        gap: 5,
        zIndex: 2,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {(['일', '주', '월'] as Period[]).map((p) => (
          <Pressable
            key={p}
            testID={`diary-period-${p}`}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${p} 단위`}
            accessibilityState={{ selected: period === p }}
            onPress={() => {
              setPeriod(p);
              setOffset(0);
            }}
            style={{
              width: 30,
              height: 28,
              borderWidth: 1.5,
              borderColor: BROWN,
              borderRadius: 99,
              backgroundColor: period === p ? '#ffa6bc' : '#fffdfa',
              boxShadow: period === p ? `0px 2px 0px ${BROWN}` : undefined,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <T style={t(10, 14.5, { fontWeight: '800' })}>{p}</T>
          </Pressable>
        ))}
      </View>
      <View
        style={{ width: '82%', flexDirection: 'row', alignItems: 'center', gap: 4, height: 28 }}
      >
        <Round
          title="이전 기간"
          glyph="‹"
          size={15}
          testID="diary-prev-period"
          onPress={() => setOffset((o) => o - 1)}
          style={navBtn(false)}
        />
        <T style={t(10, 14.5, { flex: 1, textAlign: 'center' })}>{label}</T>
        <Round
          title="다음 기간"
          glyph="›"
          size={15}
          disabled={offset >= 0}
          onPress={() => setOffset((o) => Math.min(0, o + 1))}
          style={navBtn(offset >= 0)}
        />
      </View>
    </View>
  );
  const head = (
    <>
      <T
        style={t(8, 11.6, {
          letterSpacing: 1.5,
          color: '#967255',
          textTransform: 'uppercase',
        })}
      >
        {page === 0
          ? 'little moments of focus'
          : page === 1
            ? 'time outside the island'
            : 'fish we caught'}
      </T>
      <T
        style={t(22, 28.6, {
          fontFamily: font,
          letterSpacing: -0.8,
          marginTop: 2,
          marginBottom: 1,
        })}
      >
        {page === 2 ? '우리가 낚은 물고기' : `${name}의 하루`}
      </T>
      <T style={t(9.5, 13.775, { color: '#967b60' })}>
        {page === 2
          ? '주민별 누적 획득 · 섬 잔액과 달라요'
          : `${label} · ${page === 0 ? '집중 기록' : '스크린타임'}`}
      </T>
      {(page === 0 || (page === 1 && days && screen.length > 0)) && (
        <>
          <T style={t(32, 43.2, { fontFamily: font, marginTop: 4 })}>
            {hm(page === 0 ? focus : screenTotal * 60)}
          </T>
          <View
            style={{
              alignSelf: 'flex-start',
              backgroundColor: '#ffe08a',
              borderWidth: 1.5,
              borderColor: BROWN,
              borderRadius: 6,
              paddingVertical: 1,
              paddingHorizontal: 7,
              transform: [{ rotate: '-3deg' }],
            }}
          >
            <T style={t(8.5, 12.325)}>
              {page === 0 ? '차곡차곡, 집중한 시간' : '화면과 함께한 시간'}
            </T>
          </View>
        </>
      )}
    </>
  );
  const max = Math.max(...values);
  const chart = (
    <View
      accessibilityLabel="기간별 기록 그래프"
      style={{
        height: 60,
        flexDirection: 'row',
        gap: period === '월' ? 2 : 6,
        alignItems: 'flex-end',
        borderBottomWidth: 1,
        borderBottomColor: '#b79877',
        marginTop: 12,
        marginBottom: 16,
        paddingHorizontal: 3,
      }}
    >
      {values.map((v, n) => (
        <View
          key={n}
          style={{
            flex: 1,
            height: max ? `${(v / max) * 100}%` : 0,
            borderWidth: v ? 1.5 : 0,
            borderBottomWidth: 0,
            borderColor: BROWN,
            borderTopLeftRadius: 5,
            borderTopRightRadius: 5,
            backgroundColor: n % 2 ? '#ade1f8' : '#ffa6bc',
          }}
        >
          <View
            style={{ position: 'absolute', top: '100%', left: 0, right: 0, alignItems: 'center' }}
          >
            <T style={t(7.5, 10.875, { paddingTop: 3 })}>{barLabel(n)}</T>
          </View>
        </View>
      ))}
    </View>
  );
  const log = (key: string, title: string, sub: string, value: string) => (
    <View
      key={key}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 5,
        borderBottomWidth: 1,
        borderStyle: 'dashed',
        borderBottomColor: '#ceb99b',
      }}
    >
      <View>
        <T style={t(10.5, 14.175, { fontWeight: '700' })}>{title}</T>
        <T style={t(8.5, 11.475, { color: '#998165' })}>{sub}</T>
      </View>
      <T style={t(12, 17, { fontFamily: font })} numberOfLines={1}>
        {value}
      </T>
    </View>
  );
  const empty = (title: string, quote: string) => (
    <>
      <T
        style={t(17, 25.5, { fontFamily: font, marginTop: 30, ...web({ wordBreak: 'keep-all' }) })}
      >
        {title}
      </T>
      <T
        style={t(12.5, 21.875, {
          fontFamily: font,
          color: '#8b7057',
          marginTop: 10,
          ...web({ wordBreak: 'keep-all' }),
        })}
      >
        {quote}
      </T>
    </>
  );
  const body =
    page === 2 ? (
      <View style={{ marginTop: 16 }}>
        {[{ id: 'me', name: '나', color: s.color }, ...i.members].map((m) => (
          <View
            key={m.id}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderStyle: 'dashed',
              borderBottomColor: '#ceb99b',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Image
                source={art[`avatar/${m.color}`]}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  backgroundColor: '#ade1f8',
                  borderWidth: 1.5,
                  borderColor: BROWN,
                }}
              />
              <T style={t(12, 16.2, { fontWeight: '700' })}>{m.name}</T>
            </View>
            <T style={t(15, 21, { fontFamily: font })}>{earnedBy(i, m.id)}마리</T>
          </View>
        ))}
      </View>
    ) : lonely ? (
      empty(
        '아직 함께 사는 이웃이 없어요.',
        '주민이 들어오면 여기서\n서로의 일기장을 볼 수 있어요.',
      )
    ) : page === 0 ? (
      <>
        {focus > 0 && chart}
        {focus > 0
          ? bySubject.map(([subject, sec]) => log(subject, subject, sumLabel, hm(sec)))
          : empty(
              '이 기간에 집중한 기록이 없어요.',
              '0분도 소중한 기록이에요.\n집중을 마치면 여기 쌓여요.',
            )}
      </>
    ) : !days ? (
      empty(
        '아직 연결되지 않은 기록이에요.',
        '스크린타임 측정 권한이 없어\n사용 시간을 확인할 수 없어요.\n0분이나 기록 없음과는 달라요.',
      )
    ) : screen.length ? (
      <>
        {period !== '일' && chart}
        {screen
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([d, v]) => {
            const [, m, dd] = d.split('-').map(Number);
            return log(d, `${m}월 ${dd}일`, '스크린타임', hm(v * 60));
          })}
      </>
    ) : (
      empty('아직 측정된 기록이 없어요.', '측정이 끝나면 여기 쌓여요.')
    );
  const pprStyle = (right: boolean) => ({
    position: 'absolute' as const,
    top: bh * (right ? 0.09 : page === 2 ? (land ? 0.24 : 0.11) : land ? 0.28 : 0.25),
    bottom: bh * (land ? 0.08 : 0.09),
    left: pw * (land ? (right ? 0.11 : 0.13) : 0.12),
    right: pw * (land ? (right ? 0.15 : nb ? 0.13 : 0.11) : nb ? 0.13 : 0.12),
    zIndex: 2,
    overflow: 'hidden' as const,
  });
  const pageBg = (flipped: boolean) => (
    <Image
      source={art['lib/page']}
      // 시안 CSS에서 cover가 이겨 가로 쪽(262×344)은 위아래가 조금 잘린다
      resizeMode="cover"
      style={[fill, { width: pw, height: bh }, flipped && { transform: [{ scaleX: -1 }] }]}
    />
  );
  // 포스트잇 폭: 시안처럼 칸을 나누되 최대 62, 이웃이 많으면 최소 56으로 두고 가로로 민다.
  // 기울기·그림자·올라간 탭이 잘리지 않게 스크롤 영역을 위·아래·옆으로 조금 넓힌다
  const tabArea = bw * (land ? 0.35 : 0.51),
    tabW = Math.max(56, Math.min(62, (tabArea - 6 * (i.members.length - 1)) / i.members.length));
  const tabs = nb && (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{
        position: 'absolute',
        left: bw * (land ? 0.62 : 0.44) - 6,
        right: bw * (land ? 0.03 : 0.05) - 6,
        top: (land ? -16 : -14) - 8,
        zIndex: 1,
      }}
      contentContainerStyle={{
        flexGrow: 1,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        gap: 6,
        paddingTop: 8,
        paddingBottom: 12,
        paddingHorizontal: 6,
      }}
    >
      {i.members.map((m, n) => {
        const on = page !== 2 && m.id === member;
        return (
          <Pressable
            key={m.id}
            testID={`diary-member-${m.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${m.name} 기록`}
            accessibilityState={{ selected: on }}
            onPress={() => {
              setMember(m.id);
              if (page === 2) setPage(0);
            }}
            style={{
              width: tabW,
              minHeight: 40,
              paddingTop: 12,
              paddingHorizontal: 4,
              paddingBottom: 6,
              borderTopLeftRadius: 8,
              borderTopRightRadius: 8,
              borderBottomLeftRadius: 2,
              borderBottomRightRadius: 2,
              backgroundColor: ['#f5df91', '#bcdccd', '#edbcc5'][n % 3],
              boxShadow: 'rgba(73, 51, 35, 0.27) 1px 4px 3px',
              transform: [
                { translateY: on ? -6 : 6 },
                { rotate: on ? '-1deg' : ['2deg', '-2deg', '1deg'][n % 3] },
              ],
            }}
          >
            <T
              numberOfLines={1}
              style={t(13, 15.6, {
                fontFamily: font,
                color: '#59482f',
                textAlign: 'center',
                // 한 줄 자르기(overflow hidden)에 밑줄이 잘리지 않게 아래로 공간을 둔다
                paddingBottom: 6,
                marginBottom: -6,
                ...(on
                  ? web({
                      textDecorationLine: 'underline',
                      textDecorationColor: '#a46b49',
                      textUnderlineOffset: 4,
                    })
                  : null),
              })}
            >
              {m.name}
            </T>
          </Pressable>
        );
      })}
    </ScrollView>
  );
  const arrow = (dir: 'prev' | 'next') => (
    <Pressable
      testID={`diary-${dir}`}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={dir === 'prev' ? '이전 장' : '다음 장'}
      onPress={() => setPage((p) => p + (dir === 'prev' ? -1 : 1))}
      style={{
        position: 'absolute',
        top: bh * 0.51,
        [dir === 'prev' ? 'left' : 'right']: bw * (land ? -0.02 : 0.01),
        width: 32,
        height: 40,
        borderRadius: 999,
        borderWidth: 2,
        borderColor: BROWN,
        backgroundColor: '#ade1f8',
        boxShadow: `0px 3px 0px ${BROWN}`,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3,
      }}
    >
      <T style={t(15, 21.75, { fontWeight: '800' })}>{dir === 'prev' ? '←' : '→'}</T>
    </Pressable>
  );
  return (
    <View style={{ flex: 1 }}>
      <Image
        source={art[land ? 'L/lib/room-blur' : 'lib/room-blur']}
        style={fill}
        resizeMode="cover"
      />
      {/* 책 바깥을 누르면 덮고 테이블로 돌아간다 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="책 덮기"
        onPress={e.back}
        style={[fill, { backgroundColor: 'rgba(78, 61, 41, 0.17)' }]}
      />
      <View
        style={[
          { position: 'absolute', left: bx, top: by, width: bw, height: bh },
          web({ filter: 'drop-shadow(rgba(73, 51, 35, 0.333) 0px 12px 16px)' }),
        ]}
      >
        <View
          style={[
            {
              position: 'absolute',
              left: land && bx >= 136 ? -128 : 10,
              top: land ? (bx >= 136 ? 4 : -14) : -52,
              zIndex: 9,
              minWidth: land ? 0 : 118,
              paddingTop: land ? 6 : 7,
              paddingHorizontal: land ? 16 : 20,
              paddingBottom: land ? 7 : 8,
              borderWidth: 2,
              borderColor: '#6e4b31',
              borderTopLeftRadius: 7,
              borderTopRightRadius: 7,
              borderBottomLeftRadius: 11,
              borderBottomRightRadius: 11,
              backgroundColor: '#c78e58',
              boxShadow: 'inset 0px 1px 0px rgb(243, 205, 148), 0px 4px 0px rgb(110, 75, 49)',
              transform: [{ rotate: '-1deg' }],
            },
            web({
              backgroundImage:
                'linear-gradient(90deg, rgb(185, 121, 73), rgb(211, 160, 100) 48%, rgb(189, 129, 77))',
            }),
          ]}
        >
          {[8, undefined].map((left) => (
            <View
              key={String(left)}
              style={{
                position: 'absolute',
                top: 8,
                left,
                right: left ? undefined : 8,
                width: 5,
                height: 5,
                borderRadius: 3,
                backgroundColor: '#79543a',
              }}
            />
          ))}
          <T
            style={t(land ? 15 : 17, (land ? 15 : 17) * 1.3, {
              fontFamily: font,
              color: '#fff8e8',
              textAlign: 'center',
              textShadowColor: 'rgb(102, 68, 46)',
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 0,
            })}
            numberOfLines={1}
          >
            {nb ? '이웃들의 일기장' : '내 일기장'}
          </T>
        </View>
        {tabs}
        {(land ? [false, true] : [false]).map((right) => (
          <View
            key={String(right)}
            style={{ position: 'absolute', top: 0, left: right ? pw : 0, width: pw, height: bh }}
          >
            {pageBg(right || (!land && flip))}
            {!right && filter}
            <View style={pprStyle(right)}>
              {!right && head}
              {/* 월간 스크린타임 31줄·주민 15명 물고기 목록도 책 안에서 스크롤한다 */}
              {(!land || right) && (
                <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                  {body}
                </ScrollView>
              )}
            </View>
          </View>
        ))}
        {page > 0 && arrow('prev')}
        {page < lastPage && arrow('next')}
        {nb && page === 0 && (
          <T
            style={t(land ? 9 : 11, (land ? 9 : 11) * 1.45, {
              position: 'absolute',
              color: '#796256',
              ...(land
                ? { right: bw * 0.15, bottom: bh * 0.09 }
                : {
                    top: bh + 14,
                    alignSelf: 'center',
                    paddingVertical: 4,
                    paddingHorizontal: 12,
                    borderRadius: 99,
                    backgroundColor: 'rgba(255, 247, 235, 0.88)',
                    overflow: 'hidden',
                  }),
            })}
          >
            다른 섬 주민도 볼 수 있어요
          </T>
        )}
      </View>
    </View>
  );
}
const navBtn = (disabled: boolean) => ({
  width: 28,
  height: 28,
  borderRadius: 14,
  borderWidth: 1.5,
  borderColor: BROWN,
  backgroundColor: '#fffdfa',
  boxShadow: disabled ? undefined : `0px 2px 0px ${BROWN}`,
  opacity: disabled ? 0.4 : 1,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
});
