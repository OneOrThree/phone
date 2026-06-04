import React, { useState, useCallback, useRef } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '../utils/api';
import { T, inkBox } from '../components/theme';

export default function FocusCategoryScreen({ navigation }) {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTagId, setSelectedTagId] = useState(null);
  const [subject, setSubject] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [savingCreate, setSavingCreate] = useState(false);

  const [editingTagId, setEditingTagId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadTags({ initial: true });
      setSelectedTagId(null);
      setSubject('');
    }, []),
  );

  async function loadTags({ initial = false } = {}) {
    if (initial) setLoading(true);
    try {
      const res = await apiFetch('/api/v1/tag');
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];

      const alreadyInit = await AsyncStorage.getItem('gromo:tagsInitialized');
      if (list.length === 0 && initial && !alreadyInit) {
        await apiFetch('/api/v1/tag', {
          method: 'POST',
          body: JSON.stringify({ name: '공부' }),
        });
        await AsyncStorage.setItem('gromo:tagsInitialized', 'true');
        const res2 = await apiFetch('/api/v1/tag');
        const data2 = await res2.json();
        setTags(Array.isArray(data2) ? data2 : []);
      } else {
        if (!alreadyInit) await AsyncStorage.setItem('gromo:tagsInitialized', 'true');
        setTags(list);
      }
    } catch (e) {
      console.error('[태그 로드 실패]', e);
    } finally {
      if (initial) setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newTagName.trim()) return;
    setSavingCreate(true);
    try {
      const res = await apiFetch('/api/v1/tag', {
        method: 'POST',
        body: JSON.stringify({ name: newTagName.trim() }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setNewTagName('');
      setShowCreate(false);
      await loadTags();
    } catch (e) {
      Alert.alert('오류', '카테고리 생성에 실패했어요.');
    } finally {
      setSavingCreate(false);
    }
  }

  async function handleUpdate(tagId) {
    if (!editingName.trim()) return;
    setSavingEdit(true);
    try {
      const res = await apiFetch('/api/v1/tag', {
        method: 'PATCH',
        body: JSON.stringify({ tagId, name: editingName.trim() }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setEditingTagId(null);
      setEditingName('');
      await loadTags();
    } catch (e) {
      Alert.alert('오류', '카테고리 수정에 실패했어요.');
    } finally {
      setSavingEdit(false);
    }
  }

  function handleDeleteConfirm(tag) {
    Alert.alert('카테고리 삭제', `'${tag.name}'을(를) 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await apiFetch(`/api/v1/tag/${tag.tagId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`${res.status}`);
            if (selectedTagId === tag.tagId) setSelectedTagId(null);
            await loadTags();
          } catch (e) {
            Alert.alert('오류', '카테고리 삭제에 실패했어요.');
          }
        },
      },
    ]);
  }

  function startEditing(tag) {
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
  }

  function cancelCreate() {
    setShowCreate(false);
    setNewTagName('');
  }

  function handleSelectTag(tag) {
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

  const selectedTag = tags.find((t) => t.tagId === selectedTagId);

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
        <Text style={s.sectionLabel}>카테고리</Text>

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

  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkMed,
    marginBottom: 10,
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
