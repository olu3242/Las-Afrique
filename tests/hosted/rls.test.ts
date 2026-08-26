import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { databaseUrl, sslConfig } from "./connection";

/**
 * Two-user isolation against the hosted project, executing the real policies
 * with the project's own `auth.uid()`.
 *
 * Users are created directly in auth.users and removed afterwards, so the suite
 * needs no Auth-service configuration and leaves nothing behind. Cross-user
 * denial through the HTTP API is covered separately in api.test.ts.
 */
describe("hosted row-level security", () => {
  let db: Client;
  let alice: string;
  let bob: string;
  let aliceTrip: string;
  let bobTrip: string;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const aliceEmail = `rls-probe-a-${suffix}@example.invalid`;
  const bobEmail = `rls-probe-b-${suffix}@example.invalid`;

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await db.query("begin");
    try {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
      await db.query("set local role authenticated");
      return await fn();
    } finally {
      await db.query("rollback");
    }
  }

  beforeAll(async () => {
    const url = databaseUrl();
    db = new Client({ connectionString: url, ssl: sslConfig(url) });
    await db.connect();

    const mk = async (email: string) => {
      // Only id and email. Every other auth.users column is left to its
      // default, which keeps this portable across a real project and a local
      // rehearsal cluster — and avoids writing more into the auth schema than
      // the probe actually needs.
      const { rows } = await db.query<{ id: string }>(
        `insert into auth.users (id, email) values (gen_random_uuid(), $1)
         returning id`,
        [email],
      );
      return rows[0].id;
    };

    alice = await mk(aliceEmail);
    bob = await mk(bobEmail);

    const trip = async (userId: string, city: string) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.trips (user_id, destination_city) values ($1, $2)
         returning id`,
        [userId, city],
      );
      return rows[0].id;
    };

    aliceTrip = await trip(alice, "Lagos");
    bobTrip = await trip(bob, "Accra");
  });

  afterAll(async () => {
    // Cascades clear the trips and any child rows.
    if (db) {
      await db.query(`delete from auth.users where email = any($1)`, [
        [aliceEmail, bobEmail],
      ]);
      await db.end();
    }
  });

  it("lets a user read their own trip", async () => {
    const rows = await asUser(alice, async () => {
      const { rows } = await db.query(
        `select id, destination_city from public.trips where id = $1`,
        [aliceTrip],
      );
      return rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ destination_city: "Lagos" });
  });

  it("hides another user's trip", async () => {
    const rows = await asUser(alice, async () => {
      const { rows } = await db.query(`select id from public.trips where id = $1`, [
        bobTrip,
      ]);
      return rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("refuses an insert that assigns ownership to someone else", async () => {
    await expect(
      asUser(alice, async () => {
        await db.query(
          `insert into public.trips (user_id, destination_city) values ($1, 'Nairobi')`,
          [bob],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("refuses a traveller attached to another user's trip", async () => {
    // Not RLS — the composite foreign key from 0006. Bob owns the traveller
    // row, so the insert policy is satisfied and the trip really exists; what
    // refuses it is that travelers references trips (id, user_id).
    //
    // Asserted on the hosted project specifically, because this is a schema
    // change and a schema change is only real once it has been pushed.
    await expect(
      asUser(bob, async () => {
        await db.query(
          `insert into public.travelers (trip_id, user_id, full_name)
           values ($1, $2, 'Smuggled in')`,
          [aliceTrip, bob],
        );
      }),
    ).rejects.toThrow(/foreign key constraint/i);
  });

  it("refuses to re-assign an owned row to another user", async () => {
    await expect(
      asUser(bob, async () => {
        await db.query(`update public.trips set user_id = $1 where id = $2`, [
          alice,
          bobTrip,
        ]);
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("matches nothing when updating or deleting another user's row", async () => {
    const updated = await asUser(alice, async () => {
      const { rows } = await db.query(
        `update public.trips set destination_city = 'hijacked' where id = $1
         returning id`,
        [bobTrip],
      );
      return rows;
    });
    expect(updated).toHaveLength(0);

    const deleted = await asUser(alice, async () => {
      const { rows } = await db.query(
        `delete from public.trips where id = $1 returning id`,
        [bobTrip],
      );
      return rows;
    });
    expect(deleted).toHaveLength(0);
  });

  it("exposes nothing of another user's on any tenant table", async () => {
    const tables = [
      "profiles",
      "trips",
      "travelers",
      "document_records",
      "cost_estimates",
      "savings_plans",
      "vault_files",
    ];

    for (const table of tables) {
      const column = table === "profiles" ? "id" : "user_id";
      const rows = await asUser(alice, async () => {
        const { rows } = await db.query(
          `select count(*)::int as n from public.${table} where ${column} = $1`,
          [bob],
        );
        return rows;
      });
      expect(rows[0].n, `${table} should expose nothing owned by bob`).toBe(0);
    }
  });
});
