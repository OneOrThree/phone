import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { T, inkBox } from '../components/theme';

export default function FocusSubjectScreen({ navigation, route }) {
  const { tagId, tagName } = route.params;
  const [subject, setSubject] = useState('');

  useFocusEffect(
    useCallback(() => {
      setSubject('');
    }, []),
  );

  function handleStart() {
    navigation.navigate('FocusMode', {
      tagId,
      tagName,
      subject: subject.trim(),
    });
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />

      <View style={s.header}>
        <TouchableOpacity
          onPress={() => navigation.navigate('FocusCategoryScreen')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 16 }}
        >
          <Text style={s.backText}>← 뒤로</Text>
        </TouchableOpacity>
        <View style={s.headerRow}>
          <Text style={s.tagBadge}>{tagName}</Text>
          <Text style={s.title}>오늘 뭘 할 건가요?</Text>
        </View>
      </View>

      <View style={s.body}>
        <View style={[s.inputBox, inkBox(T.paper)]}>
          <TextInput
            style={s.input}
            value={subject}
            onChangeText={setSubject}
            placeholder={`예) ${tagName === '공부' ? '수학 문제풀기' : tagName === '운동' ? '요가 30분' : '오늘의 할일'}…`}
            placeholderTextColor={T.inkLight}
            maxLength={50}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleStart}
          />
        </View>
        <Text style={s.hint}>입력하지 않아도 집중 시작할 수 있어요</Text>
      </View>

      <View style={s.footer}>
        <TouchableOpacity style={s.startBtn} onPress={handleStart} activeOpacity={0.8}>
          <Text style={s.startBtnText}>집중 시작</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.paper,
  },

  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: T.ink,
    gap: 8,
  },
  backText: {
    fontSize: 14,
    fontWeight: '700',
    color: T.inkMed,
  },
  headerRow: {
    gap: 4,
  },
  tagBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkMed,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: T.ink,
  },

  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 32,
  },
  inputBox: {
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  input: {
    fontSize: 16,
    fontWeight: '600',
    color: T.ink,
  },
  hint: {
    marginTop: 10,
    fontSize: 12,
    color: T.inkLight,
    fontWeight: '500',
  },

  footer: {
    padding: 20,
    paddingBottom: 40,
    borderTopWidth: 1.5,
    borderTopColor: T.paperLine,
  },
  startBtn: {
    backgroundColor: T.ink,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: T.paper,
  },
});
