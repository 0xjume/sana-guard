export type NearNetwork = 'testnet' | 'mainnet';

export interface PublicDashboardConfig {
  privyAppId: string | null;
  privyClientId: string | null;
  nearNetwork: NearNetwork;
  guardContract: string;
  nearRpcUrl: string;
  mpcContract: string;
  mpcDomainId: number;
  relayUrl: string;
  solanaRpcUrl: string;
  configError: string | null;
}

function trim(value: string | undefined): string | null {
  const next = value?.trim();
  return next ? next : null;
}

export function loadPublicConfig(env: NodeJS.ProcessEnv = process.env): PublicDashboardConfig {
  const requested = trim(env.NEXT_PUBLIC_NEAR_NETWORK) ?? 'testnet';
  const nearNetwork: NearNetwork = requested === 'mainnet' ? 'mainnet' : 'testnet';
  const guardContract = trim(env.NEXT_PUBLIC_GUARD_CONTRACT);
  const nearRpcUrl = trim(env.NEXT_PUBLIC_NEAR_RPC);

  let configError: string | null = null;
  if (nearNetwork === 'mainnet' && (!guardContract || !nearRpcUrl)) {
    configError =
      'Mainnet requires NEXT_PUBLIC_GUARD_CONTRACT and NEXT_PUBLIC_NEAR_RPC. Testnet defaults are not used.';
  }

  return {
    privyAppId: trim(env.NEXT_PUBLIC_PRIVY_APP_ID),
    privyClientId: trim(env.NEXT_PUBLIC_PRIVY_CLIENT_ID),
    nearNetwork,
    guardContract: guardContract ?? (nearNetwork === 'mainnet' ? '' : 'guard.djume.testnet'),
    nearRpcUrl: nearRpcUrl ?? (nearNetwork === 'mainnet' ? '' : 'https://rpc.testnet.near.org'),
    mpcContract: trim(env.NEXT_PUBLIC_MPC_CONTRACT) ?? 'v1.signer-prod.testnet',
    mpcDomainId: Number(trim(env.NEXT_PUBLIC_MPC_DOMAIN_ID) ?? '1'),
    relayUrl: trim(env.NEXT_PUBLIC_RELAY_URL) ?? 'https://relay-production-665a.up.railway.app',
    solanaRpcUrl: trim(env.NEXT_PUBLIC_SOLANA_RPC) ?? 'https://api.devnet.solana.com',
    configError,
  };
}

export function adminNetworkTag(network: NearNetwork): string {
  return `near-${network}`;
}

export function nearExplorerTxUrl(network: NearNetwork, txHash: string): string {
  const prefix = network === 'mainnet' ? '' : 'testnet.';
  return `https://${prefix}nearblocks.io/txns/${txHash}`;
}

export function solanaExplorerAddressUrl(rpcUrl: string, address: string): string {
  const cluster = rpcUrl.includes('mainnet')
    ? 'mainnet-beta'
    : rpcUrl.includes('testnet')
      ? 'testnet'
      : 'devnet';
  return `https://explorer.solana.com/address/${address}?cluster=${cluster}`;
}

export const publicConfig = loadPublicConfig();
