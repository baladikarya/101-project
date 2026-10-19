import { useState } from "react";
import { Account } from "./Account";
import { Agents } from "./Agents";
import { HomeIcon, ListIcon, UserIcon, UsersIcon } from "./icons";
import { Overview } from "./Overview";
import { Runs } from "./Runs";
import { Tasks } from "./Tasks";

const TABS = [
  { id: "overview", label: "Ringkasan", Icon: HomeIcon },
  { id: "tasks", label: "Tugas", Icon: ListIcon },
  { id: "runs", label: "Tim", Icon: UsersIcon },
  { id: "agents", label: "Agent", Icon: UsersIcon },
  { id: "account", label: "Akun", Icon: UserIcon },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Shell() {
  const [tab, setTab] = useState<TabId>("overview");

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col">
      <header className="px-5 pb-3 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <h1 className="text-xl font-bold tracking-tight">{TABS.find((t) => t.id === tab)?.label}</h1>
      </header>

      <main className="flex-1 overflow-y-auto px-5 pb-6">
        {tab === "overview" && <Overview />}
        {tab === "tasks" && <Tasks />}
        {tab === "runs" && <Runs />}
        {tab === "agents" && <Agents />}
        {tab === "account" && <Account />}
      </main>

      <nav
        aria-label="Navigasi utama"
        className="grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`flex flex-col items-center gap-1 py-2.5 text-xs font-medium ${
              tab === id ? "text-accent" : "text-muted"
            }`}
          >
            <Icon className="h-6 w-6" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
