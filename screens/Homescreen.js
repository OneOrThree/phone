import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useEquipment } from '../contexts/EquipmentContext';
import { useFocus } from '../contexts/FocusContext';
import { Character2D } from '../components/Character2D';
import { T, inkBox } from '../components/theme';

function formatFocusTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${sec}초`;
  return `${sec}초`;
}

function NotebookLines() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: 14 }).map((_, i) => (
        <View key={i} style={[s.ruleLine, { top: 28 + i * 28 }]} />
      ))}
    </View>
  );
}

function StatBox({ label, value, accent, rotate = '0deg' }) {
  return (
    <View style={[s.statBox, { backgroundColor: accent, transform: [{ rotate }] }]}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

// ── Furniture 2D components ──────────────────────────────────────────────────

function Desk2D() {
  return (
    <View style={f.deskWrap}>
      <View style={f.deskMonitor}>
        <View style={f.deskScreen} />
        <View style={f.deskStand} />
      </View>
      <View style={f.deskTop} />
      <View style={f.deskLegs}>
        <View style={f.deskLeg} />
        <View style={f.deskLeg} />
      </View>
    </View>
  );
}

function Bed2D() {
  return (
    <View style={f.bedWrap}>
      {/* Headboard */}
      <View style={f.headboard} />
      {/* Mattress + pillow */}
      <View style={f.mattress}>
        <View style={f.pillow} />
        <View style={f.blanket} />
      </View>
      {/* Legs */}
      <View style={f.bedLegs}>
        <View style={f.bedLeg} />
        <View style={f.bedLeg} />
      </View>
    </View>
  );
}

function Window2D() {
  return (
    <View style={f.window}>
      {/* Frame dividers */}
      <View style={f.windowV} />
      <View style={f.windowH} />
      {/* Content panes */}
      <View style={[f.pane, { top: 0, left: 0 }]}><Text style={f.paneText}>☁</Text></View>
      <View style={[f.pane, { top: 0, right: 0 }]}><Text style={f.paneText}>✦</Text></View>
      <View style={[f.pane, { bottom: 0, left: 0 }]}><Text style={f.paneText}>☀</Text></View>
      <View style={[f.pane, { bottom: 0, right: 0 }]}><Text style={f.paneText}>·</Text></View>
    </View>
  );
}

function Frame2D() {
  return (
    <View style={f.frame}>
      <View style={f.frameInner}>
        {/* Simple mountain scene */}
        <View style={f.mountain1} />
        <View style={f.mountain2} />
        <View style={f.frameSun} />
      </View>
    </View>
  );
}

function Carpet2D() {
  return (
    <View style={f.carpet}>
      <View style={f.carpetInner} />
      <View style={f.carpetDot} />
    </View>
  );
}

// ── Room scene ───────────────────────────────────────────────────────────────

function Room({ equippedFurniture, costumeSlots }) {
  const ids = equippedFurniture.map((i) => i.id);
  const has = (id) => ids.includes(id);

  return (
    <View style={s.room}>
      {/* Background layers */}
      <View style={s.roomWall} />
      <View style={s.roomFloor} />

      {/* Wall decorations */}
      {has('window') && <View style={s.windowPos}><Window2D /></View>}
      {has('frame')  && <View style={s.framePos}><Frame2D /></View>}

      {/* Floor items (rendered before character for z-order) */}
      {has('carpet') && <View style={s.carpetPos}><Carpet2D /></View>}
      {has('bed')    && <View style={s.bedPos}><Bed2D /></View>}
      {has('desk')   && <View style={s.deskPos}><Desk2D /></View>}

      {/* Character on top */}
      <View style={s.charPos}>
        <Character2D size={128} costumeSlots={costumeSlots} />
      </View>

      {/* Ambient deco */}
      <Text style={[s.deco, { top: 10, left: 16 }]}>★</Text>
      <Text style={[s.deco, { top: 18, right: 22 }]}>✦</Text>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen({ navigation }) {
  const { equippedItem, equippedFurniture, equippedCostume } = useEquipment();
  const { todayFocusSeconds } = useFocus();
  const costumeSlots = equippedCostume.map(c => c.slot);

  return (
    <View style={s.container}>
      <StatusBar style="dark" />
      <NotebookLines />

      <View style={s.header}>
        <Text style={s.headerTitle}>오늘의 수빈이 ✦</Text>
        <Text style={s.headerSub}>오늘도 열심히 집중해요</Text>
      </View>

      <View style={s.statsRow}>
        <StatBox label="목표" value="3시간"  accent={T.yellow} rotate="-1.2deg" />
        <StatBox label="사용" value="1h 20m" accent={T.sky}    rotate="0.8deg"  />
        <StatBox label="남은" value="1h 40m" accent={T.mint}   rotate="-0.5deg" />
      </View>

      <View style={s.roomWrap}>
        <Room equippedFurniture={equippedFurniture} costumeSlots={costumeSlots} />
      </View>

      <View style={[s.bottomCard, inkBox(T.paper)]}>
        <View style={s.bottomRow}>
          <View>
            <Text style={s.focusLabel}>오늘 집중 ⏱</Text>
            <Text style={s.focusTime}>{formatFocusTime(todayFocusSeconds)}</Text>
            {equippedItem && (
              <Text style={s.equippedHint}>✔ {equippedItem.name} 장착중</Text>
            )}
          </View>
          <Pressable
            style={({ pressed }) => [s.startBtn, pressed && s.startBtnPressed]}
            onPress={() => navigation.navigate('FocusMode')}
          >
            <Text style={s.startBtnText}>집중 시작!</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ── Furniture styles ─────────────────────────────────────────────────────────
const f = StyleSheet.create({
  // Desk
  deskWrap: { alignItems: 'center' },
  deskMonitor: { alignItems: 'center', marginBottom: 2 },
  deskScreen: { width: 44, height: 30, borderRadius: 3, backgroundColor: '#B0D0F0', borderWidth: 2.5, borderColor: T.ink },
  deskStand: { width: 5, height: 6, backgroundColor: T.inkMed },
  deskTop: { width: 78, height: 9, borderRadius: 3, backgroundColor: '#A07850', borderWidth: 2, borderColor: T.ink },
  deskLegs: { flexDirection: 'row', gap: 50, marginTop: 2 },
  deskLeg: { width: 6, height: 24, borderRadius: 3, backgroundColor: '#8B6540', borderWidth: 1.5, borderColor: T.ink },

  // Bed
  bedWrap: { flexDirection: 'row', alignItems: 'flex-end' },
  headboard: { width: 14, height: 52, borderRadius: 7, backgroundColor: '#D4956A', borderWidth: 2.5, borderColor: T.ink },
  mattress: {
    width: 70, height: 38, borderRadius: 6,
    backgroundColor: '#F5ECD7', borderWidth: 2, borderColor: T.ink,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, gap: 6,
  },
  pillow: { width: 22, height: 26, borderRadius: 8, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: T.inkLight },
  blanket: { flex: 1, height: 24, borderRadius: 5, backgroundColor: '#FF9B9B', borderWidth: 1.5, borderColor: T.ink },
  bedLegs: { position: 'absolute', bottom: -12, left: 14, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
  bedLeg: { width: 8, height: 12, borderRadius: 3, backgroundColor: '#A07850', borderWidth: 1.5, borderColor: T.ink },

  // Window
  window: {
    width: 62, height: 58, borderRadius: 4,
    backgroundColor: '#D4EEFF', borderWidth: 2.5, borderColor: T.ink,
    position: 'relative', overflow: 'hidden',
  },
  windowV: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 2.5, backgroundColor: T.ink },
  windowH: { position: 'absolute', left: 0, right: 0, top: '50%', height: 2.5, backgroundColor: T.ink },
  pane: { position: 'absolute', width: 26, height: 24, alignItems: 'center', justifyContent: 'center' },
  paneText: { fontSize: 11, color: T.inkMed },

  // Picture frame
  frame: {
    width: 54, height: 46, borderRadius: 4,
    borderWidth: 3, borderColor: T.inkMed,
    backgroundColor: '#8B6540', padding: 3,
  },
  frameInner: {
    flex: 1, borderRadius: 2,
    backgroundColor: '#E8F4FF', overflow: 'hidden',
    position: 'relative',
  },
  mountain1: {
    position: 'absolute', bottom: 0, left: -4,
    width: 0, height: 0,
    borderLeftWidth: 22, borderRightWidth: 22, borderBottomWidth: 28,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#6BA868',
  },
  mountain2: {
    position: 'absolute', bottom: 0, right: -4,
    width: 0, height: 0,
    borderLeftWidth: 18, borderRightWidth: 18, borderBottomWidth: 22,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#4A8A46',
  },
  frameSun: {
    position: 'absolute', top: 4, right: 6,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: T.yellow, borderWidth: 1.5, borderColor: T.yellowDark,
  },

  // Carpet
  carpet: {
    width: 140, height: 22, borderRadius: 11,
    backgroundColor: '#C5637A', borderWidth: 2.5, borderColor: T.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  carpetInner: {
    width: 120, height: 10, borderRadius: 5,
    backgroundColor: '#E0849A', borderWidth: 1.5, borderColor: T.ink,
  },
  carpetDot: {
    position: 'absolute',
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: T.yellow, borderWidth: 1.5, borderColor: T.ink,
  },
});

// ── Screen styles ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.paper, paddingTop: 52, paddingHorizontal: 16 },

  ruleLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: T.paperLine },

  header: { marginBottom: 14, paddingLeft: 4 },
  headerTitle: { fontSize: 26, fontWeight: '900', color: T.ink, letterSpacing: -0.5 },
  headerSub: { fontSize: 13, color: T.inkMed, marginTop: 2 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statBox: {
    flex: 1, borderWidth: 2.5, borderColor: T.ink,
    borderBottomWidth: 5, borderRightWidth: 5,
    borderTopLeftRadius: 12, borderTopRightRadius: 10,
    borderBottomLeftRadius: 11, borderBottomRightRadius: 13,
    paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center',
  },
  statLabel: { fontSize: 10, fontWeight: '700', color: T.ink, opacity: 0.7 },
  statValue: { fontSize: 15, fontWeight: '900', color: T.ink, marginTop: 4 },

  roomWrap: {
    flex: 1, borderWidth: 2.5, borderColor: T.ink,
    borderRadius: 20, overflow: 'hidden', marginBottom: 14,
  },
  room: { flex: 1, position: 'relative' },
  roomWall: { position: 'absolute', top: 0, left: 0, right: 0, bottom: '38%', backgroundColor: '#EDE0C4' },
  roomFloor: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: '40%',
    backgroundColor: '#C4935A', borderTopWidth: 2.5, borderTopColor: T.ink,
  },

  // Furniture positions
  windowPos: { position: 'absolute', top: '8%', left: '8%' },
  framePos:  { position: 'absolute', top: '6%', right: '10%' },
  carpetPos: { position: 'absolute', bottom: '30%', alignSelf: 'center' },
  bedPos:    { position: 'absolute', bottom: '36%', left: '4%' },
  deskPos:   { position: 'absolute', right: '5%', bottom: '33%' },

  charPos:   { position: 'absolute', bottom: '26%', alignSelf: 'center' },

  deco: { position: 'absolute', fontSize: 16, color: T.inkLight },

  bottomCard: { padding: 18, marginBottom: 8 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  focusLabel: { fontSize: 13, fontWeight: '700', color: T.inkMed },
  focusTime:  { fontSize: 28, fontWeight: '900', color: T.ink, marginTop: 2, letterSpacing: -1 },
  equippedHint: { fontSize: 11, fontWeight: '700', color: T.mintDark, marginTop: 4 },

  startBtn: {
    backgroundColor: T.coral,
    borderWidth: 2.5, borderColor: T.ink,
    borderBottomWidth: 5, borderRightWidth: 5,
    borderTopLeftRadius: 14, borderTopRightRadius: 12,
    borderBottomLeftRadius: 12, borderBottomRightRadius: 14,
    paddingVertical: 14, paddingHorizontal: 20,
  },
  startBtnPressed: { transform: [{ translateX: 2 }, { translateY: 2 }], borderBottomWidth: 2.5, borderRightWidth: 2.5 },
  startBtnText: { fontSize: 15, fontWeight: '900', color: T.ink },
});
