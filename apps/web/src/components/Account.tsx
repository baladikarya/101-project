import { useSession } from "../store";

export function Account() {
  const { me, logout } = useSession();
  if (!me) return null;

  return (
    <div className="space-y-5">
      <section className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4">
        {me.avatarUrl ? (
          <img src={me.avatarUrl} alt="" className="h-12 w-12 rounded-full" width={48} height={48} />
        ) : (
          <span className="h-12 w-12 rounded-full bg-line" aria-hidden="true" />
        )}
        <div>
          <p className="font-semibold">{me.login}</p>
          <p className="text-sm text-muted">Pemilik aplikasi</p>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="font-semibold">Pasang di layar utama</h2>
        <p className="mt-1 text-sm text-muted">
          Android (Chrome): buka menu ⋮ lalu pilih Pasang aplikasi. iPhone (Safari): tekan Bagikan lalu pilih
          Tambah ke Layar Utama.
        </p>
      </section>

      <button
        onClick={() => void logout()}
        className="w-full rounded-xl border border-line bg-surface px-4 py-3 font-semibold text-bad"
      >
        Keluar
      </button>
    </div>
  );
}
