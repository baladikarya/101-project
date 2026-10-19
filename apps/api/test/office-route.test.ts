import { OfficeSchema } from "@avo/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { officeRoutes } from "../src/phase4/office";
import { makeD1 } from "./testkit";

let db: ReturnType<typeof makeD1>;
beforeEach(() => {
  db = makeD1();
});
const get = async () => {
  const res = await officeRoutes.request("/", {}, { DB: db } as never);
  expect(res.status).toBe(200);
  return OfficeSchema.parse(await res.json());
};

describe("GET /api/office", () => {
  it("DB kosong: delapan agent idle", async () => {
    const o = await get();
    expect(o.agents).toHaveLength(8);
    expect(o.agents.every((a) => a.state === "idle")).toBe(true);
  });

  it("status dan statistik datang dari tabel", async () => {
    const now = Date.now();
    db.raw.exec(`
      INSERT INTO p3_runs (id,title,goal,template,status,created_at,updated_at) VALUES ('r','Catatan','g','standard','running',${now},${now});
      INSERT INTO p3_steps (id,run_id,idx,agent,title,status,updated_at) VALUES
        ('r-0','r',0,'analyst','Analisis','completed',${now}),
        ('r-1','r',1,'architect','Rancang','running',${now});
      INSERT INTO p3_usage_logs (id,run_id,step_idx,attempt,agent,provider,model,total_tokens,created_at) VALUES ('u','r',0,1,'analyst','groq','m',120,${now});
      INSERT INTO p2_tasks (id,title,prompt,status,created_at,updated_at) VALUES ('t','Tugas','p','running',${now},${now});
    `);
    const o = await get();
    const by = (id: string) => o.agents.find((a) => a.id === id)!;
    expect(by("architect")).toMatchObject({ state: "working", activity: "Rancang", context: "Catatan" });
    expect(by("analyst")).toMatchObject({ state: "idle", steps_done: 1, total_tokens: 120 });
    expect(by("manager").state).toBe("working");
    expect(by("qa").state).toBe("idle");
  });
});
