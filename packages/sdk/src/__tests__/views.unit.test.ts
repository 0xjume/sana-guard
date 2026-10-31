import { Account as NearAccount } from 'near-api-js';
import { Views } from '../views';

describe('Views', () => {
  it('calls account.viewFunction and does not construct near-api-js Contract', async () => {
    const viewFunction = jest.fn().mockResolvedValue(null);
    const views = new Views({ viewFunction } as unknown as NearAccount, 'guard.djume.testnet');
    await expect(views.getVault(0)).resolves.toBeNull();
    expect(viewFunction).toHaveBeenCalledWith({
      contractId: 'guard.djume.testnet',
      methodName: 'get_vault',
      args: { vault_id: 0 },
    });
  });
});
