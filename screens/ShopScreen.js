import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, Image,
} from 'react-native';
import { useEquipment } from '../contexts/EquipmentContext';
import { T, inkBox } from '../components/theme';

const shopItems = {
  item: [
    {
      id: 'desktop',
      name: '데스크탑',
      type: 'item',
      icon: '🖥',
      thumbnail: require('../assets/itemThumbnail/Desktop.png'),
      focusVariant: 'focus',
      desc: '집중 모드에서 안경 쓰고 노트북 작업!',
    },
    {
      id: 'book',
      name: '책',
      type: 'item',
      icon: '📚',
      thumbnail: null,
      focusVariant: 'reading',
      desc: '독서하면서 집중! 책 읽는 포즈로 변신.',
    },
    {
      id: 'yoga',
      name: '요가매트',
      type: 'item',
      icon: '🧘',
      thumbnail: null,
      focusVariant: 'yoga',
      desc: '요가하면서 마음도 집중! 평온한 표정.',
    },
    {
      id: 'exercise',
      name: '운동기구',
      type: 'item',
      icon: '💪',
      thumbnail: null,
      focusVariant: 'exercise',
      desc: '운동하면서 집중! 덤벨 들고 파이팅!',
    },
    {
      id: 'study',
      name: '문제집',
      type: 'item',
      icon: '✏',
      thumbnail: null,
      focusVariant: 'study',
      desc: '문제집 풀면서 집중! 혀 내밀고 열심히.',
    },
  ],
  furniture: [
    {
      id: 'desk',
      name: '책상',
      type: 'furniture',
      icon: '🖥',
      thumbnail: require('../assets/furnitureThumbnail/Desk.png'),
      desc: '방에 모니터 책상을 놓아요!',
    },
    {
      id: 'bed',
      name: '침대',
      type: 'furniture',
      icon: '🛏',
      thumbnail: null,
      desc: '푹신한 침대! 방이 아늑해져요.',
    },
    {
      id: 'window',
      name: '창문',
      type: 'furniture',
      icon: '🪟',
      thumbnail: null,
      desc: '햇살 들어오는 창문. 밝은 기분!',
    },
    {
      id: 'frame',
      name: '액자',
      type: 'furniture',
      icon: '🖼',
      thumbnail: null,
      desc: '벽에 예쁜 그림을 걸어요.',
    },
    {
      id: 'carpet',
      name: '카펫',
      type: 'furniture',
      icon: '🟥',
      thumbnail: null,
      desc: '바닥에 포근한 카펫을 깔아요!',
    },
  ],
};

export default function ShopScreen() {
  const [selectedCategory, setSelectedCategory] = useState('item');
  const [selectedItem, setSelectedItem] = useState(null);
  const { equippedItem, setEquippedItem, equippedFurniture, toggleFurniture } = useEquipment();
  const items = shopItems[selectedCategory];

  function handleSelectItem(item) {
    setSelectedItem(item);
  }

  function handleEquip() {
    if (!selectedItem) return;
    setEquippedItem(selectedItem);
  }

  function handleUnequip() {
    setEquippedItem(null);
    setSelectedItem(null);
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>상점 🛍</Text>
        <Text style={s.subtitle}>방을 꾸미고 캐릭터를 키워봐요</Text>
      </View>

      {/* Category tabs */}
      <View style={s.tabRow}>
        {['item', 'furniture'].map((cat) => (
          <Pressable
            key={cat}
            style={[s.tab, selectedCategory === cat && s.tabActive]}
            onPress={() => { setSelectedCategory(cat); setSelectedItem(null); }}
          >
            <Text style={[s.tabText, selectedCategory === cat && s.tabTextActive]}>
              {cat === 'item' ? '✦ 아이템' : '🪑 가구'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Item grid */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.grid}
      >
        {items.map((item) => {
          const isSelected = selectedItem?.id === item.id;
          const isEquipped = item.type === 'furniture'
            ? equippedFurniture.some((f) => f.id === item.id)
            : equippedItem?.id === item.id;

          return (
            <Pressable
              key={item.id}
              style={[s.itemCard, isSelected && s.itemCardSelected]}
              onPress={() => handleSelectItem(item)}
            >
              <View style={s.itemThumb}>
                {item.thumbnail ? (
                  <Image source={item.thumbnail} style={s.itemImg} />
                ) : (
                  <Text style={s.itemIcon}>{item.icon}</Text>
                )}
              </View>
              <Text style={s.itemName}>{item.name}</Text>
              {isEquipped && <Text style={s.equippedBadge}>✔ 장착중</Text>}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Detail panel */}
      <View style={[s.detailCard, inkBox(selectedItem ? T.yellow : T.paperDark)]}>
        {selectedItem ? (
          <>
            <Text style={s.detailTitle}>
              {selectedItem.icon} {selectedItem.name}
            </Text>
            <Text style={s.detailDesc}>{selectedItem.desc}</Text>

            {selectedItem.type === 'furniture' ? (
              equippedFurniture.some((f) => f.id === selectedItem.id) ? (
                <Pressable style={s.unequipBtn} onPress={() => toggleFurniture(selectedItem)}>
                  <Text style={s.unequipBtnText}>장착 해제</Text>
                </Pressable>
              ) : (
                <Pressable style={s.equipBtn} onPress={() => toggleFurniture(selectedItem)}>
                  <Text style={s.equipBtnText}>장착하기 ✓</Text>
                </Pressable>
              )
            ) : (
              equippedItem?.id === selectedItem.id ? (
                <Pressable style={s.unequipBtn} onPress={handleUnequip}>
                  <Text style={s.unequipBtnText}>장착 해제</Text>
                </Pressable>
              ) : (
                <Pressable style={s.equipBtn} onPress={handleEquip}>
                  <Text style={s.equipBtnText}>장착하기 ✓</Text>
                </Pressable>
              )
            )}
          </>
        ) : (
          <>
            <Text style={s.detailTitle}>아이템을 골라봐요 ☝</Text>
            <Text style={s.detailDesc}>눌러서 자세히 보기</Text>
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: T.paper,
    paddingTop: 56, paddingHorizontal: 18,
  },
  header: { marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '900', color: T.ink },
  subtitle: { fontSize: 13, color: T.inkMed, marginTop: 2 },

  tabRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  tab: {
    paddingVertical: 10, paddingHorizontal: 20,
    borderWidth: 2.5, borderColor: T.ink,
    borderTopLeftRadius: 12, borderTopRightRadius: 10,
    borderBottomLeftRadius: 10, borderBottomRightRadius: 12,
    backgroundColor: T.paperDark,
  },
  tabActive: { backgroundColor: T.ink },
  tabText: { fontSize: 14, fontWeight: '700', color: T.inkMed },
  tabTextActive: { color: T.paper },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 12,
  },
  itemCard: {
    width: '30%',
    borderWidth: 2.5, borderColor: T.ink,
    borderBottomWidth: 5, borderRightWidth: 5,
    borderTopLeftRadius: 14, borderTopRightRadius: 12,
    borderBottomLeftRadius: 12, borderBottomRightRadius: 14,
    backgroundColor: T.paperDark, padding: 8,
    alignItems: 'center',
  },
  itemCardSelected: { backgroundColor: T.lavender },
  itemThumb: {
    width: '100%', aspectRatio: 1,
    borderRadius: 10, borderWidth: 1.5, borderColor: T.inkLight,
    backgroundColor: T.paper, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', marginBottom: 6,
  },
  itemImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  itemIcon: { fontSize: 28 },
  itemName: { fontSize: 12, fontWeight: '700', color: T.ink, textAlign: 'center' },
  equippedBadge: { fontSize: 10, fontWeight: '700', color: T.mintDark, marginTop: 2 },

  detailCard: { marginTop: 8, marginBottom: 10, padding: 16 },
  detailTitle: { fontSize: 18, fontWeight: '900', color: T.ink },
  detailDesc: { fontSize: 13, color: T.inkMed, marginTop: 6 },

  equipBtn: {
    marginTop: 12, backgroundColor: T.coral,
    borderWidth: 2.5, borderColor: T.ink,
    borderBottomWidth: 5, borderRightWidth: 5,
    borderTopLeftRadius: 12, borderTopRightRadius: 10,
    borderBottomLeftRadius: 10, borderBottomRightRadius: 12,
    paddingVertical: 11, alignItems: 'center',
  },
  equipBtnText: { fontSize: 15, fontWeight: '900', color: T.ink },

  unequipBtn: {
    marginTop: 12, backgroundColor: T.paperDark,
    borderWidth: 2.5, borderColor: T.coralDark,
    borderBottomWidth: 5, borderRightWidth: 5,
    borderTopLeftRadius: 12, borderTopRightRadius: 10,
    borderBottomLeftRadius: 10, borderBottomRightRadius: 12,
    paddingVertical: 11, alignItems: 'center',
  },
  unequipBtnText: { fontSize: 15, fontWeight: '900', color: T.coralDark },
});
