import { View, Text } from 'react-native';
import { s } from '../styles/characterStyles';

export function BodyLaptop() {
  return <View style={s.laptop} />;
}

export function BodyBook() {
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

export function BodyDumbbell() {
  return (
    <View style={s.dbWrap}>
      <View style={s.dbWeight} />
      <View style={s.dbBar} />
      <View style={s.dbWeight} />
    </View>
  );
}

export function BodyPaper() {
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

export function BodyYogaAura() {
  return (
    <View style={s.auraWrap}>
      <Text style={s.auraText}>✦</Text>
    </View>
  );
}
