import { View, Text, StyleSheet } from 'react-native';
import { T } from './theme';

const INK = T.ink;
const BW = 2.5;

// --- Eye variants ---
function EyeNormal() {
  return (
    <View style={s.eye}>
      <View style={s.pupil}>
        <View style={s.shine} />
      </View>
    </View>
  );
}

function EyeSquint() {
  return (
    <View style={[s.eye, s.eyeSquint]}>
      <View style={[s.pupil, s.pupilFlat]} />
    </View>
  );
}

function EyeCrescent() {
  // ^_^ happy crescent
  return <View style={s.eyeCrescent} />;
}

function EyeStar() {
  // energized star eyes for exercise
  return (
    <View style={s.eye}>
      <Text style={s.starEyeText}>★</Text>
    </View>
  );
}

// --- Body items ---
function BodyLaptop() {
  return <View style={s.laptop} />;
}

function BodyBook() {
  return (
    <View style={s.bookWrap}>
      <View style={s.bookPage}>
        <View style={s.bookLine} />
        <View style={s.bookLine} />
        <View style={s.bookLine} />
      </View>
      <View style={s.bookSpine} />
      <View style={s.bookPage}>
        <View style={s.bookLine} />
        <View style={s.bookLine} />
        <View style={s.bookLine} />
      </View>
    </View>
  );
}

function BodyDumbbell() {
  return (
    <View style={s.dbWrap}>
      <View style={s.dbWeight} />
      <View style={s.dbBar} />
      <View style={s.dbWeight} />
    </View>
  );
}

function BodyPaper() {
  return (
    <View style={s.paperWrap}>
      <View style={s.paper}>
        <View style={s.paperLine} />
        <View style={s.paperLine} />
        <View style={s.paperLine} />
      </View>
      <View style={s.pencil} />
    </View>
  );
}

function BodyYogaAura() {
  return (
    <View style={s.auraWrap}>
      <Text style={s.auraText}>✦</Text>
    </View>
  );
}

// --- Main component ---
const VARIANTS = {
  default:  { LeftEye: EyeNormal,   RightEye: EyeNormal,  Item: null,          mouthType: 'smile',    glasses: false, sweat: false, widePaws: false },
  focus:    { LeftEye: EyeSquint,   RightEye: EyeSquint,  Item: BodyLaptop,    mouthType: 'flat',     glasses: true,  sweat: false, widePaws: false },
  reading:  { LeftEye: EyeNormal,   RightEye: EyeNormal,  Item: BodyBook,      mouthType: 'smile',    glasses: false, sweat: false, widePaws: false },
  yoga:     { LeftEye: EyeCrescent, RightEye: EyeCrescent,Item: BodyYogaAura,  mouthType: 'bigSmile', glasses: false, sweat: false, widePaws: true  },
  exercise: { LeftEye: EyeStar,     RightEye: EyeStar,    Item: BodyDumbbell,  mouthType: 'open',     glasses: false, sweat: true,  widePaws: false },
  study:    { LeftEye: EyeSquint,   RightEye: EyeNormal,  Item: BodyPaper,     mouthType: 'tongue',   glasses: false, sweat: false, widePaws: false },
};

export function Character2D({ size = 120, variant = 'default', costumeSlots = [] }) {
  const scale = size / 120;
  const cfg = VARIANTS[variant] ?? VARIANTS.default;
  const { LeftEye, RightEye, Item, mouthType, glasses, sweat, widePaws } = cfg;
  const has = (slot) => costumeSlots.includes(slot);

  return (
    <View style={[s.wrapper, { transform: [{ scale }] }]}>
      {/* Ears */}
      <View style={s.earLeft}><View style={s.earInner} /></View>
      <View style={s.earRight}><View style={s.earInner} /></View>

      {/* Hat */}
      {has('hat') && (
        <View style={c.beret}>
          <View style={c.beretTop} />
        </View>
      )}

      {/* Hair */}
      {has('hair') && <View style={c.ponytail} />}

      {/* Accessory */}
      {has('accessory') && <Text style={c.earring}>★</Text>}

      {/* Head */}
      <View style={s.head}>
        <View style={s.eyesRow}>
          <LeftEye />
          <RightEye />
        </View>
        {glasses && (
          <View style={s.glassesRow}>
            <View style={s.glassesFrame} />
            <View style={s.glassesBridge} />
            <View style={s.glassesFrame} />
          </View>
        )}
        {sweat && <View style={s.sweat} />}
        <View style={s.cheeksRow}>
          <View style={s.cheek} />
          <View style={s.cheek} />
        </View>
        <View style={s.nose} />
        {mouthType === 'smile'    && <View style={s.mouth} />}
        {mouthType === 'bigSmile' && <View style={s.mouthBig} />}
        {mouthType === 'flat'     && <View style={s.mouthFlat} />}
        {mouthType === 'open'     && <View style={s.mouthOpen} />}
        {mouthType === 'tongue'   && (
          <View style={s.mouthTongueWrap}>
            <View style={s.mouthFlat} />
            <View style={s.tongue} />
          </View>
        )}
      </View>

      {/* Body */}
      <View style={[s.body, has('top') && c.bodyHoodie]}>
        {has('top') && <View style={c.hoodieString} />}
        {Item && <Item />}
      </View>

      {/* Bottom (jeans overlay) */}
      {has('bottom') && <View style={c.jeans} />}

      {/* Paws */}
      <View style={[s.pawsRow, widePaws && s.pawsWide]}>
        <View style={s.paw} />
        <View style={s.paw} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrapper: {
    width: 120,
    height: 175,
    alignItems: 'center',
  },

  // Ears
  earLeft: {
    position: 'absolute', top: 0, left: 16,
    width: 28, height: 30, borderRadius: 14,
    backgroundColor: '#FFF8E7',
    borderWidth: BW, borderColor: INK,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  earRight: {
    position: 'absolute', top: 0, right: 16,
    width: 28, height: 30, borderRadius: 14,
    backgroundColor: '#FFF8E7',
    borderWidth: BW, borderColor: INK,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  earInner: {
    width: 14, height: 18, borderRadius: 7,
    backgroundColor: '#FFB7C5',
    borderWidth: 1.5, borderColor: INK,
  },

  // Head
  head: {
    position: 'absolute', top: 14, left: 0, right: 0, height: 100,
    borderRadius: 50, backgroundColor: '#FFF8E7',
    borderWidth: BW, borderColor: INK,
    alignItems: 'center', paddingTop: 20, zIndex: 2,
  },

  // Eyes
  eyesRow: { flexDirection: 'row', gap: 20 },
  eye: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#FFF',
    borderWidth: 2, borderColor: INK,
    alignItems: 'center', justifyContent: 'center',
  },
  eyeSquint: { height: 14, borderRadius: 7, marginTop: 6 },
  pupil: {
    width: 16, height: 16, borderRadius: 8, backgroundColor: INK,
    alignItems: 'flex-end', justifyContent: 'flex-start', padding: 2,
  },
  pupilFlat: { height: 8, borderRadius: 4, width: 14 },
  shine: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFF' },
  eyeCrescent: {
    width: 22, height: 8, borderRadius: 4,
    backgroundColor: INK, marginTop: 4,
  },
  starEyeText: { fontSize: 13, color: T.yellowDark },

  // Glasses
  glassesRow: {
    position: 'absolute', top: 18,
    flexDirection: 'row', alignItems: 'center',
  },
  glassesFrame: {
    width: 30, height: 22, borderRadius: 8,
    borderWidth: 2, borderColor: T.inkMed, backgroundColor: 'transparent',
  },
  glassesBridge: { width: 8, height: 2.5, backgroundColor: T.inkMed },

  // Sweat
  sweat: {
    position: 'absolute', top: 14, right: 16,
    width: 8, height: 11, borderRadius: 4,
    borderBottomLeftRadius: 4, borderBottomRightRadius: 4,
    borderTopLeftRadius: 8, borderTopRightRadius: 0,
    backgroundColor: T.sky, borderWidth: 1.5, borderColor: INK,
    transform: [{ rotate: '15deg' }],
  },

  // Cheeks
  cheeksRow: { flexDirection: 'row', gap: 36, marginTop: 4 },
  cheek: {
    width: 20, height: 12, borderRadius: 10,
    backgroundColor: 'rgba(255, 120, 120, 0.25)',
  },

  // Nose
  nose: {
    width: 9, height: 6, borderRadius: 4,
    backgroundColor: '#FF8FAB',
    borderWidth: 1.5, borderColor: INK, marginTop: 2,
  },

  // Mouths
  mouth: {
    marginTop: 5, width: 22, height: 10,
    borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderRightWidth: 2.5, borderTopWidth: 0,
    borderBottomLeftRadius: 11, borderBottomRightRadius: 11, borderColor: INK,
  },
  mouthBig: {
    marginTop: 4, width: 30, height: 14,
    borderBottomWidth: 3, borderLeftWidth: 3, borderRightWidth: 3, borderTopWidth: 0,
    borderBottomLeftRadius: 15, borderBottomRightRadius: 15, borderColor: INK,
  },
  mouthFlat: { marginTop: 8, width: 18, height: 3, borderRadius: 2, backgroundColor: INK },
  mouthOpen: {
    marginTop: 5, width: 18, height: 12,
    borderRadius: 6, backgroundColor: INK,
    alignItems: 'center', justifyContent: 'center',
  },
  mouthTongueWrap: { alignItems: 'center' },
  tongue: {
    width: 12, height: 8, borderRadius: 6,
    backgroundColor: '#FF8FAB',
    borderWidth: 1.5, borderColor: INK,
    marginTop: -2,
  },

  // Body
  body: {
    position: 'absolute', top: 100, left: 18, right: 18, height: 62,
    borderRadius: 30, backgroundColor: '#FFF8E7',
    borderWidth: BW, borderColor: INK,
    zIndex: 1, alignItems: 'center', justifyContent: 'center',
  },

  // Body items
  laptop: {
    width: 34, height: 24, borderRadius: 4,
    borderWidth: 2, borderColor: INK, backgroundColor: '#C8E6FF',
  },

  bookWrap: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  bookPage: {
    width: 18, height: 26, backgroundColor: '#FFFCF0',
    borderWidth: 1.5, borderColor: INK,
    borderRadius: 2, padding: 3, gap: 4,
  },
  bookSpine: { width: 4, height: 26, backgroundColor: T.coral, borderWidth: 1, borderColor: INK },
  bookLine: { height: 2, backgroundColor: T.inkLight, borderRadius: 1 },

  dbWrap: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  dbWeight: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: T.inkMed, borderWidth: 1.5, borderColor: INK,
  },
  dbBar: {
    width: 22, height: 6, backgroundColor: T.inkLight,
    borderWidth: 1.5, borderColor: INK,
  },

  paperWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  paper: {
    width: 26, height: 30, backgroundColor: '#FFFCF0',
    borderWidth: 1.5, borderColor: INK, borderRadius: 2,
    padding: 4, gap: 4,
  },
  paperLine: { height: 2, backgroundColor: T.sky, borderRadius: 1 },
  pencil: {
    width: 6, height: 28, borderRadius: 3,
    backgroundColor: T.yellow, borderWidth: 1.5, borderColor: INK,
    marginTop: 1,
  },

  auraWrap: { alignItems: 'center' },
  auraText: { fontSize: 22, color: T.mint },

  // Paws
  pawsRow: { position: 'absolute', bottom: 0, flexDirection: 'row', gap: 30, zIndex: 3 },
  pawsWide: { gap: 44 },
  paw: {
    width: 22, height: 16, borderRadius: 11,
    backgroundColor: '#FFF8E7',
    borderWidth: BW, borderColor: INK,
  },
});

const c = StyleSheet.create({
  // 베레모
  beret: {
    position: 'absolute', top: -2, zIndex: 5,
    alignItems: 'center',
  },
  beretTop: {
    width: 64, height: 18, borderRadius: 32,
    backgroundColor: '#8B3A3A',
    borderWidth: BW, borderColor: INK,
  },

  // 포니테일
  ponytail: {
    position: 'absolute', top: 24, right: 6, zIndex: 1,
    width: 10, height: 48, borderRadius: 5,
    backgroundColor: '#7B4A1E',
    borderWidth: 1.5, borderColor: INK,
    transform: [{ rotate: '12deg' }],
  },

  // 별 귀걸이
  earring: {
    position: 'absolute', top: 46, left: 4, zIndex: 5,
    fontSize: 10, color: T.yellowDark,
  },

  // 후드티
  bodyHoodie: { backgroundColor: '#7EB8D4' },
  hoodieString: {
    position: 'absolute', top: 4,
    width: 4, height: 14, borderRadius: 2,
    backgroundColor: '#5A9AB8', borderWidth: 1, borderColor: INK,
  },

  // 청바지
  jeans: {
    position: 'absolute', bottom: 12, zIndex: 2,
    width: 76, height: 18, borderRadius: 4,
    backgroundColor: '#3A5A8C',
    borderWidth: BW, borderColor: INK,
    borderBottomWidth: 0,
  },
});
