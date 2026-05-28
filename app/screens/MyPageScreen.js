import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, PanResponder } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { T, inkBox } from '../components/theme';
import { Character2D } from '../components/character/Character2D';
import { useFocus } from '../contexts/FocusContext';
import { useUser } from '../contexts/UserContext';

const GOAL_MAX = 86400;  // 24h in seconds
const GOAL_STEP = 1800;  // 30min step
const THUMB_SIZE = 24;
const TRACK_HEIGHT = 12;
const SLIDER_HEIGHT = 44;

function formatFocusTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  if (minutes > 0) return `${minutes}분`;
  return `${totalSeconds}초`;
}

function formatGoalTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

function StatRow({ label, value, accent }) {
  return (
    <View style={[s.statRow, { borderLeftColor: accent, borderLeftWidth: 4 }]}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

function GoalSlider({ value, onChange }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const trackRef = useRef(null);
  const trackWidthRef = useRef(0);
  const pageXRef = useRef(0);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  function measureTrack() {
    trackRef.current?.measure((x, y, w, h, pageX) => {
      pageXRef.current = pageX;
      trackWidthRef.current = w;
      setTrackWidth(w);
    });
  }

  function snapValue(localX) {
    const w = trackWidthRef.current;
    if (w === 0) return value;
    const clamped = Math.max(0, Math.min(w, localX));
    const raw = (clamped / w) * GOAL_MAX;
    const stepped = Math.round(raw / GOAL_STEP) * GOAL_STEP;
    return Math.min(GOAL_MAX, Math.max(GOAL_STEP, stepped));
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e, gs) => {
        onChangeRef.current(snapValue(gs.x0 - pageXRef.current));
      },
      onPanResponderMove: (e, gs) => {
        onChangeRef.current(snapValue(gs.moveX - pageXRef.current));
      },
    })
  ).current;

  const fillPercent = (value / GOAL_MAX) * 100;
  const thumbLeft = trackWidth > 0 ? (value / GOAL_MAX) * trackWidth - THUMB_SIZE / 2 : 0;

  return (
    <View style={s.sliderWrapper}>
      <View
        ref={trackRef}
        style={s.sliderArea}
        onLayout={measureTrack}
        {...panResponder.panHandlers}
      >
        <View style={s.sliderTrack}>
          <View style={[s.sliderFill, { width: `${fillPercent}%` }]} />
        </View>
        {trackWidth > 0 && (
          <View style={[s.sliderThumb, { left: thumbLeft }]} />
        )}
      </View>
      <View style={s.sliderTicks}>
        {['0h', '6h', '12h', '18h', '24h'].map(label => (
          <Text key={label} style={s.sliderTickText}>{label}</Text>
        ))}
      </View>
    </View>
  );
}

export default function MyPageScreen({ onLogout }) {
  const { todayFocusSeconds } = useFocus();
  const { nickname, setNickname, goalSeconds, setGoalSeconds, phoneUsageSeconds } = useUser();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nickname);

  const [goalEditing, setGoalEditing] = useState(false);
  const [draftGoal, setDraftGoal] = useState(goalSeconds);

  function openEdit() {
    setDraft(nickname);
    setEditing(true);
  }
  function saveNickname() {
    if (draft.trim()) setNickname(draft.trim());
    setEditing(false);
  }

  function openGoalEdit() {
    setDraftGoal(goalSeconds);
    setGoalEditing(true);
  }
  function saveGoal() {
    setGoalSeconds(draftGoal);
    setGoalEditing(false);
  }

  return (
    <View style={s.container}>
      <StatusBar style="dark" />

      <Text style={s.title}>마이페이지 🐾</Text>

      {/* 닉네임 수정 모달 */}
      <Modal visible={editing} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, inkBox(T.paper)]}>
            <Text style={s.modalTitle}>닉네임 수정</Text>
            <TextInput
              style={s.input}
              value={draft}
              onChangeText={setDraft}
              maxLength={12}
              autoFocus
            />
            <View style={s.modalBtns}>
              <TouchableOpacity style={[s.modalBtn, inkBox(T.paperDark)]} onPress={() => setEditing(false)}>
                <Text style={s.modalBtnText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, inkBox(T.yellow)]} onPress={saveNickname}>
                <Text style={s.modalBtnText}>저장</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 목표 시간 수정 모달 */}
      <Modal visible={goalEditing} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={[s.goalModalCard, inkBox(T.paper)]}>
            <Text style={s.modalTitle}>핸드폰 사용 목표</Text>
            <Text style={s.goalDraftTime}>{formatGoalTime(draftGoal)}</Text>
            <GoalSlider value={draftGoal} onChange={setDraftGoal} />
            <View style={[s.modalBtns, { marginTop: 24 }]}>
              <TouchableOpacity style={[s.modalBtn, inkBox(T.paperDark)]} onPress={() => setGoalEditing(false)}>
                <Text style={s.modalBtnText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, inkBox(T.yellow)]} onPress={saveGoal}>
                <Text style={s.modalBtnText}>저장</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Profile card */}
      <View style={[s.profileCard, inkBox(T.yellow, '-0.5deg')]}>
        <View style={s.profileRow}>
          <View style={s.avatarWrap}>
            <Character2D size={72} />
          </View>
          <View style={s.profileInfo}>
            <View style={s.nicknameRow}>
              <Text style={s.nickname}>{nickname}</Text>
              <TouchableOpacity onPress={openEdit} style={s.editBtn}>
                <Text style={s.editBtnText}>수정</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.joinDate}>함께한 지 1일째</Text>
          </View>
        </View>
      </View>

      {/* Stats card */}
      <View style={[s.statsCard, inkBox(T.paperDark)]}>
        <Text style={s.statsTitle}>나의 기록 ✦</Text>
        <StatRow label="오늘 집중 시간" value={formatFocusTime(todayFocusSeconds)} accent={T.coral} />
        <StatRow label="연속 집중일" value="1일" accent={T.mint} />
        <StatRow label="이번 주 목표 달성" value="0 / 7일" accent={T.sky} />

        {/* 목표 시간 진행 바 */}
        {(() => {
          const ratio = Math.min(1, phoneUsageSeconds / goalSeconds);
          return (
            <View style={s.goalSection}>
              <View style={s.goalHeader}>
                <Text style={s.goalLabel}>핸드폰 사용 목표</Text>
                <View style={s.goalRight}>
                  <Text style={s.goalTime}>{formatGoalTime(goalSeconds)}</Text>
                  <TouchableOpacity onPress={openGoalEdit} style={s.editBtn}>
                    <Text style={s.editBtnText}>수정하기</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={s.barBg}>
                <View style={[s.barFill, { width: `${ratio * 100}%` }]} />
              </View>
              <View style={s.barLabels}>
                <Text style={s.barLabelText}>0</Text>
                <Text style={s.barLabelText}>3시간 28분 / {formatGoalTime(goalSeconds)}</Text>
              </View>
            </View>
          );
        })()}
      </View>

      {/* Deco */}
      <Text style={s.deco}>★ 꾸준히 하면 방이 커져요 ★</Text>

      <View style={[s.tipCard, inkBox(T.mint, '0.6deg')]}>
        <Text style={s.tipTitle}>🍅 포모도로 기법</Text>
        <Text style={s.tipText}>
          25분 집중 → 5분 휴식을 반복해봐요.{'\n'}
          짧게 끊을수록 더 오래 집중할 수 있어요!
        </Text>
      </View>

      <TouchableOpacity style={[s.logoutBtn, inkBox(T.paperDark)]} onPress={onLogout} activeOpacity={0.8}>
        <Text style={s.logoutText}>로그아웃</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.paper,
    paddingTop: 56,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 18,
  },

  profileCard: {
    padding: 18,
    marginBottom: 14,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarWrap: {
    width: 80,
    height: 90,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'visible',
  },
  profileInfo: {
    flex: 1,
  },
  nicknameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nickname: {
    fontSize: 20,
    fontWeight: '900',
    color: T.ink,
  },
  editBtn: {
    borderWidth: 2,
    borderColor: T.ink,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  editBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: T.inkMed,
  },
  joinDate: {
    fontSize: 13,
    color: T.inkMed,
    marginTop: 4,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: 280,
    padding: 24,
    backgroundColor: T.paper,
  },
  goalModalCard: {
    width: 320,
    padding: 24,
    backgroundColor: T.paper,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 16,
  },
  goalDraftTime: {
    fontSize: 36,
    fontWeight: '900',
    color: T.ink,
    textAlign: 'center',
    marginBottom: 24,
  },
  input: {
    borderWidth: 2.5,
    borderColor: T.ink,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '700',
    color: T.ink,
    marginBottom: 20,
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 10,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: T.ink,
  },

  statsCard: {
    padding: 18,
    marginBottom: 14,
  },
  statsTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 14,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: T.paper,
    borderRadius: 8,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkMed,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '900',
    color: T.ink,
  },

  goalSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1.5,
    borderTopColor: T.paperLine,
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  goalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkMed,
  },
  goalRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  goalTime: {
    fontSize: 15,
    fontWeight: '900',
    color: T.ink,
  },
  barBg: {
    height: 16,
    borderRadius: 8,
    backgroundColor: T.paperLine,
    borderWidth: 2,
    borderColor: T.ink,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: T.coral,
    borderRadius: 6,
  },
  barLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  barLabelText: {
    fontSize: 11,
    fontWeight: '700',
    color: T.inkLight,
  },

  sliderWrapper: {
    width: '100%',
  },
  sliderArea: {
    height: SLIDER_HEIGHT,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_HEIGHT,
    top: (SLIDER_HEIGHT - TRACK_HEIGHT) / 2,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: T.paperLine,
    borderWidth: 2,
    borderColor: T.ink,
    overflow: 'hidden',
  },
  sliderFill: {
    height: '100%',
    backgroundColor: T.coral,
  },
  sliderThumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: T.yellow,
    borderWidth: 3,
    borderColor: T.ink,
    top: (SLIDER_HEIGHT - THUMB_SIZE) / 2,
  },
  sliderTicks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sliderTickText: {
    fontSize: 11,
    fontWeight: '700',
    color: T.inkLight,
  },

  deco: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: T.inkLight,
    letterSpacing: 1,
    marginBottom: 14,
  },
  tipCard: {
    padding: 16,
  },
  tipTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: T.ink,
    marginBottom: 8,
  },
  tipText: {
    fontSize: 13,
    fontWeight: '600',
    color: T.inkMed,
    lineHeight: 20,
  },
  logoutBtn: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 14,
    fontWeight: '800',
    color: T.inkMed,
  },
});
