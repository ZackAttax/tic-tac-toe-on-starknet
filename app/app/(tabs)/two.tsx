import React from 'react';
import { StyleSheet } from 'react-native';
import { Text, View } from '@/components/Themed';

export default function AboutScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>About this demo</Text>
      <Text style={styles.paragraph}>
        This is a simple Tic Tac Toe UI built for a Starknet workshop. The on-chain backend
        and matchmaking will be added later. For now, you can:
      </Text>
      <Text style={styles.list}>- Enter an opponent address</Text>
      <Text style={styles.list}>- Start a game and play locally on one device</Text>
      <Text style={styles.list}>- See winner detection and draw handling</Text>
      <Text style={[styles.paragraph, { marginTop: 16 }]}>
        Next steps will include creating a game on Starknet, submitting moves on-chain, and
        syncing state across devices.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  paragraph: {
    fontSize: 16,
    lineHeight: 22,
  },
  list: {
    fontSize: 16,
  },
});
