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
  defaultInviteToken: string | null;
}

function trim(value: string | undefined): string | null {
  const next = value?.trim();
  return next ? next : null;
}

export function loadPublicConfig(): PublicDashboardConfig {
  const nearNetwork = (trim(process.env.NEXT_PUBLIC_NEAR_NETWORK) ?? 'testnet') as NearNetwork;
  return {
    privyAppId: trim(process.env.NEXT_PUBLIC_PRIVY_APP_ID),
    privyClientId: trim(process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID),
    nearNetwork: nearNetwork === 'mainnet' ? 'mainnet' : 'testnet',
    guardContract: trim(process.env.NEXT_PUBLIC_GUARD_CONTRACT) ?? 'guard.djume.testnet',
    nearRpcUrl: trim(process.env.NEXT_PUBLIC_NEAR_RPC) ?? 'https://rpc.testnet.near.org',
    mpcContract: trim(process.env.NEXT_PUBLIC_MPC_CONTRACT) ?? 'v1.signer-prod.testnet',
    mpcDomainId: Number(trim(process.env.NEXT_PUBLIC_MPC_DOMAIN_ID) ?? '1'),
    relayUrl:
      trim(process.env.NEXT_PUBLIC_RELAY_URL) ?? 'https://relay-production-665a.up.railway.app',
    solanaRpcUrl: trim(process.env.NEXT_PUBLIC_SOLANA_RPC) ?? 'https://api.devnet.solana.com',
    defaultInviteToken: trim(process.env.NEXT_PUBLIC_INVITE_TOKEN),
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
