import { MeSchema, type Me } from "@avo/shared";
import { create } from "zustand";
import { ApiError, getJson, postJson } from "./api";

type Status = "loading" | "anon" | "authed" | "error";

interface SessionState {
  status: Status;
  me: Me | null;
  load: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  status: "loading",
  me: null,
  async load() {
    set({ status: "loading" });
    try {
      set({ me: await getJson("/api/me", MeSchema), status: "authed" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) set({ me: null, status: "anon" });
      else set({ me: null, status: "error" });
    }
  },
  async logout() {
    try {
      await postJson("/api/auth/logout");
    } finally {
      set({ me: null, status: "anon" });
    }
  },
}));
