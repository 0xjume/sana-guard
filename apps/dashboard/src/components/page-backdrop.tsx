export function PageBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      <div className="absolute left-1/2 top-[-18%] h-[560px] w-[920px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,hsl(var(--primary)/0.18),transparent)] blur-3xl" />
      <div className="absolute inset-0 opacity-[0.16] [background-image:radial-gradient(hsl(var(--foreground)/0.22)_1px,transparent_1px)] [background-size:22px_22px]" />
    </div>
  );
}
