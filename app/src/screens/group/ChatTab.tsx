import { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  Keyboard,
  Platform,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { ListRenderItemInfo } from 'react-native';
import { T, inkBox } from '@/constants/theme';
import { api } from '@/services/api';
import { useUser } from '@/store/UserContext';

// 채팅 메시지
interface ChatMessage {
  id: number;
  senderId: number;
  senderName?: string;
  content: string;
  sentAt: string | number;
  unreadCount?: number;
}

interface ChatTabProps {
  groupId: number;
}

function isSameDay(a: string | number, b: string | number) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function formatHHMM(instant: string | number) {
  const d = new Date(instant);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateLabel(instant: string | number) {
  const d = new Date(instant);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}. ${mm}. ${dd}.`;
}

function DateSeparator({ instant }: { instant: string | number }) {
  return (
    <View style={s.dateSepWrap}>
      <View style={s.dateSepBadge}>
        <Text style={s.dateSepText}>{formatDateLabel(instant)}</Text>
      </View>
    </View>
  );
}

function OtherBubble({ message }: { message: ChatMessage }) {
  return (
    <View style={s.otherRow}>
      <View style={s.avatar}>
        <Text style={s.avatarText}>{message.senderName?.[0] ?? ''}</Text>
      </View>
      <View style={s.otherContent}>
        <Text style={s.senderName}>{message.senderName}</Text>
        <View style={s.otherBubbleRow}>
          <View style={[s.bubble, s.otherBubble, inkBox(T.paper)]}>
            <Text style={s.otherBubbleText}>{message.content}</Text>
          </View>
          <Text style={s.timeStamp}>{formatHHMM(message.sentAt)}</Text>
        </View>
      </View>
    </View>
  );
}

function MyBubble({ message }: { message: ChatMessage }) {
  const unread = message.unreadCount ?? 0;
  return (
    <View style={s.myRow}>
      <View style={s.myMeta}>
        {unread > 0 && <Text style={s.unreadCount}>{unread}</Text>}
        <Text style={s.timeStamp}>{formatHHMM(message.sentAt)}</Text>
      </View>
      <View style={[s.bubble, s.myBubble]}>
        <Text style={s.myBubbleText}>{message.content}</Text>
      </View>
    </View>
  );
}

export default function ChatTab({ groupId }: ChatTabProps) {
  const { userId } = useUser();
  const tabBarHeight = useBottomTabBarHeight();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [kbOffset, setKbOffset] = useState(0);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  async function fetchMessages() {
    try {
      const res = await api.get<ChatMessage[]>(`/api/v1/groups/${groupId}/messages`);
      const data = res.data;
      setMessages(data);
    } catch {
      // 조용히 실패 처리
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMessages();
    const id = setInterval(fetchMessages, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  useEffect(() => {
    const eventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEventName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(eventName, (e) => {
      setKbOffset(Math.max(0, e.endCoordinates.height - tabBarHeight));
    });
    const hide = Keyboard.addListener(hideEventName, () => setKbOffset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [tabBarHeight]);

  useEffect(() => {
    if (messages.length > 0) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages.length]);

  function handleSend() {
    const text = inputText.trim();
    if (!text) return;
    Alert.alert('준비 중', '채팅 기능은 아직 준비 중이에요 😅');
  }

  function renderItem({ item, index }: ListRenderItemInfo<ChatMessage>) {
    const isMe = item.senderId === userId;
    const showDate = index === 0 || !isSameDay(messages[index - 1].sentAt, item.sentAt);
    return (
      <>
        {showDate && <DateSeparator instant={item.sentAt} />}
        {isMe ? <MyBubble message={item} /> : <OtherBubble message={item} />}
      </>
    );
  }

  return (
    <View style={[s.root, { paddingBottom: kbOffset }]}>
      {loading ? (
        <ActivityIndicator size="large" color={T.ink} style={s.loader} />
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyText}>아직 메시지가 없어요</Text>
            </View>
          }
        />
      )}

      <View style={s.inputBar}>
        <TextInput
          style={s.input}
          placeholder="메시지를 입력하세요."
          placeholderTextColor={T.inkLight}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          multiline={false}
        />
        <TouchableOpacity
          style={[s.sendBtn, !inputText.trim() && s.sendBtnDisabled]}
          onPress={handleSend}
          activeOpacity={0.8}
          disabled={!inputText.trim()}
        >
          <Text style={s.sendBtnText}>전송</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paper },
  loader: { marginTop: 60 },

  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },

  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { fontSize: 14, fontWeight: '700', color: T.inkLight },

  // 날짜 구분선
  dateSepWrap: { alignItems: 'center', marginVertical: 16 },
  dateSepBadge: {
    backgroundColor: T.paperDark,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  dateSepText: { fontSize: 12, fontWeight: '600', color: T.inkMed },

  // 상대 메시지
  otherRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.paperDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 18,
  },
  avatarText: { fontSize: 13, fontWeight: '700', color: T.inkMed },
  otherContent: { flex: 1 },
  senderName: { fontSize: 12, fontWeight: '700', color: T.inkMed, marginBottom: 4 },
  otherBubbleRow: { flexDirection: 'row', alignItems: 'flex-end' },

  // 내 메시지
  myRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    marginBottom: 14,
  },
  myMeta: {
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    marginRight: 4,
    marginBottom: 2,
  },
  unreadCount: {
    fontSize: 11,
    fontWeight: '700',
    color: T.ink,
    lineHeight: 14,
    marginBottom: 2,
  },

  // 공통 말풍선
  bubble: { maxWidth: '70%', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  otherBubble: { backgroundColor: T.paper },
  otherBubbleText: { fontSize: 14, fontWeight: '500', color: T.ink, lineHeight: 20 },
  myBubble: { backgroundColor: T.ink },
  myBubbleText: { fontSize: 14, fontWeight: '500', color: T.paper, lineHeight: 20 },

  timeStamp: {
    fontSize: 11,
    fontWeight: '500',
    color: T.inkLight,
    marginHorizontal: 6,
    marginBottom: 2,
  },

  // 입력 바
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: T.paperLine,
    backgroundColor: T.paper,
  },
  input: {
    flex: 1,
    height: 40,
    backgroundColor: T.paperDark,
    borderRadius: 20,
    paddingHorizontal: 16,
    fontSize: 14,
    fontWeight: '500',
    color: T.ink,
    marginRight: 10,
  },
  sendBtn: {
    backgroundColor: T.ink,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.35 },
  sendBtnText: { fontSize: 14, fontWeight: '800', color: T.paper },
});
