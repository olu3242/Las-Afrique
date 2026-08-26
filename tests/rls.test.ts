import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  asAnon,
  asUser,
  createMigratedDatabase,
  createUser,
  dropDatabase,
} from "@/supabase/test/harness";

const DB = "tmh_test_rls";

/**
 * These run against a real PostgreSQL cluster with the real policy predicates —
 * `auth.uid()` is the same implementation Supabase ships. Seeding happens as the
 * superuser (which bypasses RLS); every assertion runs as `authenticated` or
 * `anon` with a scoped JWT claim, exactly as PostgREST sets one up per request.
 */
describe("row-level security", () => {
  let db: Client;
  let alice: string;
  let bob: string;
  let aliceTrip: string;
  let bobTrip: string;

  beforeAll(async () => {
    db = await createMigratedDatabase(DB);

    alice = await createUser(db, "alice@example.com");
    bob = await createUser(db, "bob@example.com");

    await db.query(
      `insert into public.country_profiles (key, name, currency, sort_order)
       values ('nigeria', 'Nigeria', 'NGN', 1)`,
    );

    const { rows: aliceRows } = await db.query<{ id: string }>(
      `insert into public.trips (user_id, destination_city) values ($1, 'Lagos')
       returning id`,
      [alice],
    );
    aliceTrip = aliceRows[0].id;

    const { rows: bobRows } = await db.query<{ id: string }>(
      `insert into public.trips (user_id, destination_city) values ($1, 'Accra')
       returning id`,
      [bob],
    );
    bobTrip = bobRows[0].id;

    await db.query(
      `insert into public.travelers (trip_id, user_id, full_name)
       values ($1, $2, 'Alice Okafor')`,
      [aliceTrip, alice],
    );
    await db.query(
      `insert into public.travelers (trip_id, user_id, full_name)
       values ($1, $2, 'Bob Mensah')`,
      [bobTrip, bob],
    );
  });

  afterAll(async () => {
    await db?.end();
    await dropDatabase(DB);
  });

  describe("owner access", () => {
    it("lets a user read their own trip", async () => {
      const rows = await asUser(db, alice, async () => {
        const { rows } = await db.query(`select id, destination_city from public.trips`);
        return rows;
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: aliceTrip, destination_city: "Lagos" });
    });

    it("lets a user insert a trip they own", async () => {
      const rows = await asUser(db, alice, async () => {
        const { rows } = await db.query(
          `insert into public.trips (user_id, destination_city)
           values ($1, 'Abuja') returning id`,
          [alice],
        );
        return rows;
      });
      expect(rows).toHaveLength(1);
    });

    it("lets a user update and delete their own trip", async () => {
      await asUser(db, alice, async () => {
        const updated = await db.query(
          `update public.trips set destination_city = 'Ibadan' where id = $1
           returning id`,
          [aliceTrip],
        );
        expect(updated.rows).toHaveLength(1);

        const deleted = await db.query(
          `delete from public.trips where id = $1 returning id`,
          [aliceTrip],
        );
        expect(deleted.rows).toHaveLength(1);
      });
    });

    it("lets a user read their own travelers", async () => {
      const rows = await asUser(db, bob, async () => {
        const { rows } = await db.query(`select full_name from public.travelers`);
        return rows;
      });
      expect(rows).toEqual([{ full_name: "Bob Mensah" }]);
    });
  });

  describe("cross-user denial", () => {
    it("hides another user's trip from selects", async () => {
      const rows = await asUser(db, alice, async () => {
        const { rows } = await db.query(`select id from public.trips where id = $1`, [
          bobTrip,
        ]);
        return rows;
      });
      expect(rows).toHaveLength(0);
    });

    it("hides another user's travelers", async () => {
      const rows = await asUser(db, alice, async () => {
        const { rows } = await db.query(
          `select id from public.travelers where user_id = $1`,
          [bob],
        );
        return rows;
      });
      expect(rows).toHaveLength(0);
    });

    it("refuses an insert that assigns ownership to someone else", async () => {
      await expect(
        asUser(db, alice, async () => {
          await db.query(
            `insert into public.trips (user_id, destination_city) values ($1, 'Nairobi')`,
            [bob],
          );
        }),
      ).rejects.toThrow(/row-level security/i);
    });

    it("silently matches nothing when updating another user's row", async () => {
      const rows = await asUser(db, alice, async () => {
        const { rows } = await db.query(
          `update public.trips set destination_city = 'hijacked' where id = $1
           returning id`,
          [bobTrip],
        );
        return rows;
      });
      expect(rows).toHaveLength(0);
    });

    it("silently matches nothing when deleting another user's row", async () => {
      const rows = await asUser(db, alice, async () => {
        const { rows } = await db.query(
          `delete from public.trips where id = $1 returning id`,
          [bobTrip],
        );
        return rows;
      });
      expect(rows).toHaveLength(0);
    });

    it("refuses to re-assign an owned row to another user", async () => {
      await expect(
        asUser(db, bob, async () => {
          await db.query(`update public.trips set user_id = $1 where id = $2`, [
            alice,
            bobTrip,
          ]);
        }),
      ).rejects.toThrow(/row-level security/i);
    });

    it("denies cross-user access on every tenant table", async () => {
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
        const rows = await asUser(db, alice, async () => {
          const { rows } = await db.query(
            `select count(*)::int as n from public.${table}
             where ${table === "profiles" ? "id" : "user_id"} = $1`,
            [bob],
          );
          return rows;
        });
        expect(rows[0].n, `${table} should expose nothing owned by bob`).toBe(0);
      }
    });
  });

  describe("signed-out visitors", () => {
    it("cannot read tenant data", async () => {
      // Denial lands at the grant layer, before RLS is even consulted: `anon`
      // holds no SELECT on tenant tables. That is the stronger of the two
      // outcomes — the policy is defence in depth behind a missing grant.
      await expect(
        asAnon(db, async () => {
          await db.query(`select count(*) from public.trips`);
        }),
      ).rejects.toThrow(/permission denied/i);
    });

    it("is denied on every tenant table, not just trips", async () => {
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
        await expect(
          asAnon(db, async () => {
            await db.query(`select count(*) from public.${table}`);
          }),
          `${table} should be unreadable to signed-out visitors`,
        ).rejects.toThrow(/permission denied/i);
      }
    });

    it("can read public country reference data", async () => {
      const rows = await asAnon(db, async () => {
        const { rows } = await db.query(`select key from public.country_profiles`);
        return rows;
      });
      expect(rows).toEqual([{ key: "nigeria" }]);
    });

    it("cannot write country reference data", async () => {
      await expect(
        asAnon(db, async () => {
          await db.query(
            `insert into public.country_profiles (key, name, currency, sort_order)
             values ('atlantis', 'Atlantis', 'XXX', 99)`,
          );
        }),
      ).rejects.toThrow();
    });
  });

  describe("auth.uid() with no claim", () => {
    it("resolves to null rather than matching a row", async () => {
      const rows = await asAnon(db, async () => {
        const { rows } = await db.query(`select auth.uid() is null as anonymous`);
        return rows;
      });
      expect(rows[0].anonymous).toBe(true);
    });
  });
});
