import { PublicKey, Connection, SendOptions } from '@solana/web3.js';
import { Contract, Account as NearAccount } from 'near-api-js';
import { RequestSignParams, BroadcastResult, TransferParams } from './types';
import { SanaGuardError, createSanaGuardError } from './errors';
import { buildSolTransfer, buildTokenTransfer, verifyMessageSignature, assembleSignedTransaction, assertNotV1Message } from './messages';
import crypto from 'crypto';

/**
 * Sana Guard Agent Client
 * 
 * Handles request_sign calls with agent function-call key,
 * signature verification, and transaction broadcast.
 */
export class AgentClient {
  constructor(
    private readonly solanaConnection: Connection,
    private readonly nearAccount: NearAccount,
    private readonly guardContract: string,
    private readonly vaultAddress: PublicKey
  ) {}

  /**
   * Request MPC signature for a Solana message
   * 
   * @param params - Request parameters
   * @param gasAttached - Gas to attach (default 95 Tgas)
   * @returns Ed25519 signature (64 bytes)
   */
  async requestSign(
    params: RequestSignParams,
    gasAttached: string = '95000000000000'
  ): Promise<Uint8Array> {
    const { vaultId, message, idempotencyKey } = params;

    // Enforce no v1 (0x81) messages
    assertNotV1Message(message);

    // Generate idempotency key if not provided
    const reqId = idempotencyKey || crypto.randomBytes(32).toString('hex');

    // Base64-encode the message
    const messageB64 = Buffer.from(message).toString('base64');

    // Call request_sign
    const contract = new Contract(this.nearAccount, this.guardContract, {
      viewMethods: [],
      changeMethods: ['request_sign'],
      useLocalViewExecution: false,
    }) as any;

    let result: number[];
    try {
      result = await contract.request_sign(
        {
          vault_id: vaultId,
          message_b64: messageB64,
          req_id_hex: reqId,
        },
        gasAttached,
        '0' // 0 deposit
      );
    } catch (error: any) {
      // Parse error from NEAR contract
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      throw createSanaGuardError(errorMessage);
    }

    // Extract signature from result (it's a 64-byte array)
    if (!result || !Array.isArray(result) || result.length !== 64) {
      throw new SanaGuardError('Invalid MPC signature format');
    }

    const signature = new Uint8Array(result);

    // Verify signature locally before broadcasting
    const isValid = await verifyMessageSignature(signature, message, this.vaultAddress);
    if (!isValid) {
      throw new SanaGuardError('Signature verification failed');
    }

    return signature;
  }

  /**
   * Request signature and broadcast immediately
   * 
   * Uses a CONFIRMED blockhash to avoid expiry during MPC signing.
   * 
   * @param params - Request parameters
   * @param gasAttached - Gas to attach (default 95 Tgas)
   * @param sendOptions - Solana send options
   * @returns Broadcast result with signature and explorer link
   */
  async requestSignAndBroadcast(
    params: RequestSignParams,
    gasAttached: string = '95000000000000',
    sendOptions: SendOptions = { skipPreflight: false, preflightCommitment: 'confirmed' },
    finalityLevel: 'confirmed' | 'finalized' = 'confirmed'
  ): Promise<BroadcastResult> {
    const signature = await this.requestSign(params, gasAttached);

    // Assemble signed transaction
    const signedTx = assembleSignedTransaction(signature, params.message);

    // Get blockhash info for confirmation
    const { blockhash, lastValidBlockHeight } = await this.solanaConnection.getLatestBlockhash('confirmed');

    // Broadcast
    const txSignature = await this.solanaConnection.sendRawTransaction(
      signedTx,
      sendOptions
    );

    // Wait for confirmation
    const confirmation = await this.solanaConnection.confirmTransaction(
      { signature: txSignature, blockhash, lastValidBlockHeight },
      finalityLevel
    );

    const network = this.solanaConnection.rpcEndpoint.includes('devnet')
      ? 'devnet'
      : this.solanaConnection.rpcEndpoint.includes('testnet')
      ? 'testnet'
      : 'mainnet-beta';

    return {
      signature: txSignature,
      explorer: `https://explorer.solana.com/tx/${txSignature}?cluster=${network}`,
      status: confirmation.value.err ? 'failed' : finalityLevel,
      err: confirmation.value.err || undefined,
    };
  }

  /**
   * High-level transfer helper
   * 
   * Builds the message, fetches a CONFIRMED blockhash, requests signature, and broadcasts.
   * 
   * @param vaultId - Vault ID
   * @param params - Transfer parameters (lamports OR token)
   * @param options - Optional compute budget and version
   * @returns Broadcast result
   */
  async transfer(
    vaultId: number,
    params: TransferParams,
    options: {
      computeUnitLimit?: number;
      computeUnitPrice?: bigint;
      version?: 'legacy' | 'v0';
    } = {}
  ): Promise<BroadcastResult> {
    const { version = 'v0', computeUnitLimit, computeUnitPrice } = options;

    // Get CONFIRMED blockhash
    const { blockhash } = await this.solanaConnection.getLatestBlockhash('confirmed');

    let message: Uint8Array;

    if (params.lamports !== undefined) {
      // SOL transfer
      message = buildSolTransfer(
        this.vaultAddress,
        params.to,
        params.lamports,
        blockhash,
        { version, computeUnitLimit, computeUnitPrice }
      );
    } else if (params.token) {
      // SPL token transfer
      // Derive token accounts (simple derivation; caller should provide if custom)
      const { getAssociatedTokenAddress } = await import('@solana/spl-token');
      const fromTokenAccount = await getAssociatedTokenAddress(
        params.token.mint,
        this.vaultAddress
      );
      const toTokenAccount = await getAssociatedTokenAddress(
        params.token.mint,
        params.to
      );

      message = buildTokenTransfer(
        this.vaultAddress,
        params.to,
        params.token.mint,
        params.token.amount,
        params.token.decimals,
        fromTokenAccount,
        toTokenAccount,
        blockhash,
        { version, computeUnitLimit, computeUnitPrice, createAta: false }
      );
    } else {
      throw new SanaGuardError('Either lamports or token must be provided');
    }

    return this.requestSignAndBroadcast({ vaultId, message });
  }
}
