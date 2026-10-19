import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

// Lembar dari bawah layar: tutup lewat tombol, ketuk latar, atau Escape. Fokus dikembalikan saat ditutup.
export function BottomSheet({ title, onClose, children }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[75%] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-b-0 border-line bg-surface px-5 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold leading-tight">{title}</h2>
          <button ref={closeRef} onClick={onClose} className="shrink-0 rounded-lg border border-line px-3 py-1 text-sm">
            Tutup
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
