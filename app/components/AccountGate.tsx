import React, { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput } from 'react-native';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { Text, View } from '@/components/Themed';
import { useStarknetConnector } from '@/app/context/StarknetConnector';
import { useFocEngine } from '@/app/context/FocEngineConnector';

export default function AccountGate() {
  const colorScheme = useColorScheme() ?? 'light';
  const tint = Colors[colorScheme].tint;

  const {
    STARKNET_ENABLED,
    network,
    account,
    generatePrivateKey, 
    deployAccount,
    storeKeyAndConnect,
  } = useStarknetConnector();

  const {
    initializeAccount,
    isUserInitializing,
    isUsernameValid,
    usernameValidationError,
  } = useFocEngine();

  const [username, setUsername] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsUsername = STARKNET_ENABLED && network !== 'SN_DEVNET';
  const isUsernameOk = useMemo(() => {
    if (!needsUsername) return true;
    if (username.trim().length === 0) return false;
    return isUsernameValid(username.trim());
  }, [needsUsername, username, isUsernameValid]);

  async function handleCreate() {
    setError(null);
    setCreating(true);
    try {
      const pk = generatePrivateKey();
      if (!pk) {
        throw new Error('Could not generate private key');
      }

      if (!STARKNET_ENABLED || network === 'SN_DEVNET') {
        await deployAccount(pk);
        // Persist key for reuse across sessions
        await storeKeyAndConnect(pk, 'tic_tac_toe');
      } else {
        const finalUsername = username.trim().length
          ? username.trim()
          : `player_${Math.random().toString(36).slice(2, 8)}`;
        // Will deploy (via paymaster) and connect/store the key internally
        await initializeAccount(finalUsername, [], undefined, pk, 2);
      }
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : String(e);
      setError(msg);
    } finally {
      setCreating(false);
    }
  }

  if (account) {
    return null;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Create your Starknet account</Text>
        <Text style={styles.subtitle}>You need an account to start a game.</Text>

        {needsUsername && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Choose a username</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="e.g. player_123"
              placeholderTextColor={Platform.select({ ios: '#999', android: '#999' })}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.input,
                {
                  borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
                  color: Colors[colorScheme].text,
                  backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
                },
              ]}
            />
            {!isUsernameOk && (
              <Text style={styles.validationText}>{usernameValidationError}</Text>
            )}
          </View>
        )}

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable
          accessibilityRole="button"
          onPress={handleCreate}
          disabled={creating || isUserInitializing || !isUsernameOk}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: tint, opacity: creating || isUserInitializing || !isUsernameOk ? 0.6 : pressed ? 0.8 : 1 },
          ]}
        >
          {creating || isUserInitializing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>Create Account</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    gap: 14,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.8,
    textAlign: 'center',
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    opacity: 0.8,
  },
  input: {
    height: 44,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  validationText: {
    fontSize: 12,
    color: '#c0392b',
  },
  errorText: {
    fontSize: 13,
    color: '#c0392b',
    textAlign: 'center',
  },
  primaryButton: {
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});


