import { describe, expect, it } from 'vitest';
import { activityFromTxns, parseEventJsonLog, parseNearblocksTransactions } from './activity';

describe('activity parsing', () => {
  it('parses nested NEP-297 Sana Guard events', () => {
    const log =
      'EVENT_JSON:{"standard":"sana_guard","version":"1.0.0","event":{"event":"sign_requested","data":{"req_id":"ab","vault_id":0,"agent":"agent1.guard.djume.testnet"}}}';
    const item = parseEventJsonLog(log);
    expect(item?.kind).toBe('sign_requested');
    expect(item?.vaultId).toBe(0);
    expect(item?.reqId).toBe('ab');
  });

  it('parses panic logs that only contain an SG_E code', () => {
    const item = parseEventJsonLog('Smart contract panicked: SG_E067_RECIPIENT_NOT_ALLOWED');
    expect(item?.kind).toBe('failed_receipt');
    expect(item?.code).toBe('SG_E067_RECIPIENT_NOT_ALLOWED');
  });

  it('filters nearblocks txns by vault id', () => {
    const items = parseNearblocksTransactions(
      [
        {
          transaction_hash: 'tx1',
          block_timestamp: 1_700_000_000_000,
          logs: [
            'EVENT_JSON:{"event":{"event":"paused","data":{"vault_id":0}}}',
            'EVENT_JSON:{"event":{"event":"paused","data":{"vault_id":2}}}',
          ],
        },
      ],
      0
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.txHash).toBe('tx1');
    expect(items[0]?.vaultId).toBe(0);
  });

  it('marks an empty NearBlocks txn list as no history source', () => {
    expect(activityFromTxns([])).toEqual({
      items: [],
      source: 'nearblocks',
      degraded: true,
      reason: 'no history source',
    });
  });
});
