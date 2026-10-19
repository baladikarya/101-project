import type { Phase3Env } from "./phase3/shared";

export interface Env extends Phase3Env {
  OWNER_GITHUB_LOGIN: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

export interface SessionUser {
  id: number;
  login: string;
  avatarUrl: string | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser };
};
