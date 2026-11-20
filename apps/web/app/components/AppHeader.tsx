"use client";

/** The same top bar on every screen: title on the left, Recent / Clover / + New on the right. */
export default function AppHeader({ active, onRecent, onNew }: {
  active: "estimate" | "recent" | "clover"; onRecent?: () => void; onNew?: () => void;
}) {
  const item = (on: boolean) => `text-sm font-medium ${on ? "text-green-800 underline underline-offset-4" : "text-neutral-600"}`;
  return (
    <header className="relative z-30 flex h-[53px] items-center justify-between border-b border-neutral-200 bg-white px-4">
      <h1 className="text-lg font-semibold">Estimates</h1>
      <nav className="flex gap-4">
        {onRecent ? <button onClick={onRecent} className={item(active === "recent")}>Recent</button> : <a href="/?recent=1" className={item(false)}>Recent</a>}
        <a href="/clover" className={item(active === "clover")}>Clover</a>
        {onNew ? <button onClick={onNew} className="text-sm font-semibold text-green-800">+ New</button> : <a href="/" className="text-sm font-semibold text-green-800">+ New</a>}
      </nav>
    </header>
  );
}
