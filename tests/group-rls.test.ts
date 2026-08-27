import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  asAnon,
  asUser,
  createMigratedDatabase,
  createUser,
  dropDatabase,
} from "@/supabase/test/harness";

const DB = "tmh_test_groups";

/**
 * Group coordination against the real policy predicates.
 *
 * The claim Iteration 11 makes is that several people can coordinate one
 * journey without any of them gaining a route into another's private records.
 * That is a security claim, so it is executed rather than described: real
 * policies, a real `auth.uid()`, and an adversary who is a legitimate member
 * of the group rather than a stranger.
 *
 * A stranger being refused proves very little here — the pre-existing tenant
 * policies already did that. The interesting adversary is the coordinator who
 * is *supposed* to be there.
 */
describe("group coordination", () => {
  let db: Client;

  // Ama owns the group. Kofi coordinates it. Zainab is a plain member.
  // Yemi is in a different group entirely.
  let ama: string;
  let kofi: string;
  let zainab: string;
  let yemi: string;

  let group: string;
  let otherGroup: string;
  let amaTrip: string;
  let zainabTrip: string;

  beforeAll(async () => {
    db = await createMigratedDatabase(DB);
    ama = await createUser(db, "ama@groups.test");
    kofi = await createUser(db, "kofi@groups.test");
    zainab = await createUser(db, "zainab@groups.test");
    yemi = await createUser(db, "yemi@groups.test");

    // Setup runs as superuser: asUser() rolls back, so it cannot seed.
    const { rows: g } = await db.query<{ id: string }>(
      `insert into public.travel_groups (owner_id, name) values ($1, $2)
       returning id`,
      [ama, "Adeyemo homecoming"],
    );
    group = g[0].id;

    const { rows: og } = await db.query<{ id: string }>(
      `insert into public.travel_groups (owner_id, name) values ($1, $2)
       returning id`,
      [yemi, "Someone else's journey"],
    );
    otherGroup = og[0].id;

    await db.query(
      `insert into public.group_memberships (group_id, user_id, role, shares_readiness)
       values ($1, $2, 'owner', true), ($1, $3, 'coordinator', false),
              ($1, $4, 'member', false)`,
      [group, ama, kofi, zainab],
    );
    await db.query(
      `insert into public.group_memberships (group_id, user_id, role)
       values ($1, $2, 'owner')`,
      [otherGroup, yemi],
    );

    const { rows: t } = await db.query<{ id: string }>(
      `insert into public.trips (user_id, destination_city) values ($1, 'Lagos')
       returning id`,
      [ama],
    );
    amaTrip = t[0].id;

    const { rows: zt } = await db.query<{ id: string }>(
      `insert into public.trips (user_id, destination_city) values ($1, 'Accra')
       returning id`,
      [zainab],
    );
    zainabTrip = zt[0].id;

    await db.query(
      `insert into public.group_trips (group_id, trip_id, user_id)
       values ($1, $2, $3), ($1, $4, $5)`,
      [group, amaTrip, ama, zainabTrip, zainab],
    );
  });

  afterAll(async () => {
    await db?.end();
    await dropDatabase(DB);
  });

  // --- the boundary that matters ------------------------------------------

  describe("group membership does not reach private records", () => {
    it("hides a member's trip from the group's own owner", () => {
      // Ama owns the group Zainab belongs to. She still gets nothing for
      // Zainab's trip — "organiser" is not "auditor".
      return asUser(db, ama, async () => {
        const { rows } = await db.query(
          `select id from public.trips where id = $1`,
          [zainabTrip],
        );
        expect(rows).toEqual([]);
      });
    });

    it("hides a member's trip from a coordinator", () =>
      asUser(db, kofi, async () => {
        const { rows } = await db.query(
          `select id from public.trips where user_id = $1`,
          [ama],
        );
        expect(rows).toEqual([]);
      }));

    it("hides a member's travellers, documents and vault from the group", async () => {
      await db.query(
        `insert into public.travelers (trip_id, user_id, full_name)
         values ($1, $2, 'Private Person')`,
        [zainabTrip, zainab],
      );
      await db.query(
        `insert into public.vault_files (user_id, trip_id, storage_path, file_name)
         values ($1, $2, $3, 'passport.pdf')`,
        [zainab, zainabTrip, `${zainab}/private/passport.pdf`],
      );

      await asUser(db, ama, async () => {
        for (const table of ["travelers", "vault_files", "document_records"]) {
          const { rows } = await db.query(
            `select 1 from public.${table} where user_id = $1`,
            [zainab],
          );
          expect(rows, `${table} must stay private`).toEqual([]);
        }
      });
    });

    it("shows that a member is travelling without showing what they booked", () =>
      // group_trips is the association. It names the person and their trip id;
      // it grants no read of the trip.
      asUser(db, kofi, async () => {
        const { rows: association } = await db.query(
          `select user_id from public.group_trips where group_id = $1`,
          [group],
        );
        expect(association.length).toBe(2);

        const { rows: contents } = await db.query(
          `select destination_city from public.trips where id = $1`,
          [zainabTrip],
        );
        expect(contents).toEqual([]);
      }));
  });

  // --- membership authorization -------------------------------------------

  describe("membership authorization", () => {
    it("shows the group to its members", () =>
      asUser(db, zainab, async () => {
        const { rows } = await db.query(
          `select name from public.travel_groups where id = $1`,
          [group],
        );
        expect(rows).toHaveLength(1);
      }));

    it("hides the group from someone in a different group", () =>
      asUser(db, yemi, async () => {
        const { rows } = await db.query(
          `select id from public.travel_groups where id = $1`,
          [group],
        );
        expect(rows).toEqual([]);
      }));

    it("hides the group's tasks and activities across the group boundary", async () => {
      await db.query(
        `insert into public.group_tasks (group_id, title, created_by)
         values ($1, 'Book the bus', $2)`,
        [group, ama],
      );
      await db.query(
        `insert into public.group_activities (group_id, title, created_by)
         values ($1, 'Village visit', $2)`,
        [group, ama],
      );

      await asUser(db, yemi, async () => {
        for (const table of ["group_tasks", "group_activities"]) {
          const { rows } = await db.query(
            `select 1 from public.${table} where group_id = $1`,
            [group],
          );
          expect(rows, table).toEqual([]);
        }
      });
    });

    it("gives a signed-out visitor nothing", async () => {
      // Asserts the property, not the mechanism — the same shape the tenant
      // suites use. anon holds no grant on a group table, so denial lands
      // before RLS is consulted and arrives as an error rather than an empty
      // result. Both are the guarantee; a leak is neither, so this cannot pass
      // while rows come back.
      for (const table of ["travel_groups", "group_memberships", "group_tasks"]) {
        const outcome = await asAnon(db, async () => {
          try {
            const { rows } = await db.query(`select 1 from public.${table}`);
            return { denied: false as const, rows };
          } catch (error) {
            return { denied: true as const, error };
          }
        });

        if (!outcome.denied) {
          expect(outcome.rows, `${table} must expose no rows`).toEqual([]);
        } else {
          expect(String(outcome.error)).toMatch(/permission denied/i);
        }
      }
    });
  });

  // --- role enforcement ---------------------------------------------------

  describe("role enforcement", () => {
    it("refuses a plain member the creation of a shared task", () =>
      expect(
        asUser(db, zainab, async () => {
          await db.query(
            `insert into public.group_tasks (group_id, title, created_by)
             values ($1, 'Unauthorised', $2)`,
            [group, zainab],
          );
        }),
      ).rejects.toThrow(/row-level security/i));

    it("allows a coordinator the same task", () =>
      asUser(db, kofi, async () => {
        const { rows } = await db.query(
          `insert into public.group_tasks (group_id, title, created_by)
           values ($1, 'Coordinator task', $2) returning id`,
          [group, kofi],
        );
        expect(rows).toHaveLength(1);
      }));

    it("refuses a coordinator the deletion of the group", () =>
      asUser(db, kofi, async () => {
        const result = await db.query(
          `delete from public.travel_groups where id = $1`,
          [group],
        );
        // Denial lands as "matched nothing" rather than an error, which is the
        // security guarantee either way.
        expect(result.rowCount).toBe(0);
      }));

    it("refuses a member of another group any write at all", () =>
      expect(
        asUser(db, yemi, async () => {
          await db.query(
            `insert into public.group_tasks (group_id, title, created_by)
             values ($1, 'Outsider', $2)`,
            [group, yemi],
          );
        }),
      ).rejects.toThrow(/row-level security/i));

    it("refuses a member forging a task as somebody else", () =>
      expect(
        asUser(db, kofi, async () => {
          await db.query(
            `insert into public.group_tasks (group_id, title, created_by)
             values ($1, 'Forged', $2)`,
            [group, ama],
          );
        }),
      ).rejects.toThrow(/row-level security/i));
  });

  // --- what a coordinator may not rewrite ---------------------------------

  describe("a coordinator cannot publish on a member's behalf", () => {
    it("silently preserves the member's sharing choice", async () => {
      // Zainab shares nothing. Kofi coordinates, so RLS lets his UPDATE match
      // her row — the trigger is what stops him changing what she shares.
      await asUser(db, kofi, async () => {
        await db.query(
          `update public.group_memberships
              set shares_readiness = true, display_name = 'Renamed'
            where group_id = $1 and user_id = $2`,
          [group, zainab],
        );

        const { rows } = await db.query<{
          shares_readiness: boolean;
          display_name: string | null;
        }>(
          `select shares_readiness, display_name from public.group_memberships
            where group_id = $1 and user_id = $2`,
          [group, zainab],
        );
        expect(rows[0].shares_readiness).toBe(false);
        expect(rows[0].display_name).toBeNull();
      });
    });

    it("preserves the published coordination state too", async () => {
      // The published word IS the disclosure. A coordinator able to set it
      // could publish a verdict about someone else's private records — the
      // precise thing the whole design exists to prevent.
      await db.query(
        `update public.group_memberships
            set shares_readiness = true, coordination_state = 'ready'
          where group_id = $1 and user_id = $2`,
        [group, kofi],
      );

      await asUser(db, ama, async () => {
        await db.query(
          `update public.group_memberships set coordination_state = 'blocked'
            where group_id = $1 and user_id = $2`,
          [group, kofi],
        );
        const { rows } = await db.query<{ coordination_state: string }>(
          `select coordination_state from public.group_memberships
            where group_id = $1 and user_id = $2`,
          [group, kofi],
        );
        expect(rows[0].coordination_state).toBe("ready");
      });
    });

    it("refuses a published state while sharing is off", () =>
      // Publishing without consent is refused by the schema, not left to the
      // writer to remember.
      expect(
        db.query(
          `update public.group_memberships
              set shares_readiness = false, coordination_state = 'ready'
            where group_id = $1 and user_id = $2`,
          [group, ama],
        ),
      ).rejects.toThrow(/group_memberships_state_needs_consent/));

    it("still lets the coordinator change role and state", () =>
      asUser(db, kofi, async () => {
        await db.query(
          `update public.group_memberships set state = 'removed'
            where group_id = $1 and user_id = $2`,
          [group, zainab],
        );
        const { rows } = await db.query<{ state: string }>(
          `select state from public.group_memberships
            where group_id = $1 and user_id = $2`,
          [group, zainab],
        );
        expect(rows[0].state).toBe("removed");
      }));

    it("lets the member set their own shared fields", () =>
      asUser(db, zainab, async () => {
        await db.query(
          `update public.group_memberships
              set shares_readiness = true, display_name = 'Zainab',
                  arrival_on = '2026-12-20'
            where group_id = $1 and user_id = $2`,
          [group, zainab],
        );
        const { rows } = await db.query<{
          shares_readiness: boolean;
          display_name: string;
          arrival_on: Date;
        }>(
          `select shares_readiness, display_name, arrival_on
             from public.group_memberships where group_id = $1 and user_id = $2`,
          [group, zainab],
        );
        expect(rows[0].shares_readiness).toBe(true);
        expect(rows[0].display_name).toBe("Zainab");
      }));
  });

  // --- invitations --------------------------------------------------------

  describe("invitations", () => {
    it("refuses a second pending invitation to the same address", async () => {
      await db.query(
        `insert into public.group_invitations (group_id, email, token_hash, invited_by)
         values ($1, 'new@groups.test', 'hash-a', $2)`,
        [group, ama],
      );

      await expect(
        db.query(
          `insert into public.group_invitations (group_id, email, token_hash, invited_by)
           values ($1, 'NEW@groups.test', 'hash-b', $2)`,
          [group, ama],
        ),
      ).rejects.toThrow(/group_invitations_one_pending_per_email/);
    });

    it("allows a fresh invitation once the previous one is revoked", async () => {
      await db.query(
        `update public.group_invitations set state = 'revoked'
          where group_id = $1 and lower(email) = 'new@groups.test'`,
        [group],
      );
      const { rows } = await db.query(
        `insert into public.group_invitations (group_id, email, token_hash, invited_by)
         values ($1, 'new@groups.test', 'hash-c', $2) returning id`,
        [group, ama],
      );
      expect(rows).toHaveLength(1);
    });

    it("refuses an invitation that would grant ownership", () =>
      expect(
        db.query(
          `insert into public.group_invitations (group_id, email, role, token_hash, invited_by)
           values ($1, 'takeover@groups.test', 'owner', 'hash-d', $2)`,
          [group, ama],
        ),
      ).rejects.toThrow(/group_invitations_not_owner/));

    it("hides the guest list from plain members", () =>
      asUser(db, zainab, async () => {
        const { rows } = await db.query(
          `select 1 from public.group_invitations where group_id = $1`,
          [group],
        );
        expect(rows).toEqual([]);
      }));

    it("shows invitations to a coordinator", () =>
      asUser(db, kofi, async () => {
        const { rows } = await db.query(
          `select 1 from public.group_invitations where group_id = $1`,
          [group],
        );
        expect(rows.length).toBeGreaterThan(0);
      }));
  });

  // --- acceptance ---------------------------------------------------------

  describe("accepting an invitation", () => {
    let newcomer: string;

    beforeAll(async () => {
      newcomer = await createUser(db, "newcomer@groups.test");
    });

    async function invite(hash: string, over = "") {
      await db.query(
        `insert into public.group_invitations
           (group_id, email, token_hash, invited_by${over ? ", expires_at" : ""})
         values ($1, $2, $3, $4${over ? ", now() - interval '1 day'" : ""})`,
        [group, `${hash}@groups.test`, hash, ama],
      );
    }

    it("joins the group through the definer function", async () => {
      await invite("token-join");
      await asUser(db, newcomer, async () => {
        const { rows } = await db.query<{ outcome: string; group_id: string }>(
          `select * from public.accept_group_invitation('token-join')`,
        );
        expect(rows[0].outcome).toBe("joined");
        expect(rows[0].group_id).toBe(group);

        const { rows: membership } = await db.query(
          `select 1 from public.group_memberships
            where group_id = $1 and user_id = $2`,
          [group, newcomer],
        );
        expect(membership).toHaveLength(1);
      });
    });

    it("is idempotent — a double-clicked link joins once", async () => {
      await invite("token-twice");
      // Not inside asUser: that rolls back, and the second call has to see the
      // first one's membership to be a real idempotency test.
      await db.query(`select set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify({ sub: newcomer, role: "authenticated" }),
      ]);
      await db.query(`set role authenticated`);
      try {
        const first = await db.query<{ outcome: string }>(
          `select * from public.accept_group_invitation('token-twice')`,
        );
        const second = await db.query<{ outcome: string }>(
          `select * from public.accept_group_invitation('token-twice')`,
        );
        expect(first.rows[0].outcome).toBe("joined");
        expect(second.rows[0].outcome).toBe("already_member");
      } finally {
        await db.query("reset role");
        await db.query(`select set_config('request.jwt.claims', '', false)`);
      }

      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int as n from public.group_memberships
          where group_id = $1 and user_id = $2`,
        [group, newcomer],
      );
      expect(rows[0].n).toBe(1);
    });

    it("refuses an unknown token", () =>
      asUser(db, yemi, async () => {
        const { rows } = await db.query<{ outcome: string }>(
          `select * from public.accept_group_invitation('no-such-token')`,
        );
        expect(rows[0].outcome).toBe("invalid");
      }));

    it("refuses an expired invitation", async () => {
      await invite("token-expired", "expired");
      const stranger = await createUser(db, "expired-invitee@groups.test");
      await asUser(db, stranger, async () => {
        const { rows } = await db.query<{ outcome: string }>(
          `select * from public.accept_group_invitation('token-expired')`,
        );
        expect(rows[0].outcome).toBe("invalid");
      });
    });

    it("refuses a revoked invitation", async () => {
      await invite("token-revoked");
      await db.query(
        `update public.group_invitations set state = 'revoked'
          where token_hash = 'token-revoked'`,
      );
      const stranger = await createUser(db, "revoked-invitee@groups.test");
      await asUser(db, stranger, async () => {
        const { rows } = await db.query<{ outcome: string }>(
          `select * from public.accept_group_invitation('token-revoked')`,
        );
        expect(rows[0].outcome).toBe("invalid");
      });
    });

    it("gives an accepted member no more than their role allows", async () => {
      // Joined as a plain member, so the shared plan is readable and not
      // writable — acceptance is not a privilege escalation.
      await asUser(db, newcomer, async () => {
        const { rows } = await db.query(
          `select 1 from public.group_tasks where group_id = $1`,
          [group],
        );
        expect(rows.length).toBeGreaterThan(0);
      });

      await expect(
        asUser(db, newcomer, async () => {
          await db.query(
            `insert into public.group_tasks (group_id, title, created_by)
             values ($1, 'Escalated', $2)`,
            [group, newcomer],
          );
        }),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  // --- structural invariants ----------------------------------------------

  describe("structural invariants", () => {
    it("permits exactly one active owner", async () => {
      // A fresh person, so the unique-person constraint cannot fire first and
      // make this pass for the wrong reason.
      const newcomer = await createUser(db, "second-owner@groups.test");
      await expect(
        db.query(
          `insert into public.group_memberships (group_id, user_id, role)
           values ($1, $2, 'owner')`,
          [group, newcomer],
        ),
      ).rejects.toThrow(/group_memberships_single_owner/);
    });

    it("refuses a member joining the same group twice", () =>
      expect(
        db.query(
          `insert into public.group_memberships (group_id, user_id)
           values ($1, $2)`,
          [group, zainab],
        ),
      ).rejects.toThrow(/group_memberships_unique_person/));

    it("refuses attaching a trip that belongs to someone else", async () => {
      // Tenant-consistent composite key, the same rule migration 0006
      // established: Kofi cannot enter Ama's trip as his own. A trip not yet
      // in any group, so the one-group-per-trip constraint cannot fire first.
      const { rows } = await db.query<{ id: string }>(
        `insert into public.trips (user_id, destination_city)
         values ($1, 'Abuja') returning id`,
        [ama],
      );
      await expect(
        db.query(
          `insert into public.group_trips (group_id, trip_id, user_id)
           values ($1, $2, $3)`,
          [group, rows[0].id, kofi],
        ),
      ).rejects.toThrow(/group_trips_trip_fkey|violates foreign key/i);
    });

    it("refuses the same task assigned to the same person twice", async () => {
      const { rows: task } = await db.query<{ id: string }>(
        `insert into public.group_tasks (group_id, title, created_by)
         values ($1, 'Idempotent', $2) returning id`,
        [group, ama],
      );
      await db.query(
        `insert into public.group_task_assignments (group_id, task_id, assignee_id)
         values ($1, $2, $3)`,
        [group, task[0].id, kofi],
      );

      await expect(
        db.query(
          `insert into public.group_task_assignments (group_id, task_id, assignee_id)
           values ($1, $2, $3)`,
          [group, task[0].id, kofi],
        ),
      ).rejects.toThrow(/group_task_assignments_unique/);
    });

    it("refuses a task that depends on itself", async () => {
      const { rows: task } = await db.query<{ id: string }>(
        `insert into public.group_tasks (group_id, title, created_by)
         values ($1, 'Self', $2) returning id`,
        [group, ama],
      );
      await expect(
        db.query(
          `insert into public.group_dependencies (group_id, task_id, depends_on_task_id)
           values ($1, $2, $2)`,
          [group, task[0].id],
        ),
      ).rejects.toThrow(/group_dependencies_not_self/);
    });

    it("refuses a cost figure with no currency", () =>
      expect(
        db.query(
          `insert into public.group_activities (group_id, title, estimated_cost, created_by)
           values ($1, 'Priced', 100, $2)`,
          [group, ama],
        ),
      ).rejects.toThrow(/group_activities_cost_has_currency/));

    it("leaves the group plan intact when a member is removed", async () => {
      // Departure must not cascade into shared work. The tasks and activities
      // the group agreed on survive one person leaving.
      const before = await db.query(
        `select count(*)::int as n from public.group_tasks where group_id = $1`,
        [group],
      );

      await db.query(
        `delete from public.group_memberships where group_id = $1 and user_id = $2`,
        [group, zainab],
      );

      const after = await db.query(
        `select count(*)::int as n from public.group_tasks where group_id = $1`,
        [group],
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);

      // The group itself survives too.
      const { rows } = await db.query(
        `select 1 from public.travel_groups where id = $1`,
        [group],
      );
      expect(rows).toHaveLength(1);
    });
  });
});
