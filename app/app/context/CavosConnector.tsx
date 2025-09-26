import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CavosWallet } from "cavos-service-native";

type CavosContextType = {
  wallet: CavosWallet | null;
  isAuthenticated: boolean;
  network: string;
  address: string | null;
  login: (wallet: CavosWallet) => void;
  signOut: () => void;
  // Demo external (org-secret) flow
  orgSecret: string | null;
  externalAddress: string | null;
  externalHashedPk: string | null;
  hasExternalWallet: boolean;
  deployExternalWallet: (auth0Uid?: string) => Promise<{ address: string } | null>;
  executeExternalCalls: (calls: any[]) => Promise<string | { error: string }>;
};

const CavosContext = createContext<CavosContextType | undefined>(undefined);

export const useCavos = () => {
  const ctx = useContext(CavosContext);
  if (!ctx) throw new Error("useCavos must be used within CavosConnectorProvider");
  return ctx;
};

export const CavosConnectorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [wallet, setWallet] = useState<CavosWallet | null>(null);
  const [externalAddress, setExternalAddress] = useState<string | null>(null);
  const [externalHashedPk, setExternalHashedPk] = useState<string | null>(null);

  const network = useMemo(
    () => process.env.EXPO_PUBLIC_DEFAULT_NETWORK || "sepolia",
    [],
  );

  const orgSecret = useMemo(() => process.env.EXPO_PUBLIC_CAVOS_ORG_SECRET || null, []);

  const login = useCallback((w: CavosWallet) => {
    if (__DEV__) console.log('[Cavos] login()', { hasWallet: !!w, address: (w as any)?.address });
    setWallet(w);
  }, []);

  const signOut = useCallback(() => {
    if (__DEV__) console.log('[Cavos] signOut()');
    setWallet(null);
    setExternalAddress(null);
    setExternalHashedPk(null);
  }, []);

  const isAuthenticated = !!wallet;
  // Consider the external wallet present as soon as we have an address (hashed pk may be delivered separately)
  const hasExternalWallet = !!externalAddress;

  // Normalize wallet address across SDK versions
  const normalizedAddress = useMemo(() => {
    try {
      const direct = (wallet as any)?.address;
      if (direct && typeof direct === 'string') return direct;
      const info = (wallet as any)?.getWalletInfo?.();
      const infoAddr = info?.address || info?.wallet?.address;
      if (infoAddr && typeof infoAddr === 'string') return infoAddr;
      const nested = (wallet as any)?.wallet?.address;
      if (nested && typeof nested === 'string') return nested;
    } catch {}
    return null;
  }, [wallet]);

  const deployExternalWallet = useCallback(async (auth0Uid?: string) => {
    if (!orgSecret) {
      if (__DEV__) console.warn('[Cavos] deployExternalWallet: missing orgSecret');
      return { address: "" } as any;
    }
    try {
      if (__DEV__) console.log('[Cavos] POST /external/deploy', { network, hasAuth0: !!auth0Uid });
      const res = await fetch("https://services.cavos.xyz/api/v1/external/deploy", {
        method: "POST",
        headers: {
          // Per docs, both formats are accepted; send both for safety
          Authorization: `Bearer ${orgSecret}`,
          "X-Org-Token": orgSecret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // Per docs, prefer snake_case keys
          network: "sepolia",
          ...(auth0Uid ? { auth0_uid: auth0Uid } : {}),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        if (__DEV__) console.error('[Cavos] deployExternalWallet failed', res.status, text);
        return { address: "", error: `Deploy failed: ${res.status} ${text}` } as any;
      }
      const text = await res.text();
      console.log('text', text);
      let data: any;
      try { data = JSON.parse(text); } catch { data = text; }
      console.log('data', data);
      // Normalize common envelope shapes: { success, data: {...} } or { result: {...} }
      const envelope = (typeof data === 'object' && data) ? (data.data || data.result || data) : {};
      const addr = envelope?.address || envelope?.wallet?.address || null;
      const hashed = envelope?.private_key
        || envelope?.encrypted_private_key_data
        || envelope?.hashedPk
        || envelope?.hashed_pk
        || envelope?.wallet?.hashedPk
        || null;
      setExternalAddress(addr);
      setExternalHashedPk(hashed);
      if (__DEV__) console.log('[Cavos] deployExternalWallet success', { addr: addr?.slice?.(0,10), hasHashed: !!hashed });
      return addr ? { address: addr } : null;
    } catch (e: any) {
      if (__DEV__) console.error('[Cavos] deployExternalWallet exception', e?.message || e);
      return { address: "", error: e?.message || String(e) } as any;
    }
  }, [orgSecret, network]);

  const executeExternalCalls = useCallback(async (calls: any[]) => {
    if (!orgSecret || !externalAddress || !externalHashedPk) {
      if (__DEV__) console.warn('[Cavos] executeExternalCalls: missing state', { hasOrg: !!orgSecret, hasAddr: !!externalAddress, hasHashed: !!externalHashedPk });
      return { error: "External wallet not initialized" };
    }
    try {
      if (__DEV__) console.log('[Cavos] POST /external/execute', { callsCount: calls?.length ?? 0 });
      const res = await fetch("https://services.cavos.xyz/api/v1/external/execute", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${orgSecret}`,
          "X-Org-Token": orgSecret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // Per docs use snake_case params
          address: externalAddress,
          hashed_pk: externalHashedPk,
          calls,
          network: network === "mainnet" ? "mainnet" : "sepolia",
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        if (__DEV__) console.error('[Cavos] executeExternalCalls failed', res.status, text);
        return { error: `Execute failed: ${res.status} ${text}` };
      }
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      console.log('parsed', parsed);
      const txHash =
        parsed?.result?.transactionHash ||
        parsed?.result?.transaction_hash ||
        parsed?.transactionHash ||
        parsed?.txHash ||
        parsed?.data?.transactionHash ||
        parsed?.result?.result?.transactionHash ||
        null;
      if (__DEV__) console.log('[Cavos] executeExternalCalls success', { txHash });
      return txHash || { error: "No transaction hash in response" };
    } catch (e: any) {
      if (__DEV__) console.error('[Cavos] executeExternalCalls exception', e?.message || e);
      return { error: e?.message || String(e) };
    }
  }, [orgSecret, externalAddress, externalHashedPk, network]);

  const value = {
    wallet,
    isAuthenticated,
    network,
    address: normalizedAddress,
    login,
    signOut,
    orgSecret,
    externalAddress,
    externalHashedPk,
    hasExternalWallet,
    deployExternalWallet,
    executeExternalCalls,
  };

  return <CavosContext.Provider value={value}>{children}</CavosContext.Provider>;
};


