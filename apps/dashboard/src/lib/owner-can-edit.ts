/**
 * Owner-only write gating. Defaults closed: visitors and a session that is still
 * resolving never see edit forms, and the real owner is never labeled a visitor.
 */
export function ownerCanEdit(
  session: { ready: boolean; owner: string | null },
  vaultOwner: string
): boolean {
  return Boolean(session.ready && session.owner && session.owner === vaultOwner);
}
