import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
} from 'react-native';

import { useEquipment } from '../contexts/EquipmentContext';

const shopItems = {
  item: [
    {
      id: 'desktop',
      name: 'Desktop',
      type: 'item',
      model: require('../assets/item/Desktop.glb'),
      thumbnail: require('../assets/itemThumbnail/Desktop.png'),
    },
    {
      id: 'item-empty-1',
      name: '준비 중',
      type: 'item',
      model: null,
      thumbnail: null,
    },
    {
      id: 'item-empty-2',
      name: '준비 중',
      type: 'item',
      model: null,
      thumbnail: null,
    },
    {
      id: 'item-empty-3',
      name: '준비 중',
      type: 'item',
      model: null,
      thumbnail: null,
    },
  ],
  furniture: [
    {
      id: 'desk',
      name: 'Desk',
      type: 'furniture',
      model: require('../assets/furniture/Desk.glb'),
      thumbnail: require('../assets/furnitureThumbnail/Desk.png'),
    },
    {
      id: 'furniture-empty-1',
      name: '준비 중',
      type: 'furniture',
      model: null,
      thumbnail: null,
    },
    {
      id: 'furniture-empty-2',
      name: '준비 중',
      type: 'furniture',
      model: null,
      thumbnail: null,
    },
    {
      id: 'furniture-empty-3',
      name: '준비 중',
      type: 'furniture',
      model: null,
      thumbnail: null,
    },
  ],
};

export default function ShopScreen() {
  const [selectedCategory, setSelectedCategory] = useState('item');
  const [selectedItem, setSelectedItem] = useState(null);

  const { equippedItem, setEquippedItem } = useEquipment();

  const items = shopItems[selectedCategory];

  function handleSelectItem(item) {
    if (!item.model) return;
    setSelectedItem(item);
  }

  function handleEquip() {
    if (!selectedItem || !selectedItem.model) return;
    setEquippedItem(selectedItem);
  }

  function handleUnequip() {
    setEquippedItem(null);
    setSelectedItem(null);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>상점</Text>

      <View style={styles.categoryRow}>
        <Pressable
          style={[
            styles.categoryButton,
            selectedCategory === 'item' && styles.categoryButtonActive,
          ]}
          onPress={() => {
            setSelectedCategory('item');
            setSelectedItem(null);
          }}
        >
          <Text
            style={[
              styles.categoryText,
              selectedCategory === 'item' && styles.categoryTextActive,
            ]}
          >
            아이템
          </Text>
        </Pressable>

        <Pressable
          style={[
            styles.categoryButton,
            selectedCategory === 'furniture' && styles.categoryButtonActive,
          ]}
          onPress={() => {
            setSelectedCategory('furniture');
            setSelectedItem(null);
          }}
        >
          <Text
            style={[
              styles.categoryText,
              selectedCategory === 'furniture' && styles.categoryTextActive,
            ]}
          >
            가구
          </Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>
        {selectedCategory === 'item' ? '아이템 목록' : '가구 목록'}
      </Text>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.itemScroll}
      >
        {items.map((item) => {
          const isSelected = selectedItem?.id === item.id;
          const isEquipped = equippedItem?.id === item.id;

          return (
            <Pressable
              key={item.id}
              style={[
                styles.itemCard,
                isSelected && styles.itemCardSelected,
                !item.model && styles.itemCardDisabled,
              ]}
              onPress={() => handleSelectItem(item)}
            >
              <View style={styles.itemPreview}>
                {item.thumbnail ? (
                  <Image source={item.thumbnail} style={styles.itemImage} />
                ) : (
                  <Text style={styles.itemPreviewText}>
                    {item.model ? 'GLB' : '+'}
                  </Text>
                )}
              </View>

              <Text style={styles.itemName}>{item.name}</Text>
              {isEquipped && (
                <Text style={styles.equippedText}>장착 중</Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.detailBox}>
        {selectedItem ? (
          <>
            <Text style={styles.detailTitle}>{selectedItem.name}</Text>
            <Text style={styles.detailText}>
              홈 화면에 배치할 수 있는 아이템입니다.
            </Text>

            {equippedItem?.id === selectedItem.id ? (
              <Pressable style={styles.unequipButton} onPress={handleUnequip}>
                <Text style={styles.unequipButtonText}>장착 해제하기</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.equipButton} onPress={handleEquip}>
                <Text style={styles.equipButtonText}>장착하기</Text>
              </Pressable>
            )}
          </>
        ) : (
          <>
            <Text style={styles.detailTitle}>아이템을 선택하세요</Text>
            <Text style={styles.detailText}>
              아이템을 누르면 장착하기 버튼이 표시됩니다.
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    paddingTop: 64,
    paddingHorizontal: 20,
  },
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
  },
  categoryRow: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 12,
  },
  categoryButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: '#2a2a2a',
  },
  categoryButtonActive: {
    backgroundColor: '#ffffff',
  },
  categoryText: {
    color: '#aaaaaa',
    fontSize: 14,
    fontWeight: '600',
  },
  categoryTextActive: {
    color: '#111111',
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 28,
  },
  itemScroll: {
    paddingVertical: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  itemCard: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 18,
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  itemCardSelected: {
    borderColor: '#ffffff',
  },
  itemCardDisabled: {
    opacity: 0.45,
  },
  itemPreview: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#3a3a3a',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  itemImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  itemPreviewText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  itemName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 10,
  },
  equippedText: {
    color: '#7CFF8A',
    fontSize: 12,
    marginTop: 4,
  },
  detailBox: {
    marginTop: 20,
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#242424',
  },
  detailTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  detailText: {
    color: '#aaaaaa',
    fontSize: 14,
    marginTop: 8,
  },
  equipButton: {
    marginTop: 18,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  equipButtonText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '700',
  },
  unequipButton: {
    marginTop: 18,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#ff6b6b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unequipButtonText: {
    color: '#ff6b6b',
    fontSize: 15,
    fontWeight: '700',
  },
});