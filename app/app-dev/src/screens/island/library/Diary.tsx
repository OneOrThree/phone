import React, { useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { art, Seg } from '@/design-system/patterns';
import { Button } from '@/design-system/primitives';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import ScreenTimeReportView from '@/components/ScreenTimeReportView';
import { currentIsland, dayKey, earnedBy, type State } from '@/services/model';
import { getSession } from '@/services/api/session';
import { useLibraryDiary } from '@/screens/island/useLibraryDiary';
import { T, fill, hm } from '@/screens/island/sceneKit';
import { useAppLayout } from '@/utils/layout';
import {
  dateKey,
  datesBetween,
  diaryRange,
  localFocusByDay,
  longDate,
  recordsOnDay,
  shiftDate,
  shortDate,
  timetableRows,
  weekday,
  weekdays,
  type DiaryRecord,
  type Period,
} from './diaryData';

const D = componentTokens.diary;
const C = semanticTokens.color;
const S = semanticTokens.spacing;
const F = semanticTokens.typography;

// 기존 장면 엔진의 경로 계약을 유지한다. 서버 통계와 로컬 시연 데이터를 섞지 않는다.
export function Diary({ e, font }: { e: any; font?: string }) {
  const state: State = e.state;
  const island = currentIsland(state);
  const server = !!e.islands;
  const neighbors = e.detail === 'residents';
  const today = dateKey(e.now, server);
  const [period, setPeriod] = useState<Period>(e.tab === 'screen' ? '일' : '주');
  const [offset, setOffset] = useState(0);
  const [tab, setTab] = useState<'집중' | '폰 사용'>(e.tab === 'screen' ? '폰 사용' : '집중');
  const [selected, setSelected] = useState(today);
  const [memberId, setMemberId] = useState<string | null>(e.body || null);
  const scroll = useRef<ScrollView>(null);
  const range = neighbors
    ? { from: shiftDate(today, -6), to: today }
    : diaryRange(period, offset, e.now, server);
  const srv = useLibraryDiary({
    active: server,
    nb: neighbors,
    page: 0,
    period,
    offset,
    combined: true,
    rangeOverride: !neighbors && period === '주' && offset === 0 ? undefined : range,
    islandKey: state.islandId,
  });
  const allDays = datesBetween(range.from, range.to);
  const days = allDays.filter((key) => key <= today);
  const selectedDate =
    selected >= range.from && selected <= range.to && selected <= today
      ? selected
      : range.to > today
        ? today
        : range.to;
  const selectedDayStats = useLibraryDiary({
    active: server && !neighbors && period === '월',
    nb: false,
    page: 0,
    period: '일',
    offset: 0,
    rangeOverride: { from: selectedDate, to: selectedDate },
    islandKey: state.islandId,
  });
  const localRecords = state.records.filter((r) => r.islandId === island.id);
  const me = getSession()?.userId;
  const memberRows = server
    ? [...(srv.focusIsland?.members ?? []), ...(srv.screenIsland?.members ?? [])]
        .filter(
          (m, index, rows) =>
            m.userId !== me && rows.findIndex((r) => r.userId === m.userId) === index,
        )
        .map((m) => ({ id: m.userId, name: m.name ?? '주민', color: m.catColor ?? 'black' }))
    : island.members;
  const resident = memberRows.find((m) => m.id === memberId);
  const localResident = !server ? island.members.find((m) => m.id === memberId) : undefined;
  const focusMember = srv.focusIsland?.members.find((m) => m.userId === memberId);
  const screenMember = srv.screenIsland?.members.find((m) => m.userId === memberId);
  const localSource = neighbors
    ? (localResident?.records ?? []).filter((r) => r.islandId === island.id)
    : localRecords;
  const records: DiaryRecord[] = server
    ? (period === '월'
        ? (selectedDayStats.focusMe?.records ?? [])
        : (srv.focusMe?.records ?? [])
      ).map((r) => ({
        id: r.id,
        subject: r.subject,
        seconds: r.activeSeconds,
        at: Date.parse(r.completedAt),
      }))
    : localSource;
  const focusSeries = server
    ? new Map(
        (neighbors ? (focusMember?.series ?? []) : (srv.focusMe?.series ?? [])).map((p) => [
          p.date,
          p.seconds,
        ]),
      )
    : localFocusByDay(localSource, days, e.now);
  const focusAvailable = !server || !!(neighbors ? focusMember : srv.focusMe);
  if (focusAvailable)
    days.forEach((key) => {
      if (!focusSeries.has(key)) focusSeries.set(key, 0);
    });
  const focus = server
    ? neighbors
      ? focusMember?.totalSeconds
      : srv.focusMe?.totalSeconds
    : days.reduce((sum, key) => sum + (focusSeries.get(key) ?? 0), 0);
  const screenStats = neighbors ? screenMember : srv.screenMe;
  const usageAllowed = server
    ? screenStats?.measurementStatus === 'authorized'
    : neighbors
      ? localResident?.screenDays !== undefined
      : state.settings.permission && state.settings.screenTimeMeasurementReady;
  const usageSeries = server
    ? new Map(
        (screenStats?.series ?? []).map((p) => [
          p.date,
          p.measurementStatus === 'authorized' ? p.minutes : null,
        ]),
      )
    : new Map(Object.entries((neighbors ? localResident?.screenDays : state.screenDays) ?? {}));
  const screenTotal = server
    ? neighbors
      ? screenMember?.minutes
      : srv.screenMe?.totalMinutes
    : usageAllowed && days.length > 0 && days.every((key) => usageSeries.get(key) != null)
      ? days.reduce((sum, key) => sum + (usageSeries.get(key) ?? 0), 0)
      : null;
  const fish = server
    ? srv.screen?.fishEarnings?.members.find((m) => m.userId === (neighbors ? memberId : me))
        ?.earnedFish
    : earnedBy(island, neighbors ? (memberId ?? '') : 'me');
  const activeDay = period === '월' ? selectedDate : range.from;
  // 서버 records.activeSeconds는 요청 날짜와 겹친 기여분이다. 완료 날짜로 재필터하지 않는다.
  const dayRecords = server ? records : recordsOnDay(records, activeDay, false);
  const settings = () => e.go('permission');
  const close = () => e.back();
  const back = () => (neighbors && memberId ? setMemberId(null) : close());
  const title = neighbors
    ? resident
      ? `${resident.name}의 일기장`
      : '이웃들의 일기장'
    : '내 일기장';
  const label =
    period === '일'
      ? longDate(range.from)
      : period === '주'
        ? `${shortDate(range.from)} – ${shortDate(range.to)}`
        : `${range.from.slice(0, 4)}년 ${Number(range.from.slice(5, 7))}월`;
  const resetScroll = () => scroll.current?.scrollTo({ y: 0, animated: false });
  const changePeriod = (value: Period) => {
    setPeriod(value);
    setOffset(0);
    setSelected(today);
    resetScroll();
  };
  const status = server && srv.status !== 'ready' ? srv.status : null;

  const usageText = (minutes: number | null | undefined) =>
    minutes == null ? '—' : hm(minutes * 60);
  const ownUsage = (key: string) => {
    // 오늘의 네이티브 수치는 기기 날짜(KST)와 선택 날짜가 같을 때만 사용한다.
    const deviceToday = key === dayKey(e.now) && key === today;
    const nativeReady = state.settings.permission && state.settings.screenTimeMeasurementReady;
    if (deviceToday && nativeReady && Platform.OS === 'ios') {
      return (
        <ScreenTimeReportView
          testID="today-screen-time-report"
          reportContext="Compact Activity"
          style={styles.nativeReport}
        />
      );
    }
    if (
      deviceToday &&
      nativeReady &&
      Platform.OS === 'android' &&
      state.settings.screenTimeMeasurementDay === dayKey(e.now)
    ) {
      return <T style={styles.metricValue}>{hm(state.screenMinutes * 60)}</T>;
    }
    return <T style={styles.metricValue}>{usageAllowed ? usageText(usageSeries.get(key)) : '—'}</T>;
  };

  const showState = () => {
    if (status === 'loading') return <Loading />;
    if (status === 'locked')
      return <Empty title="도서관이 아직 완공되지 않았어요" action="도서관으로" onPress={close} />;
    if (status === 'error')
      return <Empty title="기록을 불러오지 못했어요" action="다시 불러오기" onPress={srv.retry} />;
    return null;
  };

  const personal = () => {
    if (period === '월') {
      return (
        <>
          <Calendar
            from={range.from}
            days={allDays}
            today={today}
            selected={selectedDate}
            onSelect={setSelected}
          />
          <View style={styles.divider} />
          <DatePicker
            label={longDate(selectedDate)}
            previous={() => setSelected(shiftDate(selectedDate, -1))}
            next={() => setSelected(shiftDate(selectedDate, 1))}
            previousDisabled={selectedDate === range.from}
            nextDisabled={selectedDate === range.to || selectedDate === today}
          />
          <View style={styles.row}>
            <Metric
              label="집중"
              value={focusAvailable ? hm(focusSeries.get(selectedDate) ?? 0) : '—'}
            />
            <View style={styles.metric}>
              <T style={styles.meta}>폰 사용</T>
              {ownUsage(selectedDate)}
            </View>
          </View>
          {server && selectedDayStats.status === 'loading' ? (
            <Loading />
          ) : server && selectedDayStats.status === 'error' ? (
            <Empty
              title="기록을 불러오지 못했어요"
              action="다시 불러오기"
              onPress={selectedDayStats.retry}
            />
          ) : (
            <SessionList records={dayRecords} utc={server} />
          )}
        </>
      );
    }
    if (tab === '폰 사용') {
      if (!usageAllowed)
        return (
          <Empty
            title={
              server && !screenStats
                ? '기록을 준비하고 있어요'
                : state.settings.permission
                  ? '측정 기록이 없어요'
                  : '측정 권한이 꺼져 있어요'
            }
            action={
              state.settings.permission && state.settings.screenTimeMeasurementReady
                ? undefined
                : '측정 설정 열기'
            }
            onPress={settings}
          />
        );
      if (period === '일')
        return (
          <>
            <T style={styles.centerMeta}>이날의 폰 사용</T>
            <View style={styles.dailyUsage}>{ownUsage(range.from)}</View>
          </>
        );
      return (
        <>
          <T style={styles.centerMeta}>이번 주 폰 사용</T>
          <T style={styles.total}>{screenTotal == null ? '합산 보류' : usageText(screenTotal)}</T>
          <Chart days={days} values={usageSeries} screen />
          <View style={styles.row}>
            <Metric
              label="하루 평균"
              value={screenTotal == null ? '—' : usageText(screenTotal / days.length)}
            />
            <Metric
              label="측정된 날짜"
              value={`${days.filter((key) => usageSeries.get(key) != null).length} / ${days.length}일`}
            />
          </View>
        </>
      );
    }
    if (!focusAvailable) return <Empty title="기록을 준비하고 있어요" />;
    if (!focus)
      return (
        <Empty
          title={period === '일' ? '이날은 기록이 없어요' : '이 주에는 기록이 없어요'}
          action={offset < 0 ? '오늘 기록으로' : '집중하러 가기'}
          onPress={() => (offset < 0 ? changePeriod('일') : e.go('focusSetup'))}
        />
      );
    if (period === '주') {
      const activeDays = days.filter((key) => (focusSeries.get(key) ?? 0) > 0).length;
      return (
        <>
          <T style={styles.centerMeta}>이번 주 집중</T>
          <T style={styles.total}>{hm(focus)}</T>
          <Chart days={days} values={focusSeries} />
          <View style={styles.row}>
            <Metric label="집중한 날" value={`${activeDays}일`} />
            <Metric label="집중일 평균" value={hm(focus / Math.max(1, activeDays))} />
            <Metric label="집중 횟수" value={`${records.length}회`} />
          </View>
        </>
      );
    }
    const subjects = Object.entries(
      dayRecords.reduce<Record<string, number>>((acc, r) => {
        acc[r.subject] = (acc[r.subject] ?? 0) + r.seconds;
        return acc;
      }, {}),
    ).sort((a, b) => b[1] - a[1]);
    return (
      <>
        <T style={styles.total}>{hm(focus)}</T>
        <View style={styles.row}>
          <Metric label="집중" value={`${dayRecords.length}회`} />
          <Metric
            label="최장"
            value={dayRecords.length ? hm(Math.max(...dayRecords.map((r) => r.seconds))) : '—'}
          />
          <Metric
            label="물고기"
            value={!server ? `${dayRecords.reduce((sum, r) => sum + (r.fish ?? 0), 0)}마리` : '—'}
          />
        </View>
        <T style={styles.sectionTitle}>과목별 집중</T>
        {subjects.map(([subject, seconds]) => (
          <View key={subject} style={styles.subjectRow}>
            <T style={styles.body}>{subject}</T>
            <T style={styles.metricValue}>{hm(seconds)}</T>
          </View>
        ))}
        <Timetable records={dayRecords} day={activeDay} utc={server} />
      </>
    );
  };

  const residentContent = () => {
    if (!resident)
      return memberRows.length ? (
        <>
          <T style={styles.meta}>우리 섬의 일기장 · {memberRows.length} / 15명</T>
          <View style={styles.residentGrid}>
            {memberRows.map((m) => (
              <Pressable
                key={m.id}
                testID={`diary-member-${m.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${m.name} 기록`}
                onPress={() => {
                  setMemberId(m.id);
                  resetScroll();
                }}
                style={({ pressed }) => [styles.resident, pressed && styles.pressed]}
              >
                <Image
                  source={art[`avatar/${m.color}`] ?? art['avatar/black']}
                  style={styles.avatar}
                  resizeMode="contain"
                />
                <T style={styles.residentName}>{m.name}</T>
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <Empty title="이웃의 자리가 비어 있어요" action="도서관으로" onPress={close} />
      );
    return (
      <>
        <View style={styles.profile}>
          <Image
            source={art[`avatar/${resident.color}`] ?? art['avatar/black']}
            style={styles.avatar}
            resizeMode="contain"
          />
          <T style={styles.profileName}>{resident.name}</T>
        </View>
        <T style={styles.centerMeta}>
          최근 7일 · {shortDate(range.from)} – {shortDate(range.to)}
        </T>
        <T style={styles.centerMeta}>집중</T>
        <T style={styles.total}>{focus == null ? '—' : hm(focus)}</T>
        <View style={styles.row}>
          <Metric label="폰 사용" value={usageAllowed ? usageText(screenTotal) : '—'} />
          <Metric label="모은 물고기" value={fish == null ? '—' : `${fish}마리`} />
        </View>
        <View style={styles.divider} />
        <T style={styles.centerTitle}>날짜별 기록</T>
        <View style={styles.tableRow}>
          <T style={styles.dateCell}>날짜</T>
          <T style={styles.tableCell}>집중</T>
          <T style={styles.tableCell}>폰 사용</T>
        </View>
        {[...days].reverse().map((key) => (
          <View key={key} style={styles.tableRow}>
            <T style={styles.dateCell}>
              {shortDate(key)} {weekday(key)}
            </T>
            <T style={[styles.tableCell, styles.bold]}>
              {focusAvailable ? hm(focusSeries.get(key) ?? 0) : '—'}
            </T>
            <T style={styles.tableCell}>{usageAllowed ? usageText(usageSeries.get(key)) : '—'}</T>
          </View>
        ))}
      </>
    );
  };

  return (
    <Book title={title} font={font} onBack={back} onClose={close}>
      {!neighbors && (
        <View style={styles.controls}>
          <Seg
            items={['일', '주', '월']}
            value={period}
            onChange={changePeriod}
            inset
            style={styles.period}
          />
          <DatePicker
            label={label}
            previous={() => {
              setOffset((n) => n - 1);
              resetScroll();
            }}
            next={() => {
              setOffset((n) => Math.min(0, n + 1));
              resetScroll();
            }}
            nextDisabled={offset === 0}
          />
          {period !== '월' && (
            <View style={styles.row}>
              {(['집중', '폰 사용'] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="tab"
                  accessibilityLabel={value}
                  accessibilityState={{ selected: tab === value }}
                  onPress={() => {
                    setTab(value);
                    resetScroll();
                  }}
                  style={[styles.tab, tab === value && styles.tabSelected]}
                >
                  <T style={[styles.body, tab === value && styles.bold]}>{value}</T>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}
      <ScrollView
        ref={scroll}
        style={styles.scroll}
        showsVerticalScrollIndicator
        contentContainerStyle={[styles.content, neighbors && styles.neighborContent]}
        key={`${neighbors ? 'neighbors' : period}-${state.islandId}`}
      >
        {showState() ?? (neighbors ? residentContent() : personal())}
      </ScrollView>
    </Book>
  );
}

function Book({
  title,
  font,
  onBack,
  onClose,
  children,
}: React.PropsWithChildren<{
  title: string;
  font?: string;
  onBack: () => void;
  onClose: () => void;
}>) {
  const L = useAppLayout();
  const width = Math.min(D.maxWidth, L.width - L.insets.left - L.insets.right);
  const left = (L.width - width) / 2;
  const top = Math.max(D.headerTop, L.insets.top);
  const bookTop = L.landscape ? top + D.headerHeight : top + D.bookTop - D.headerTop;
  const contentTop = L.landscape ? bookTop + S.section : top + D.contentTop - D.headerTop;
  return (
    <View style={styles.root}>
      <Image
        source={art[L.landscape ? 'L/lib/room' : 'lib/room']}
        style={fill}
        resizeMode="cover"
      />
      <View pointerEvents="none" style={[fill, styles.scrim]} />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left,
          top: bookTop,
          width,
          height: Math.max(0, L.height - bookTop - S.control),
        }}
      >
        <Image source={art['lib/page']} resizeMode="stretch" style={fill} />
      </View>
      <View
        style={[styles.header, { left: left + D.headerInset, right: left + D.headerInset, top }]}
      >
        <Arrow label="뒤로" onPress={onBack} glyph="‹" />
        <T numberOfLines={1} style={[styles.headerTitle, { fontFamily: font }]}>
          {title}
        </T>
        <Arrow label="책 덮기" onPress={onClose} glyph="×" />
      </View>
      <View
        style={{
          position: 'absolute',
          left: left + width * D.contentLeftRatio,
          right: left + width * D.contentRightRatio,
          top: contentTop,
          bottom: Math.max(
            L.insets.bottom + S.component,
            L.landscape ? S.section : D.contentBottom,
          ),
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Arrow({
  label,
  glyph,
  onPress,
  disabled = false,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.arrow,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <T style={styles.arrowText}>{glyph}</T>
    </Pressable>
  );
}

function DatePicker({
  label,
  previous,
  next,
  previousDisabled,
  nextDisabled,
}: {
  label: string;
  previous: () => void;
  next: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
}) {
  return (
    <View style={styles.datePicker}>
      <Arrow label="이전 기간" glyph="‹" onPress={previous} disabled={previousDisabled} />
      <T style={styles.dateLabel}>{label}</T>
      <Arrow label="다음 기간" glyph="›" onPress={next} disabled={nextDisabled} />
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <T style={styles.meta}>{label}</T>
      <T style={styles.metricValue}>{value}</T>
    </View>
  );
}

function Empty({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <T style={styles.emptyTitle}>{title}</T>
      {action && onPress && <Button title={action} onPress={onPress} />}
    </View>
  );
}

function Loading() {
  return (
    <View
      accessibilityLabel="기록 불러오는 중"
      accessibilityState={{ busy: true }}
      style={styles.loading}
    >
      <View style={[styles.skeleton, styles.skeletonTitle]} />
      <View style={[styles.skeleton, styles.skeletonTotal]} />
      <View style={[styles.skeleton, styles.skeletonChart]} />
      <View style={[styles.skeleton, styles.skeletonTotal]} />
    </View>
  );
}

function Calendar({
  from,
  days,
  today,
  selected,
  onSelect,
}: {
  from: string;
  days: string[];
  today: string;
  selected: string;
  onSelect: (day: string) => void;
}) {
  const blanks = new Date(`${from}T00:00:00Z`).getUTCDay();
  return (
    <View>
      <View style={styles.row}>
        {weekdays.map((d) => (
          <T key={d} style={styles.weekday}>
            {d}
          </T>
        ))}
      </View>
      <View style={styles.calendarGrid}>
        {Array.from({ length: blanks }, (_, n) => (
          <View key={`blank-${n}`} style={styles.calendarCell} />
        ))}
        {days.map((key) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={longDate(key)}
            accessibilityState={{ selected: key === selected, disabled: key > today }}
            disabled={key > today}
            onPress={() => onSelect(key)}
            style={({ pressed }) => [
              styles.calendarCell,
              key === selected && styles.calendarSelected,
              key > today && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <T style={[styles.body, key === selected && styles.bold]}>{Number(key.slice(8))}</T>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Chart({
  days,
  values,
  screen = false,
}: {
  days: string[];
  values: Map<string, number | null>;
  screen?: boolean;
}) {
  const max = Math.max(1, ...days.map((d) => values.get(d) ?? 0));
  return (
    <View style={styles.chart}>
      {days.map((day) => {
        const value = values.get(day);
        const minutes = value == null ? null : Math.floor(screen ? value : value / 60);
        return (
          <View
            key={day}
            style={styles.chartColumn}
            accessible
            accessibilityLabel={`${longDate(day)} ${minutes == null ? '기록 없음' : `${minutes}분`}`}
          >
            <T style={styles.chartLabel}>{minutes == null ? '—' : `${minutes}분`}</T>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.bar,
                  {
                    height:
                      value == null
                        ? 0
                        : Math.max(value > 0 ? 2 : 0, (value / max) * D.chartHeight),
                    backgroundColor: screen ? C.secondary : C.primary,
                  },
                ]}
              />
            </View>
            <T style={styles.chartLabel}>{weekday(day)}</T>
          </View>
        );
      })}
    </View>
  );
}

function Timetable({ records, day, utc }: { records: DiaryRecord[]; day: string; utc: boolean }) {
  if (records.length === 0 || records.some((r) => !r.intervals?.length))
    return <T style={styles.centerMeta}>시간대 기록 없음</T>;
  return (
    <View style={styles.timetable}>
      {timetableRows(records, day, utc).map(({ hour, cells }) => (
        <View key={hour} style={styles.timeRow}>
          <T style={styles.hour}>{String(hour).padStart(2, '0')}</T>
          {cells.map((focused, n) => (
            <View
              key={n}
              accessible
              accessibilityLabel={`${hour}시 ${n * 10}분${focused ? ' 집중' : ''}`}
              style={[styles.timeCell, focused && styles.timeFocused]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function SessionList({ records, utc }: { records: DiaryRecord[]; utc: boolean }) {
  const time = (at: number) => new Date(at + (utc ? 0 : 9 * 3600000)).toISOString().slice(11, 16);
  return (
    <View style={styles.sessions}>
      <T style={styles.sectionTitle}>집중 기록</T>
      {!records.length && <T style={styles.meta}>기록 없음</T>}
      {[...records]
        .sort((a, b) => a.at - b.at)
        .map((r) => (
          <View key={r.id} style={styles.session}>
            <T style={[styles.body, styles.bold]}>{r.subject}</T>
            <T style={styles.meta}>
              {r.intervals?.length
                ? `${time(r.intervals[0].start)} – ${time(r.intervals[r.intervals.length - 1].end)} · `
                : ''}
              {hm(r.seconds)}
            </T>
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.canvas },
  scrim: { backgroundColor: componentTokens.overlay.sheetBackground },
  header: {
    position: 'absolute',
    minHeight: D.headerHeight,
    borderRadius: semanticTokens.radius.full,
    backgroundColor: C.surface,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: F.body },
  arrow: {
    minWidth: semanticTokens.size.tapMin,
    minHeight: semanticTokens.size.tapMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowText: { fontSize: F.heading },
  controls: { gap: D.periodGap, paddingBottom: S.component },
  period: { minHeight: semanticTokens.size.tapMin },
  row: { flexDirection: 'row', alignItems: 'center' },
  datePicker: { flexDirection: 'row', alignItems: 'center' },
  dateLabel: { flex: 1, textAlign: 'center', color: C.textMuted, fontSize: F.label },
  tab: {
    flex: 1,
    minHeight: semanticTokens.size.tapMin,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: semanticTokens.stroke.strong,
    borderBottomColor: 'transparent',
  },
  tabSelected: { borderBottomColor: C.primary },
  scroll: { flex: 1 },
  content: { flexGrow: 1, gap: D.contentGap, paddingBottom: S.section },
  neighborContent: { gap: S.control },
  body: { fontSize: F.label, color: C.text, flexShrink: 1 },
  bold: { fontWeight: F.bold },
  meta: { fontSize: F.caption, color: C.textMuted },
  centerMeta: { fontSize: F.caption, color: C.textMuted, textAlign: 'center' },
  sectionTitle: { fontSize: F.body, fontWeight: F.bold },
  centerTitle: { fontSize: F.body, fontWeight: F.bold, textAlign: 'center' },
  total: {
    fontSize: F.display,
    fontWeight: F.extraBold,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  metric: { flex: 1, alignItems: 'center', gap: S.control / 2 },
  metricValue: {
    fontSize: F.title,
    fontWeight: F.bold,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  dailyUsage: { alignItems: 'center', minHeight: semanticTokens.size.tapMin },
  nativeReport: { width: '100%', minHeight: semanticTokens.size.tapMin },
  subjectRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: S.component,
  },
  divider: { height: componentTokens.divider.width, backgroundColor: C.divider },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarCell: {
    width: '14.285714%',
    minHeight: semanticTokens.size.tapMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarSelected: { backgroundColor: C.primary, borderRadius: semanticTokens.radius.full },
  weekday: {
    flex: 1,
    textAlign: 'center',
    color: C.textMuted,
    fontSize: F.caption,
    paddingVertical: S.control,
  },
  disabled: { opacity: D.unavailableOpacity },
  pressed: { opacity: D.pressedOpacity, backgroundColor: C.selected },
  residentGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  resident: {
    width: '33.333333%',
    minHeight: D.residentMinHeight,
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.control,
    padding: S.control,
    borderRadius: semanticTokens.radius.control,
  },
  residentName: { fontSize: F.label, fontWeight: F.bold, textAlign: 'center' },
  avatar: { width: D.avatarSize, height: D.avatarSize },
  profile: { flexDirection: 'row', alignItems: 'center', gap: S.control },
  profileName: { fontSize: F.heading },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: D.tableRowHeight,
    paddingHorizontal: S.control / 2,
    borderBottomWidth: semanticTokens.stroke.subtle,
    borderBottomColor: C.divider,
  },
  dateCell: { flex: 0.7, textAlign: 'center', fontSize: F.caption },
  tableCell: { flex: 1, textAlign: 'center', fontSize: F.label, fontVariant: ['tabular-nums'] },
  chart: { flexDirection: 'row', gap: S.control / 2, paddingVertical: S.component },
  chartColumn: { flex: 1, alignItems: 'center', gap: S.control / 2 },
  chartLabel: { fontSize: F.caption, color: C.textMuted, textAlign: 'center' },
  barTrack: { height: D.chartHeight, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: semanticTokens.radius.control / 2 },
  timetable: { gap: D.timetableGap },
  timeRow: { flexDirection: 'row', minHeight: D.timetableRowHeight, alignItems: 'center' },
  hour: { width: S.section, fontSize: F.caption, color: C.textMuted },
  timeCell: {
    flex: 1,
    height: D.timetableRowHeight,
    backgroundColor: C.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.outline,
  },
  timeFocused: { backgroundColor: C.primary },
  sessions: { gap: S.control },
  session: {
    borderLeftWidth: semanticTokens.stroke.strong,
    borderLeftColor: C.primary,
    paddingLeft: S.control,
    paddingVertical: S.control,
    gap: S.control / 2,
  },
  empty: {
    flexGrow: 1,
    minHeight: D.chartHeight * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.section,
  },
  emptyTitle: { fontSize: F.title, textAlign: 'center' },
  loading: { gap: S.section, alignItems: 'center', paddingTop: S.component },
  skeleton: { backgroundColor: C.divider, borderRadius: semanticTokens.radius.control },
  skeletonTitle: { width: '40%', height: F.title },
  skeletonTotal: { width: '75%', height: semanticTokens.size.tapMin },
  skeletonChart: { width: '100%', height: D.chartHeight },
});
