import { useEffect } from "react";
import { Login } from "./components/Login";
import { Shell } from "./components/Shell";
import { useSession } from "./store";

export default function App() {
  const { status, load } = useSession();

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "loading") {
    return (
      <div className="grid h-full place-items-center text-muted" role="status">
        Memuat…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-xs">
          <p className="font-semibold">Server tidak terjangkau</p>
          <p className="mt-1 text-sm text-muted">Periksa koneksi internet, lalu coba lagi.</p>
          <button
            onClick={() => void load()}
            className="mt-4 rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink"
          >
            Coba lagi
          </button>
        </div>
      </div>
    );
  }
  return status === "authed" ? <Shell /> : <Login />;
}
