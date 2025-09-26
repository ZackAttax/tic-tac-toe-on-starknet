import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet } from 'react-native';
import { Text, View } from '@/components/Themed';
import { useCavos } from '@/app/context/CavosConnector';
import { SignInWithGoogle } from 'cavos-service-native';

export default function AccountGate() {
  const { wallet, hasExternalWallet, deployExternalWallet, orgSecret, login, network, address } = useCavos();

  const [error, setError] = useState<string | null>(null);

  // Cavos demo external deploy path (org secret in client for demo only)
  const [deployingCavos, setDeployingCavos] = useState(false);

  async function handleCavosDeploy() {
    if (__DEV__) console.log('[UI] Cavos Deploy clicked', { orgSecretPresent: !!orgSecret });
    setError(null);
    setDeployingCavos(true);
    try {
      const res = await deployExternalWallet();
      if (__DEV__) console.log('[UI] Cavos Deploy result', res);
      if ((res as any)?.error) setError((res as any).error);
    } catch (e: any) {
      if (__DEV__) console.error('[UI] Cavos Deploy exception', e?.message || e);
      setError(typeof e?.message === 'string' ? e.message : String(e));
    } finally {
      setDeployingCavos(false);
    }
  }

  if (wallet || hasExternalWallet) {
    if (__DEV__) console.log('[UI] AccountGate hidden', { hasWallet: !!wallet, hasExternalWallet });
    return null;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Create a Starknet account</Text>
        <Text style={styles.subtitle}>Demo options below. Org secret detected: {orgSecret ? 'Yes' : 'No'}</Text>
        {__DEV__ && (
          <Text style={styles.subtitle}>Debug: hasWallet={String(!!wallet)} hasExternal={String(hasExternalWallet)} addr={address}</Text>
        )}

        {/* Google Sign In via Cavos SDK */}
        <SignInWithGoogle
          appId={process.env.EXPO_PUBLIC_CAVOS_APP_ID || ''}
          network={(network || 'sepolia') as any}
          finalRedirectUri={process.env.EXPO_PUBLIC_CAVOS_REDIRECT_URI || 'app://callback'}
          onSuccess={(w: any) => {
            if (__DEV__) console.log('[UI] Google login success', { address: w?.address, network: w?.network });
            try { login(w); } catch {}
          }}
          onError={(e: any) => {
            const msg = e?.message || String(e);
            if (__DEV__) console.error('[UI] Google login error', msg);
            setError(msg);
          }}
        >
          <Text style={styles.primaryText}>Sign in with Google</Text>
        </SignInWithGoogle>

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        {orgSecret && (
        <Pressable
          accessibilityRole="button"
          onPress={handleCavosDeploy}
          disabled={deployingCavos}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: '#34c759', opacity: deployingCavos ? 0.6 : pressed ? 0.8 : 1 },
          ]}
        >
          {deployingCavos ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>Deploy with Cavos (demo)</Text>
          )}
        </Pressable>
        )}
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


