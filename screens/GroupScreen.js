import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function GroupScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>그룹</Text>
      <Text style={styles.text}>그룹 화면입니다.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
  },
  text: {
    color: '#aaaaaa',
    fontSize: 16,
    marginTop: 12,
  },
});