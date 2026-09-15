import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asUser, createMigratedDatabase, createUser, dropDatabase } from "@/supabase/test/harness";
import { WORKFLOW_TABLES } from "@/lib/supabase/workflow-tables";

const DB = "tmh_test_workflow_schema";

describe("agentic workflow schema", () => {
  let db: Client;
  let owner: string;
  let outsider: string;

  beforeAll(async () => {
    db = await createMigratedDatabase(DB);
    owner = await createUser(db, "workflow-owner@example.test");
    outsider = await createUser(db, "workflow-outsider@example.test");
  });

  afterAll(async () => {
    await db?.end();
    await dropDatabase(DB);
  });

  it("creates every workflow table with user ownership and forced RLS", async () => {
    const { rows } = await db.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`select c.relname, c.relrowsecurity, c.relforcerowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1::text[])`, [WORKFLOW_TABLES]);
    const byName = new Map(rows.map((row) => [row.relname, row]));
    for (const table of WORKFLOW_TABLES) {
      expect(byName.get(table)?.relrowsecurity, `${table} RLS enabled`).toBe(true);
      expect(byName.get(table)?.relforcerowsecurity, `${table} RLS forced`).toBe(true);
      const owned = await db.query(`select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name='user_id'`, [table]);
      expect(owned.rows, `${table}.user_id`).toHaveLength(1);
    }
  });

  it("has exactly the four owner-scoped policy verbs on every workflow table", async () => {
    const { rows } = await db.query<{ tablename: string; cmd: string }>(
      `select tablename, cmd from pg_policies where schemaname='public' and tablename = any($1::text[])`,
      [WORKFLOW_TABLES],
    );
    for (const table of WORKFLOW_TABLES) {
      expect(rows.filter((row) => row.tablename === table).map((row) => row.cmd).sort(), table).toEqual([
        "DELETE", "INSERT", "SELECT", "UPDATE",
      ]);
    }
  });

  it("exposes no anon privileges and no surplus authenticated privileges", async () => {
    const { rows } = await db.query<{ table_name: string; grantee: string; privilege_type: string }>(
      `select table_name, grantee, privilege_type from information_schema.role_table_grants
       where table_schema='public' and table_name = any($1::text[]) and grantee in ('anon','authenticated')`,
      [WORKFLOW_TABLES],
    );
    expect(rows.filter((row) => row.grantee === "anon")).toHaveLength(0);
    const allowed = new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]);
    expect(rows.filter((row) => row.grantee === "authenticated" && !allowed.has(row.privilege_type))).toHaveLength(0);
  });

  it("isolates workflow rows between authenticated users", async () => {
    const trip = await db.query<{ id: string }>(`insert into public.trips (user_id, destination_city) values ($1,'Lagos') returning id`, [owner]);
    const workflow = await db.query<{ id: string }>(`insert into public.trip_workflows (user_id, trip_id) values ($1,$2) returning id`, [owner, trip.rows[0].id]);

    await asUser(db, owner, async () => {
      const visible = await db.query(`select id from public.trip_workflows where id=$1`, [workflow.rows[0].id]);
      expect(visible.rows).toHaveLength(1);
    });
    await asUser(db, outsider, async () => {
      const hidden = await db.query(`select id from public.trip_workflows where id=$1`, [workflow.rows[0].id]);
      expect(hidden.rows).toHaveLength(0);
      await expect(db.query(`update public.trip_workflows set state='BOOKED' where id=$1`, [workflow.rows[0].id])).resolves.toMatchObject({ rowCount: 0 });
    });
  });

  it("enforces one workflow per user trip and execution idempotency", async () => {
    const trip = await db.query<{ id: string }>(`insert into public.trips (user_id, destination_city) values ($1,'Accra') returning id`, [owner]);
    const workflow = await db.query<{ id: string }>(`insert into public.trip_workflows (user_id, trip_id) values ($1,$2) returning id`, [owner, trip.rows[0].id]);
    await expect(db.query(`insert into public.trip_workflows (user_id, trip_id) values ($1,$2)`, [owner, trip.rows[0].id])).rejects.toThrow(/unique/i);
    await db.query(`insert into public.workflow_tool_executions (user_id,workflow_id,tool_name,tool_version,risk_level,idempotency_key,status,input_hash) values ($1,$2,'search_flights','1','LOW','same-key','SUCCEEDED','hash')`, [owner, workflow.rows[0].id]);
    await expect(db.query(`insert into public.workflow_tool_executions (user_id,workflow_id,tool_name,tool_version,risk_level,idempotency_key,status,input_hash) values ($1,$2,'search_flights','1','LOW','same-key','SUCCEEDED','hash')`, [owner, workflow.rows[0].id])).rejects.toThrow(/unique/i);
  });
});
