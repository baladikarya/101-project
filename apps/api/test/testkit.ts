// Peralatan tes: D1 palsu (node:sqlite) + Workflow palsu yang menjalankan kelas Workflow asli di Node.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type Param = string | number | null;

class FakeStmt {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    private params: Param[] = [],
  ) {}
  bind(...p: unknown[]) {
    return new FakeStmt(this.db, this.sql, p.map((x) => (x === undefined ? null : (x as Param))));
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.params) ?? null;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params), success: true, meta: {} };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(r.changes) }, results: [] };
  }
}

export function makeD1() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../../../db/migrations/", import.meta.url);
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  return {
    raw: db,
    prepare: (sql: string) => new FakeStmt(db, sql),
    async batch(stmts: FakeStmt[]) {
      const out = [];
      for (const s of stmts) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run());
      return out;
    },
  };
}

type StepFn = () => Promise<unknown>;
interface StepCfg {
  retries?: { limit: number };
}

class FakeInstance {
  paused = false;
  waiting = false;
  state: "complete" | "errored" | null = null;
  err: Error | null = null;
  private resumeWaiters: (() => void)[] = [];
  private buffered = new Map<string, unknown[]>();
  private waiters = new Map<string, (p: unknown) => void>();
  readonly done: Promise<void>;

  constructor(
    id: string,
    params: unknown,
    env: unknown,
    WorkflowClass: new (ctx: unknown, env: unknown) => { run(e: unknown, s: unknown): Promise<unknown> },
  ) {
    const step = {
      do: async (name: string, a: StepCfg | StepFn, b?: StepFn) => {
        const fn = (typeof a === "function" ? a : b) as StepFn;
        const limit = typeof a === "function" ? 5 : (a.retries?.limit ?? 5);
        while (this.paused) await new Promise<void>((r) => this.resumeWaiters.push(r));
        for (let i = 0; ; i++) {
          try {
            return await fn();
          } catch (e) {
            if ((e as Error).name === "NonRetryableError" || i >= limit) throw e;
          }
        }
      },
      waitForEvent: async (_name: string, opts: { type: string }) => {
        this.waiting = true;
        const buf = this.buffered.get(opts.type);
        const payload = buf?.length
          ? buf.shift()
          : await new Promise((res) => this.waiters.set(opts.type, res));
        this.waiting = false;
        return { payload, timestamp: new Date(), type: opts.type };
      },
    };
    this.done = (async () => {
      try {
        await new WorkflowClass({}, env).run({ payload: params, timestamp: new Date(), instanceId: id }, step);
        this.state = "complete";
      } catch (e) {
        this.state = "errored";
        this.err = e as Error;
      }
    })();
  }

  async status() {
    const status = this.state ?? (this.paused ? "paused" : this.waiting ? "waiting" : "running");
    return { status, error: this.err ? { name: this.err.name, message: this.err.message } : undefined };
  }
  async pause() {
    this.paused = true;
  }
  async resume() {
    this.paused = false;
    for (const r of this.resumeWaiters.splice(0)) r();
  }
  async sendEvent({ type, payload }: { type: string; payload: unknown }) {
    const w = this.waiters.get(type);
    if (w) {
      this.waiters.delete(type);
      w(payload);
    } else this.buffered.set(type, [...(this.buffered.get(type) ?? []), payload]);
  }
}

export function makeWorkflowBinding(
  getEnv: () => unknown,
  WorkflowClass: ConstructorParameters<typeof FakeInstance>[3],
) {
  const instances = new Map<string, FakeInstance>();
  return {
    instances,
    async create({ id, params }: { id: string; params: unknown }) {
      const inst = new FakeInstance(id, params, getEnv(), WorkflowClass);
      instances.set(id, inst);
      return inst;
    },
    async get(id: string) {
      const inst = instances.get(id);
      if (!inst) throw new Error("instance_not_found");
      return inst;
    },
  };
}

export async function waitFor<T>(fn: () => T | Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`waitFor timeout; last=${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
