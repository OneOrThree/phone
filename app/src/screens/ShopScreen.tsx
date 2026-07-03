import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { useEquipment } from '@/store/EquipmentContext';
import { useCoins } from '@/store/CoinContext';
import { T } from '@/constants/legacyTheme';
import type { Variant, CostumeSlot } from '@/types/api';

type Rarity = 'Common' | 'Rare' | 'Epic' | 'Legendary';

const RARITY: Record<Rarity, { label: string; price: number; color: string }> = {
  Common: { label: 'Common', price: 1, color: T.inkLight },
  Rare: { label: 'Rare', price: 3, color: T.sky },
  Epic: { label: 'Epic', price: 5, color: T.lavender },
  Legendary: { label: 'Legendary', price: 10, color: T.yellow },
};

// 상점 아이템 카테고리
type ShopCategory = 'item' | 'furniture' | 'costume';

// 상점 아이템 공통 필드
// index signature는 ItemType/CostumeItem(컨텍스트 인자 타입)과 호환되도록 둔다.
interface ShopItemBase {
  id: string;
  name: string;
  icon: string;
  thumbnail: ImageSourcePropType | null;
  rarity: Rarity;
  desc: string;
  [key: string]: unknown;
}

// 집중 아이템 (집중 모드 variant 보유)
interface ShopFocusItem extends ShopItemBase {
  type: 'item';
  focusVariant: Variant;
}

// 코스튬 아이템 (착용 슬롯 보유)
interface ShopCostumeItem extends ShopItemBase {
  type: 'costume';
  slot: CostumeSlot;
}

// 가구 아이템
interface ShopFurnitureItem extends ShopItemBase {
  type: 'furniture';
}

type ShopItem = ShopFocusItem | ShopCostumeItem | ShopFurnitureItem;

const shopItems: Record<ShopCategory, ShopItem[]> = {
  item: [
    {
      id: '1',
      name: '데스크탑',
      type: 'item',
      icon: '🖥',
      thumbnail: require('../assets/itemThumbnail/Desktop.png'),
      focusVariant: 'focus',
      rarity: 'Rare',
      desc: '집중 모드에서 안경 쓰고 노트북 작업!',
    },
    {
      id: '2',
      name: '책',
      type: 'item',
      icon: '📚',
      thumbnail: null,
      focusVariant: 'reading',
      rarity: 'Common',
      desc: '독서하면서 집중! 책 읽는 포즈로 변신.',
    },
    {
      id: '3',
      name: '요가매트',
      type: 'item',
      icon: '🧘',
      thumbnail: null,
      focusVariant: 'yoga',
      rarity: 'Epic',
      desc: '요가하면서 마음도 집중! 평온한 표정.',
    },
    {
      id: '4',
      name: '운동기구',
      type: 'item',
      icon: '💪',
      thumbnail: null,
      focusVariant: 'exercise',
      rarity: 'Rare',
      desc: '운동하면서 집중! 덤벨 들고 파이팅!',
    },
    {
      id: '5',
      name: '문제집',
      type: 'item',
      icon: '✏',
      thumbnail: null,
      focusVariant: 'study',
      rarity: 'Common',
      desc: '문제집 풀면서 집중! 혀 내밀고 열심히.',
    },
  ],
  costume: [
    {
      id: '6',
      name: '베레모',
      type: 'costume',
      slot: 'hat',
      icon: '🎩',
      thumbnail: null,
      rarity: 'Rare',
      desc: '귀여운 베레모! 예술가 감성 물씬.',
    },
    {
      id: '7',
      name: '포니테일',
      type: 'costume',
      slot: 'hair',
      icon: '💇',
      thumbnail: null,
      rarity: 'Common',
      desc: '활기찬 포니테일 헤어스타일.',
    },
    {
      id: '8',
      name: '후드티',
      type: 'costume',
      slot: 'top',
      icon: '👕',
      thumbnail: null,
      rarity: 'Epic',
      desc: '편안한 후드티. 집중할 땐 역시 편한 옷!',
    },
    {
      id: '9',
      name: '청바지',
      type: 'costume',
      slot: 'bottom',
      icon: '👖',
      thumbnail: null,
      rarity: 'Common',
      desc: '클래식한 청바지. 어디든 잘 어울려요.',
    },
    {
      id: '10',
      name: '별 귀걸이',
      type: 'costume',
      slot: 'accessory',
      icon: '⭐',
      thumbnail: null,
      rarity: 'Legendary',
      desc: '반짝이는 별 귀걸이. 특별한 날 딱!',
    },
  ],
  furniture: [
    {
      id: '11',
      name: '책상',
      type: 'furniture',
      icon: '🖥',
      thumbnail: require('../assets/furnitureThumbnail/Desk.png'),
      rarity: 'Epic',
      desc: '방에 모니터 책상을 놓아요!',
    },
    {
      id: '12',
      name: '침대',
      type: 'furniture',
      icon: '🛏',
      thumbnail: null,
      rarity: 'Rare',
      desc: '푹신한 침대! 방이 아늑해져요.',
    },
    {
      id: '13',
      name: '창문',
      type: 'furniture',
      icon: '🪟',
      thumbnail: null,
      rarity: 'Common',
      desc: '햇살 들어오는 창문. 밝은 기분!',
    },
    {
      id: '14',
      name: '액자',
      type: 'furniture',
      icon: '🖼',
      thumbnail: null,
      rarity: 'Legendary',
      desc: '벽에 예쁜 그림을 걸어요.',
    },
    {
      id: '15',
      name: '카펫',
      type: 'furniture',
      icon: '🟥',
      thumbnail: null,
      rarity: 'Common',
      desc: '바닥에 포근한 카펫을 깔아요!',
    },
  ],
};

export default function ShopScreen() {
  const [selectedCategory, setSelectedCategory] = useState<ShopCategory>('item');
  const [selectedItem, setSelectedItem] = useState<ShopItem | null>(null);
  const {
    equippedItem,
    setEquippedItem,
    equippedFurniture,
    toggleFurniture,
    equippedCostume,
    toggleCostume,
  } = useEquipment();
  const { coins, isOwned, buyItem } = useCoins();
  const items = shopItems[selectedCategory];

  function handleSelectItem(item: ShopItem) {
    setSelectedItem(item);
  }

  function handleBuy() {
    if (!selectedItem) return;
    buyItem(selectedItem.id, RARITY[selectedItem.rarity].price);
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
        <View>
          <Text style={s.title}>상점 🛍</Text>
          <Text style={s.subtitle}>방을 꾸미고 캐릭터를 키워봐요</Text>
        </View>
        <View style={s.coinBadge}>
          <Text style={s.coinText}>💰 {coins}</Text>
        </View>
      </View>

      {/* Category tabs */}
      <View style={s.tabRow}>
        {(['item', 'furniture', 'costume'] as ShopCategory[]).map((cat) => (
          <Pressable
            key={cat}
            style={[s.tab, selectedCategory === cat && s.tabActive]}
            onPress={() => {
              setSelectedCategory(cat);
              setSelectedItem(null);
            }}
          >
            <Text style={[s.tabText, selectedCategory === cat && s.tabTextActive]}>
              {cat === 'item' ? '✦ 아이템' : cat === 'furniture' ? '🪑 가구' : '👕 의상'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Item grid */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.grid}>
        {items.map((item) => {
          const isSelected = selectedItem?.id === item.id;
          const isEquipped =
            item.type === 'furniture'
              ? equippedFurniture.some((f) => f.id === item.id)
              : item.type === 'costume'
                ? equippedCostume.some((c) => c.id === item.id)
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
              <Text style={[s.rarityBadge, { color: RARITY[item.rarity].color }]}>
                {item.rarity}
              </Text>
              {isEquipped ? (
                <Text style={s.equippedBadge}>✔ 장착중</Text>
              ) : isOwned(item.id) ? (
                <Text style={s.ownedBadge}>보유중</Text>
              ) : (
                <Text style={s.priceBadge}>💰 {RARITY[item.rarity].price}</Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Detail panel */}
      <View style={s.detailCard}>
        {selectedItem ? (
          <>
            <Text style={s.detailTitle}>
              {selectedItem.icon} {selectedItem.name}
            </Text>
            <Text style={[s.detailRarity, { color: RARITY[selectedItem.rarity].color }]}>
              ◆ {selectedItem.rarity}
            </Text>
            <Text style={s.detailDesc}>{selectedItem.desc}</Text>

            {!isOwned(selectedItem.id) ? (
              (() => {
                const price = RARITY[selectedItem.rarity].price;
                return (
                  <Pressable
                    style={[s.equipBtn, coins < price && s.disabledBtn]}
                    onPress={handleBuy}
                    disabled={coins < price}
                  >
                    <Text style={s.equipBtnText}>
                      {coins < price
                        ? `💰 부족 (${price - coins} 더 필요)`
                        : `💰 ${price} 구매하기`}
                    </Text>
                  </Pressable>
                );
              })()
            ) : selectedItem.type === 'furniture' ? (
              equippedFurniture.some((f) => f.id === selectedItem.id) ? (
                <Pressable style={s.unequipBtn} onPress={() => toggleFurniture(selectedItem)}>
                  <Text style={s.unequipBtnText}>장착 해제</Text>
                </Pressable>
              ) : (
                <Pressable style={s.equipBtn} onPress={() => toggleFurniture(selectedItem)}>
                  <Text style={s.equipBtnText}>장착하기 ✓</Text>
                </Pressable>
              )
            ) : selectedItem.type === 'costume' ? (
              equippedCostume.some((c) => c.id === selectedItem.id) ? (
                <Pressable style={s.unequipBtn} onPress={() => toggleCostume(selectedItem)}>
                  <Text style={s.unequipBtnText}>장착 해제</Text>
                </Pressable>
              ) : (
                <Pressable style={s.equipBtn} onPress={() => toggleCostume(selectedItem)}>
                  <Text style={s.equipBtnText}>장착하기 ✓</Text>
                </Pressable>
              )
            ) : equippedItem?.id === selectedItem.id ? (
              <Pressable style={s.unequipBtn} onPress={handleUnequip}>
                <Text style={s.unequipBtnText}>장착 해제</Text>
              </Pressable>
            ) : (
              <Pressable style={s.equipBtn} onPress={handleEquip}>
                <Text style={s.equipBtnText}>장착하기 ✓</Text>
              </Pressable>
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
    flex: 1,
    backgroundColor: T.paper,
    paddingTop: 56,
    paddingHorizontal: 18,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 28, fontWeight: '900', color: T.ink },
  subtitle: { fontSize: 13, color: T.inkMed, marginTop: 2 },
  coinBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1.5,
    borderColor: T.inkLight,
    borderRadius: 6,
  },
  coinText: { fontSize: 15, fontWeight: '700', color: T.ink },

  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: T.ink },
  tabText: { fontSize: 14, fontWeight: '600', color: T.inkLight },
  tabTextActive: { color: T.ink, fontWeight: '700' },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: 12,
  },
  itemCard: {
    width: '30%',
    borderWidth: 1.5,
    borderColor: T.inkLight,
    borderRadius: 8,
    backgroundColor: T.paper,
    padding: 8,
    alignItems: 'center',
  },
  itemCardSelected: { borderColor: T.ink, borderWidth: 2 },
  itemThumb: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: T.paperLine,
    backgroundColor: T.paperDark,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 6,
  },
  itemImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  itemIcon: { fontSize: 28 },
  itemName: { fontSize: 12, fontWeight: '600', color: T.ink, textAlign: 'center' },
  rarityBadge: { fontSize: 9, fontWeight: '700', marginTop: 2 },
  equippedBadge: { fontSize: 10, fontWeight: '700', color: T.inkMed, marginTop: 2 },
  ownedBadge: { fontSize: 10, fontWeight: '600', color: T.inkMed, marginTop: 2 },
  priceBadge: { fontSize: 10, fontWeight: '600', color: T.inkMed, marginTop: 2 },

  detailCard: {
    marginTop: 8,
    marginBottom: 10,
    padding: 16,
    borderWidth: 1.5,
    borderColor: T.inkLight,
    borderRadius: 8,
  },
  detailTitle: { fontSize: 17, fontWeight: '800', color: T.ink },
  detailRarity: { fontSize: 12, fontWeight: '700', marginTop: 4, color: T.inkMed },
  detailDesc: { fontSize: 13, color: T.inkMed, marginTop: 4 },

  equipBtn: {
    marginTop: 12,
    backgroundColor: T.ink,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  equipBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },

  unequipBtn: {
    marginTop: 12,
    borderWidth: 1.5,
    borderColor: T.ink,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  unequipBtnText: { fontSize: 14, fontWeight: '700', color: T.ink },
  disabledBtn: { backgroundColor: T.inkLight },
});
