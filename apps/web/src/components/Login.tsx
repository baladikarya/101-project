import { useEffect, useState } from "react";
import { Cube } from "./icons";

const ERRORS: Record<string, string> = {
  state: "Sesi masuk kedaluwarsa. Tekan tombol masuk sekali lagi.",
  github: "GitHub tidak merespons. Coba lagi beberapa saat lagi.",
  forbidden: "Akun GitHub ini bukan pemilik aplikasi, jadi tidak bisa masuk.",
};

export function Login() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code) {
      setError(ERRORS[code] ?? "Gagal masuk. Coba lagi.");
      window.history.replaceState(null, "", "/");
    }
  }, []);

  return (
    <main className="mx-auto flex h-full max-w-sm flex-col justify-center px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <Cube className="h-14 w-14 text-accent" />
      <h1 className="mt-6 text-3xl font-bold tracking-tight">AI Virtual Office</h1>
      <p className="mt-2 text-muted">Masuk dengan akun GitHub pemilik untuk memantau tim agent.</p>
      {error && (
        <p role="alert" className="mt-5 rounded-lg border border-bad/40 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      <a
        href="/api/auth/github/login"
        className="mt-6 block rounded-xl bg-accent px-4 py-3 text-center font-semibold text-accent-ink"
      >
        Masuk dengan GitHub
      </a>
    </main>
  );
}
