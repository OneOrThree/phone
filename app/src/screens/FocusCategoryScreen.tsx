import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '@/services/api';
import { T, inkBox } from '@/constants/theme';
import type { TabScreenProps } from '@/types/navigation';

// 카테고리(태그) — 서버 /api/v1/tag 응답
interface Tag {
  tagId: number;
  name: string;
}

// 집중 세션 — 서버 /api/v1/focus-session 응답 (통계 계산에 쓰는 필드만)
interface FocusSession {
  focusTagId?: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

// 태그별 누적 집중 시간(초) 맵
type TagStats = Record<number, number>;

function formatStat(seconds: number) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default function FocusCategoryScreen({ navigation }: TabScreenProps<'FocusCategoryScreen'>) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [subject, setSubject] = useState('');

  const [tagStats, setTagStats] = useState<TagStats>({});

  const [showCreate, setShowCreate] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [savingCreate, setSavingCreate] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadTags({ initial: true });
      setSelectedTagId(null);
      setSubject('');
    }, []),
  );

  async function loadTags({ initial = false }: { initial?: boolean } = {}) {
    if (initial) setLoading(true);
    try {
      const [tagRes, sessionRes] = await Promise.all([
        api.get<unknown>('/api/v1/tag'),
        api.get<unknown>('/api/v1/focus-session'),
      ]);
      const data = tagRes.data;
      const sessions = sessionRes.data;
      const list: Tag[] = Array.isArray(data) ? (data as Tag[]) : [];

      if (Array.isArray(sessions)) {
        const stats: TagStats = {};
        (sessions as FocusSession[]).forEach(({ focusTagId, startedAt, endedAt }) => {
          if (!focusTagId || !startedAt || !endedAt) return;
          const secs = Math.floor(
            (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
          );
          stats[focusTagId] = (stats[focusTagId] ?? 0) + secs;
        });
        setTagStats(stats);
      }

      if (list.length === 0 && initial) {
        await api.post('/api/v1/tag', { name: '공부' });
        const res2 = await api.get<unknown>('/api/v1/tag');
        const data2 = res2.data;
        setTags(Array.isArray(data2) ? (data2 as Tag[]) : []);
      } else {
        setTags(list);
      }
    } catch {
    } finally {
      if (initial) setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newTagName.trim()) return;
    setSavingCreate(true);
    try {
      await api.post('/api/v1/tag', { name: newTagName.trim() });
      setNewTagName('');
      setShowCreate(false);
      await loadTags();
    } catch {
      Alert.alert('오류', '카테고리 생성에 실패했어요.');
    } finally {
      setSavingCreate(false);
    }
  }

  async function handleUpdate(tagId: number) {
    if (!editingName.trim()) return;
    setSavingEdit(true);
    try {
      await api.patch('/api/v1/tag', { tagId, name: editingName.trim() });
      setEditingTagId(null);
      setEditingName('');
      await loadTags();
    } catch {
      Alert.alert('오류', '카테고리 수정에 실패했어요.');
    } finally {
      setSavingEdit(false);
    }
  }

  function handleDeleteConfirm(tag: Tag) {
    Alert.alert('카테고리 삭제', `'${tag.name}'을(를) 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/api/v1/tag/${tag.tagId}`);
            if (selectedTagId === tag.tagId) setSelectedTagId(null);
            await loadTags();
          } catch {
            Alert.alert('오류', '카테고리 삭제에 실패했어요.');
          }
        },
      },
    ]);
  }

  function startEditing(tag: Tag) {
    setEditingTagId(tag.tagId);
    setEditingName(tag.name);
    setShowCreate(false);
  }

  function cancelEditing() {
    setEditingTagId(null);
    setEditingName('');
  }

  function openCreate() {
    setShowCreate(true);
    setNewTagName('');
    setEditingTagId(null);
    setEditMode(false);
  }

  function cancelCreate() {
    setShowCreate(false);
    setNewTagName('');
  }

  function handleSelectTag(tag: Tag) {
    if (selectedTagId === tag.tagId) {
      setSelectedTagId(null);
      setSubject('');
    } else {
      setSelectedTagId(tag.tagId);
      setSubject('');
      setEditingTagId(null);
      setShowCreate(false);
    }
  }

  function handleStart() {
    const selectedTag = tags.find((t) => t.tagId === selectedTagId);
    navigation.navigate('FocusMode', {
      tagId: selectedTagId,
      tagName: selectedTag?.name ?? '',
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
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 16 }}
        >
          <Text style={s.backText}>← 뒤로</Text>
        </TouchableOpacity>
        <Text style={s.title}>무엇에 집중할까요?</Text>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.sectionRow}>
          <Text style={s.sectionLabel}>카테고리</Text>
          {!loading && tags.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setEditMode((v) => !v);
                setEditingTagId(null);
                setEditingName('');
              }}
            >
              <Text style={s.editModeText}>{editMode ? '완료' : '편집'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <ActivityIndicator color={T.ink} style={s.loader} />
        ) : (
          <>
            {tags.map((tag) => {
              const isSelected = selectedTagId === tag.tagId;
              const isEditing = editingTagId === tag.tagId;

              if (isEditing) {
                return (
                  <View key={tag.tagId} style={[s.tagCard, inkBox(T.yellow)]}>
                    <TextInput
                      style={s.tagInput}
                      value={editingName}
                      onChangeText={setEditingName}
                      autoFocus
                      maxLength={20}
                      placeholder="카테고리 이름"
                      placeholderTextColor={T.inkLight}
                      returnKeyType="done"
                      onSubmitEditing={() => handleUpdate(tag.tagId)}
                    />
                    <View style={s.inlineActions}>
                      <TouchableOpacity
                        style={[s.confirmBtn, (!editingName.trim() || savingEdit) && s.btnDisabled]}
                        onPress={() => handleUpdate(tag.tagId)}
                        disabled={!editingName.trim() || savingEdit}
                      >
                        <Text style={s.confirmBtnText}>완료</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.cancelBtn} onPress={cancelEditing}>
                        <Text style={s.cancelBtnText}>취소</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }

              return (
                <View key={tag.tagId} style={[s.tagCard, inkBox(isSelected ? T.mint : T.paper)]}>
                  {/* 카테고리 행 */}
                  <TouchableOpacity
                    style={s.tagRow}
                    onPress={() => handleSelectTag(tag)}
                    activeOpacity={0.7}
                  >
                    <Text style={s.tagName}>{tag.name}</Text>
                    {tagStats[tag.tagId] > 0 && (
                      <Text style={s.tagStat}>{formatStat(tagStats[tag.tagId])}</Text>
                    )}
                    {editMode && (
                      <View style={s.iconGroup}>
                        <TouchableOpacity
                          onPress={() => startEditing(tag)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                        >
                          <Text style={s.iconText}>수정</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDeleteConfirm(tag)}
                          hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                        >
                          <Text style={s.iconText}>삭제</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </TouchableOpacity>

                  {/* 선택된 경우 subject 입력칸 펼쳐짐 */}
                  {isSelected && (
                    <>
                      <View style={s.divider} />
                      <TextInput
                        style={s.subjectInput}
                        value={subject}
                        onChangeText={setSubject}
                        placeholder="어떤 걸 할 건지 입력해봐요 (선택)"
                        placeholderTextColor={T.inkLight}
                        maxLength={50}
                        returnKeyType="done"
                        autoFocus
                      />
                    </>
                  )}
                </View>
              );
            })}

            {showCreate ? (
              <View style={[s.tagCard, inkBox(T.yellow)]}>
                <TextInput
                  style={s.tagInput}
                  value={newTagName}
                  onChangeText={setNewTagName}
                  autoFocus
                  maxLength={20}
                  placeholder="카테고리 이름 입력"
                  placeholderTextColor={T.inkLight}
                  returnKeyType="done"
                  onSubmitEditing={handleCreate}
                />
                <View style={s.inlineActions}>
                  <TouchableOpacity
                    style={[s.confirmBtn, (!newTagName.trim() || savingCreate) && s.btnDisabled]}
                    onPress={handleCreate}
                    disabled={!newTagName.trim() || savingCreate}
                  >
                    <Text style={s.confirmBtnText}>추가</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.cancelBtn} onPress={cancelCreate}>
                    <Text style={s.cancelBtnText}>취소</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={s.addTagBtn} onPress={openCreate} activeOpacity={0.7}>
                <Text style={s.addTagBtnText}>+ 새 카테고리 만들기</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>

      {selectedTagId && (
        <View style={s.footer}>
          <TouchableOpacity style={s.startBtn} onPress={handleStart} activeOpacity={0.8}>
            <Text style={s.startBtnText}>집중 시작</Text>
          </TouchableOpacity>
        </View>
      )}
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
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: T.ink,
  },

  scroll: { flex: 1 },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkMed,
  },
  editModeText: {
    fontSize: 16,
    fontWeight: '700',
    color: T.ink,
  },

  loader: { marginTop: 40 },

  tagCard: {
    marginBottom: 8,
    overflow: 'hidden',
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  tagName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: T.ink,
  },
  tagStat: {
    fontSize: 13,
    fontWeight: '600',
    color: T.inkMed,
    marginRight: 8,
  },
  tagInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: T.ink,
    paddingVertical: 0,
    paddingHorizontal: 16,
    height: 52,
  },
  iconGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  iconText: {
    fontSize: 13,
    fontWeight: '600',
    color: T.inkMed,
  },

  divider: {
    height: 1,
    backgroundColor: T.ink,
    marginHorizontal: 16,
    opacity: 0.15,
  },
  subjectInput: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '500',
    color: T.ink,
  },

  inlineActions: {
    flexDirection: 'row',
    gap: 6,
    paddingRight: 16,
  },
  confirmBtn: {
    backgroundColor: T.ink,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  confirmBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: T.paper,
  },
  cancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkMed,
  },
  btnDisabled: {
    backgroundColor: T.inkLight,
  },

  addTagBtn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: T.inkLight,
    borderStyle: 'dashed',
  },
  addTagBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: T.inkMed,
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
