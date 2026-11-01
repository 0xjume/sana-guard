export function StatusBadge({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'danger' | 'muted';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'ok'
      ? 'badge-ok'
      : tone === 'warn'
        ? 'badge-warn'
        : tone === 'danger'
          ? 'badge-danger'
          : 'badge-muted';
  return <span className={cls}>{children}</span>;
}
