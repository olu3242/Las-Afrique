import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  asAnon,
  asUser,
  createMigratedDatabase,
  createUser,
  dropDatabase,
} from "@/supabase/test/harness";
import { normaliseEmail } from "@/lib/referrals/attribution";

const DB = "tmh_test_referrals";

/**
 * The referral engine against the real policy predicates.
 *
 * Two claims are being executed rather than described.
 *
 * The first is provenance: a referral says who introduced whom, and a user
 * must not be able to write that themselves. So the adversary here is not a
 * stranger — the pre-existing tenant policies already refuse strangers — but
 * the referred user, who is a legitimate party to the row and has every reason
 * to prefer a different referrer, an earlier touch, or a qualification they
 * have not earned.
 *
 * The second is the privacy boundary: a referrer learns a status and nothing
 * else. That is asserted by pointing the referrer at the referred user's own
 * tables and finding nothing, which is the only form of the assertion that
 * cannot pass by accident.
 */
describe("referral", () => {
  let db: Client;

  // Ama refers. Kofi is referred by her. Zainab is unrelated to either.
  let ama: string;
  let kofi: string;
  let zainab: string;
  let amaAlias: string;

  beforeAll(async () => {
    db = await createMigratedDatabase(DB);
    ama = await createUser(db, "ama@referrals.test");
    kofi = await createUser(db, "kofi@referrals.test");
    zainab = await createUser(db, "zainab@referrals.test");
    // The same mailbox as Ama, wearing a plus tag.
    amaAlias = await createUser(db, "ama+second@referrals.test");

    // Setup runs as superuser: asUser() rolls back, so it cannot seed.
    await db.query(
      `insert into public.referral_codes (user_id, program_key, code)
       values ($1, 'launch', 'AMACODE01'), ($2, 'launch', 'ZAINABCODE')`,
      [ama, zainab],
    );
  });

  afterAll(async () => {
    await db?.end();
    await dropDatabase(DB);
  });

  // -------------------------------------------------------------------------
  // The programme
  // -------------------------------------------------------------------------

  describe("the programme in force", () => {
    it("is readable by a signed-in user", async () => {
      const rows = await asUser(db, kofi, async () => {
        const { rows } = await db.query(
          `select key, qualification_predicate, attribution_window_days,
                  invitation_rate_limit_per_hour
             from public.referral_programs where effective_to is null`,
        );
        return rows;
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        key: "launch",
        qualification_predicate: "first_trip_created",
        attribution_window_days: 30,
        invitation_rate_limit_per_hour: 10,
      });
    });

    it("is not readable by a signed-out visitor", async () => {
      // The link route reads nothing, so anon needs no grant here. Leaving one
      // would be an open door with nothing behind it.
      await asAnon(db, async () => {
        await expect(
          db.query(`select key from public.referral_programs`),
        ).rejects.toThrow(/permission denied/);
      });
    });

    it("cannot be rewritten by a signed-in user", async () => {
      // Versioned, never edited in place — an entitlement earned under one set
      // of rules has to stay interpretable against those rules.
      await asUser(db, ama, async () => {
        await expect(
          db.query(
            `update public.referral_programs set attribution_window_days = 3650`,
          ),
        ).rejects.toThrow(/permission denied/);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Ownership
  // -------------------------------------------------------------------------

  describe("owner-scoped tables", () => {
    it("shows a member only their own code", async () => {
      const rows = await asUser(db, ama, async () => {
        const { rows } = await db.query(`select code from public.referral_codes`);
        return rows;
      });
      expect(rows).toEqual([{ code: "AMACODE01" }]);
    });

    it("refuses a code minted for somebody else", async () => {
      await asUser(db, kofi, async () => {
        await expect(
          db.query(
            `insert into public.referral_codes (user_id, program_key, code)
             values ($1, 'launch', 'STOLENCD1')`,
            [ama],
          ),
        ).rejects.toThrow(/row-level security/);
      });
    });

    it("keeps one code per person per programme", async () => {
      await asUser(db, ama, async () => {
        await expect(
          db.query(
            `insert into public.referral_codes (user_id, program_key, code)
             values ($1, 'launch', 'SECONDCD1')`,
            [ama],
          ),
        ).rejects.toThrow(/referral_codes_one_per_program/);
      });
    });

    it("shows a member only their own invitations", async () => {
      const rows = await asUser(db, ama, async () => {
        await db.query(
          `insert into public.referral_invitations
             (user_id, program_key, email, token_hash)
           values ($1, 'launch', 'guest@elsewhere.test', 'hash-own')`,
          [ama],
        );
        const { rows } = await db.query(
          `select email from public.referral_invitations`,
        );
        return rows;
      });
      expect(rows).toEqual([{ email: "guest@elsewhere.test" }]);
    });

    it("hides one member's invitations from another", async () => {
      await db.query(
        `insert into public.referral_invitations
           (user_id, program_key, email, token_hash)
         values ($1, 'launch', 'private@elsewhere.test', 'hash-private')`,
        [ama],
      );
      const rows = await asUser(db, zainab, async () => {
        const { rows } = await db.query(
          `select email from public.referral_invitations`,
        );
        return rows;
      });
      expect(rows).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Attribution
  // -------------------------------------------------------------------------

  describe("attribution", () => {
    // The touch defaults to a minute ago, because that is the order the real
    // flow happens in: a visitor resolves a link, *then* an account is
    // created. The probe users were created when this suite started, so a
    // touch of `now()` would be a touch that postdates every account — which
    // is precisely the case attribute_referral refuses, and would make these
    // fixtures test the opposite of what they claim.
    async function attribute(
      userId: string,
      candidate: string,
      hash = "no-such-hash",
      touchedAt = "now() - interval '1 minute'",
    ) {
      return asUser(db, userId, async () => {
        const { rows } = await db.query<{ outcome: string }>(
          `select outcome from public.attribute_referral($1, $2, ${touchedAt})`,
          [candidate, hash],
        );
        return rows[0]?.outcome;
      });
    }

    it("attributes a signup to the code that was resolved", async () => {
      expect(await attribute(kofi, "AMACODE01")).toBe("attributed");
    });

    it("accepts a code in whatever case it was typed back in", async () => {
      // A code gets read aloud and typed by hand. Case is not part of it.
      expect(await attribute(kofi, "amacode01")).toBe("attributed");
    });

    it("refuses a referrer their own code", async () => {
      expect(await attribute(ama, "AMACODE01")).toBe("self_referral");
    });

    it("refuses the same person under a second address", async () => {
      // The property a naive `referrer_id <> referred_user_id` check misses:
      // a second account at the same mailbox is the same person, and
      // plus-addressing is the cheapest way to make one.
      expect(await attribute(amaAlias, "AMACODE01")).toBe("self_referral");
    });

    it("refuses a code that does not exist", async () => {
      expect(await attribute(kofi, "NOTACODE1")).toBe("unknown_code");
    });

    it("refuses a touch older than the attribution window", async () => {
      expect(
        await attribute(kofi, "AMACODE01", "no-such-hash", "now() - interval '31 days'"),
      ).toBe("outside_window");
    });

    it("accepts a touch inside the window", async () => {
      expect(
        await attribute(kofi, "AMACODE01", "no-such-hash", "now() - interval '29 days'"),
      ).toBe("attributed");
    });

    it("gains nothing from a touch forged into the future", async () => {
      // The timestamp lives in the visitor's own cookie, so it is untrusted.
      // Clamping it to now() is what makes a forged one useless: the touch
      // then postdates the account, and the account-age rule below refuses it.
      // Either refusal is fine; what must never happen is that editing a
      // cookie buys an attribution.
      expect(
        await attribute(kofi, "AMACODE01", "no-such-hash", "now() + interval '400 days'"),
      ).toBe("existing_account");
    });

    it("attributes through an invitation token, and closes the invitation", async () => {
      const outcome = await asUser(db, kofi, async () => {
        const { rows } = await db.query<{ outcome: string }>(
          `select outcome from public.attribute_referral('opaque', 'hash-private', now() - interval '1 minute')`,
        );
        const { rows: invite } = await db.query<{ state: string }>(
          `select state from public.referral_invitations
            where token_hash = 'hash-private'`,
        );
        // The invitee has no read on invitations, so this comes back empty —
        // which is itself the assertion that the token, not a select, is the
        // authorization.
        expect(invite).toEqual([]);
        return rows[0]?.outcome;
      });
      expect(outcome).toBe("attributed");
    });

    it("never stores the invitation token, only the referrer's own code", async () => {
      // The defect migration 0014 fixes. `referral_invitations.token_hash`
      // exists so that reading a row never yields a working credential; the
      // first version of attribute_referral wrote the plaintext token into
      // `referrals.code`, which both parties can read, undoing exactly that.
      await db.query(
        `insert into public.referral_invitations
           (user_id, program_key, email, token_hash)
         values ($1, 'launch', 'tokencheck@elsewhere.test', 'hash-token-check')`,
        [ama],
      );

      const row = await asUser(db, kofi, async () => {
        await db.query(
          `select public.attribute_referral('super-secret-token', 'hash-token-check',
                                            now() - interval '1 minute')`,
        );
        const { rows } = await db.query<{
          code: string | null;
          invitation_id: string | null;
        }>(`select code, invitation_id from public.referrals`);
        return rows[0];
      });

      expect(row.code).not.toBe("super-secret-token");
      // The referrer's own code is the meaningful provenance, and is not a
      // secret. The invitation path is recorded by invitation_id.
      expect(row.code).toBe("AMACODE01");
      expect(row.invitation_id).toBeTruthy();
    });

    it("records a null code rather than inventing one when the referrer has none", async () => {
      // A referrer who invited without ever minting a code. Null is honest;
      // the alternative was a placeholder that reads like a real code.
      await db.query(
        `insert into public.referral_invitations
           (user_id, program_key, email, token_hash)
         values ($1, 'launch', 'nocode@elsewhere.test', 'hash-no-code')`,
        [amaAlias],
      );

      const row = await asUser(db, kofi, async () => {
        await db.query(
          `select public.attribute_referral('another-secret', 'hash-no-code',
                                            now() - interval '1 minute')`,
        );
        const { rows } = await db.query<{ code: string | null }>(
          `select code from public.referrals`,
        );
        return rows[0];
      });

      expect(row?.code).toBeNull();
    });

    it("refuses an invitation that has expired", async () => {
      await db.query(
        `insert into public.referral_invitations
           (user_id, program_key, email, token_hash, expires_at)
         values ($1, 'launch', 'lapsed@elsewhere.test', 'hash-lapsed',
                 now() - interval '1 day')`,
        [ama],
      );
      const outcome = await asUser(db, kofi, async () => {
        const { rows } = await db.query<{ outcome: string }>(
          `select outcome from public.attribute_referral('opaque', 'hash-lapsed', now() - interval '1 minute')`,
        );
        return rows[0]?.outcome;
      });
      expect(outcome).toBe("expired_invitation");
    });

    it("attributes a referred user exactly once, ever", async () => {
      const outcomes = await asUser(db, kofi, async () => {
        const first = await db.query<{ outcome: string }>(
          `select outcome from public.attribute_referral('AMACODE01', 'x', now() - interval '1 minute')`,
        );
        const second = await db.query<{ outcome: string }>(
          `select outcome from public.attribute_referral('ZAINABCODE', 'x', now() - interval '1 minute')`,
        );
        return [first.rows[0]?.outcome, second.rows[0]?.outcome];
      });
      // The second link does not re-point the attribution at Zainab. One
      // referred user, one referrer, for all time.
      expect(outcomes).toEqual(["attributed", "already_attributed"]);
    });

    it("refuses a touch that predates the account", async () => {
      // The rule that makes it safe to attempt attribution at sign-in as well
      // as at signup — which the engine must do, because a project with email
      // confirmation enabled returns no session from signup at all. Without
      // this, every sign-in would be a chance to credit a referrer for a user
      // who has been here for a year.
      // A year-old account, and a touch from a minute ago: inside the window,
      // but the person was plainly not introduced by it.
      await db.query(
        `update auth.users set created_at = now() - interval '1 year'
          where id = $1`,
        [kofi],
      );

      expect(await attribute(kofi, "AMACODE01")).toBe("existing_account");

      // Move the account back to after the touch and the same call attributes,
      // which is what shows the refusal came from the age rule and not from
      // something incidental.
      await db.query(
        `update auth.users set created_at = now() - interval '30 seconds'
          where id = $1`,
        [kofi],
      );
      expect(await attribute(kofi, "AMACODE01")).toBe("attributed");
    });

    it("refuses an attribution asserted directly, without the definer path", async () => {
      // The whole point. If this succeeded, anybody could credit anybody.
      await asUser(db, kofi, async () => {
        await expect(
          db.query(
            `insert into public.referrals
               (program_key, referrer_id, referred_user_id, code, touched_at)
             values ('launch', $1, $2, 'FORGED001', now())`,
            [ama, kofi],
          ),
        ).rejects.toThrow(/permission denied|row-level security/);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Qualification
  // -------------------------------------------------------------------------

  describe("qualification", () => {
    it("walks joined → qualified and mints one entitlement for the referrer", async () => {
      const result = await asUser(db, kofi, async () => {
        await db.query(
          `select public.attribute_referral('AMACODE01', 'x', now() - interval '1 minute')`,
        );

        const before = await db.query<{ outcome: string }>(
          `select outcome from public.evaluate_referral_qualification()`,
        );

        await db.query(
          `insert into public.trips (user_id, destination_city)
           values ($1, 'Lagos')`,
          [kofi],
        );

        const after = await db.query<{ outcome: string }>(
          `select outcome from public.evaluate_referral_qualification()`,
        );
        const again = await db.query<{ outcome: string }>(
          `select outcome from public.evaluate_referral_qualification()`,
        );

        // What the caller can see of the entitlement they just caused: nothing.
        // It belongs to the referrer, and Kofi is not the referrer.
        const { rows: visibleToCaller } = await db.query(
          `select id from public.reward_entitlements`,
        );

        // Then look at what was actually written. Dropping back to the table
        // owner inside the same transaction is the only way to tell "no row"
        // apart from "a row this seat cannot see" — the distinction a CDN-
        // cached 200 hid in Iteration 8, and the reason that read is made
        // explicitly rather than inferred from the caller's empty result.
        await db.query("reset role");
        const { rows: entitlements } = await db.query<{
          user_id: string;
          reward_policy_key: string;
        }>(`select user_id, reward_policy_key from public.reward_entitlements`);

        return {
          before: before.rows[0]?.outcome,
          after: after.rows[0]?.outcome,
          again: again.rows[0]?.outcome,
          visibleToCaller,
          entitlements,
        };
      });

      // Not qualified until the qualifying thing actually happened.
      expect(result.before).toBe("not_yet");
      expect(result.after).toBe("qualified");
      // Idempotent: a second evaluation settles nothing further and mints
      // nothing further.
      expect(result.again).toBe("already_settled");
      // The entitlement belongs to the referrer, who is not the caller — which
      // is the second reason this cannot be a policy-guarded client write, and
      // why the person who triggered it cannot read what they triggered.
      expect(result.visibleToCaller).toEqual([]);
      expect(result.entitlements).toEqual([
        { user_id: ama, reward_policy_key: "recognition-only" },
      ]);
    });

    it("reports no referral for someone who was never referred", async () => {
      const outcome = await asUser(db, zainab, async () => {
        const { rows } = await db.query<{ outcome: string }>(
          `select outcome from public.evaluate_referral_qualification()`,
        );
        return rows[0]?.outcome;
      });
      expect(outcome).toBe("no_referral");
    });

    it("cannot be claimed by asserting the row", async () => {
      await asUser(db, kofi, async () => {
        await db.query(`select public.attribute_referral('AMACODE01', 'x', now() - interval '1 minute')`);
        await expect(
          db.query(
            `update public.referrals set state = 'qualified', qualified_at = now()`,
          ),
        ).rejects.toThrow(/permission denied|row-level security/);
      });
    });

    it("refuses an entitlement written by hand", async () => {
      await asUser(db, ama, async () => {
        await expect(
          db.query(
            `insert into public.reward_entitlements
               (user_id, referral_id, program_key, reward_policy_key)
             values ($1, gen_random_uuid(), 'launch', 'anything')`,
            [ama],
          ),
        ).rejects.toThrow(/permission denied|row-level security|violates foreign key/);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Immutability and reversal
  // -------------------------------------------------------------------------

  describe("attribution is immutable once written", () => {
    it("refuses to re-point a referral at a different referrer", async () => {
      await db.query(
        `insert into public.referrals
           (program_key, referrer_id, referred_user_id, code, touched_at)
         values ('launch', $1, $2, 'AMACODE01', now())`,
        [ama, kofi],
      );

      await expect(
        db.query(`update public.referrals set referrer_id = $1`, [zainab]),
      ).rejects.toThrow(/referral_attribution_is_immutable/);
    });

    it("refuses to walk a qualified referral back to joined", async () => {
      await db.query(
        `update public.referrals set state = 'qualified', qualified_at = now()`,
      );
      await expect(
        db.query(`update public.referrals set state = 'joined'`),
      ).rejects.toThrow(/referral_qualification_is_terminal/);
    });

    it("allows a reversal, and keeps the record", async () => {
      // A reversal is a state with a reason and a timestamp, not a deletion.
      // An entitlement that silently vanishes is indistinguishable from a bug.
      await db.query(
        `update public.referrals
            set state = 'disqualified', disqualified_at = now(),
                disqualified_reason = 'ring detected'`,
      );
      const { rows } = await db.query<{ state: string; reason: string }>(
        `select state, disqualified_reason as reason from public.referrals`,
      );
      expect(rows[0]).toMatchObject({ state: "disqualified", reason: "ring detected" });

      await expect(
        db.query(`update public.referrals set state = 'qualified'`),
      ).rejects.toThrow(/referral_disqualification_is_terminal/);

      await db.query(`delete from public.referrals`);
    });
  });

  // -------------------------------------------------------------------------
  // The privacy boundary
  // -------------------------------------------------------------------------

  describe("the privacy boundary", () => {
    let kofiTrip: string;

    beforeAll(async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.trips (user_id, destination_city, depart_on)
         values ($1, 'Accra', '2027-01-01') returning id`,
        [kofi],
      );
      kofiTrip = rows[0].id;
      await db.query(
        `insert into public.travelers (trip_id, user_id, full_name)
         values ($1, $2, 'Kofi Mensah')`,
        [kofiTrip, kofi],
      );
      await db.query(
        `insert into public.referrals
           (program_key, referrer_id, referred_user_id, code, touched_at, state,
            qualified_at)
         values ('launch', $1, $2, 'AMACODE01', now(), 'qualified', now())`,
        [ama, kofi],
      );
    });

    it("lets both parties read the referral", async () => {
      const asReferrer = await asUser(db, ama, async () => {
        const { rows } = await db.query(`select state from public.referrals`);
        return rows;
      });
      const asReferred = await asUser(db, kofi, async () => {
        const { rows } = await db.query(`select state from public.referrals`);
        return rows;
      });
      // The referred user can always see who was credited for introducing
      // them. Being the subject of an attribution you cannot inspect is not a
      // position to put someone in.
      expect(asReferrer).toEqual([{ state: "qualified" }]);
      expect(asReferred).toEqual([{ state: "qualified" }]);
    });

    it("shows a third party nothing", async () => {
      const rows = await asUser(db, zainab, async () => {
        const { rows } = await db.query(`select state from public.referrals`);
        return rows;
      });
      expect(rows).toEqual([]);
    });

    it("gives the referrer no read of the referred user's trip", async () => {
      // The assertion that matters, and the one that cannot pass by accident:
      // point the referrer straight at the tables and find nothing.
      const found = await asUser(db, ama, async () => {
        const trips = await db.query(`select id from public.trips`);
        const travelers = await db.query(`select id from public.travelers`);
        const documents = await db.query(`select id from public.document_records`);
        const vault = await db.query(`select id from public.vault_files`);
        const budgets = await db.query(`select id from public.cost_estimates`);
        return [
          trips.rowCount,
          travelers.rowCount,
          documents.rowCount,
          vault.rowCount,
          budgets.rowCount,
        ];
      });
      expect(found).toEqual([0, 0, 0, 0, 0]);
    });

    it("gives the referrer no read of the referred user's profile", async () => {
      const rows = await asUser(db, ama, async () => {
        const { rows } = await db.query(
          `select id from public.profiles where id = $1`,
          [kofi],
        );
        return rows;
      });
      expect(rows).toEqual([]);
    });

    it("still refuses a qualified referral entitlement to a third party", async () => {
      await db.query(
        `insert into public.reward_entitlements
           (user_id, referral_id, program_key, reward_policy_key)
         select $1, r.id, 'launch', 'recognition-only' from public.referrals r`,
        [ama],
      );
      const rows = await asUser(db, zainab, async () => {
        const { rows } = await db.query(
          `select reward_policy_key from public.reward_entitlements`,
        );
        return rows;
      });
      expect(rows).toEqual([]);
      await db.query(`delete from public.reward_entitlements`);
      await db.query(`delete from public.referrals`);
    });
  });

  // -------------------------------------------------------------------------
  // Abuse controls
  // -------------------------------------------------------------------------

  describe("invitation flooding", () => {
    it("counts attempts, so a refused one is not free", async () => {
      // The approved decision, and the half a row count cannot express: "10
      // invitation attempts per referrer per rolling hour. Refused attempts
      // count toward the limit so invalid-address probing cannot bypass it."
      //
      // The original implementation counted rows in referral_invitations. A
      // refused insert leaves no row, so a prober could submit addresses
      // indefinitely and learn from the refusals which ones a referrer had
      // already invited.
      const outcomes = await asUser(db, zainab, async () => {
        const seen: string[] = [];
        for (let i = 0; i < 11; i += 1) {
          const { rows } = await db.query<{ outcome: string }>(
            `select outcome from public.claim_referral_invitation_attempt()`,
          );
          seen.push(rows[0].outcome);
        }
        return seen;
      });

      expect(outcomes.slice(0, 10).every((o) => o === "allowed")).toBe(true);
      expect(outcomes[10]).toBe("rate_limited");
    });

    it("charges an attempt even when the invitation itself is refused", async () => {
      const used = await asUser(db, zainab, async () => {
        // A claim, then an insert that the duplicate index refuses.
        await db.query(`select public.claim_referral_invitation_attempt()`);
        await db.query(
          `insert into public.referral_invitations
             (user_id, program_key, email, token_hash)
           values ($1, 'launch', 'probe@elsewhere.test', 'probe-a')`,
          [zainab],
        );

        await db.query(`select public.claim_referral_invitation_attempt()`);

        // The refused insert, inside a savepoint.
        //
        // In the running app the claim and the insert are separate requests
        // and therefore separate transactions, so a refused insert cannot take
        // the attempt with it. This harness runs one transaction per `asUser`,
        // where a failed statement aborts everything after it — the savepoint
        // is what reproduces the production boundary rather than testing an
        // artefact of the harness.
        await db.query("savepoint probe");
        await expect(
          db.query(
            `insert into public.referral_invitations
               (user_id, program_key, email, token_hash)
             values ($1, 'launch', 'probe@elsewhere.test', 'probe-b')`,
            [zainab],
          ),
        ).rejects.toThrow(/one_pending_per_address/);
        await db.query("rollback to savepoint probe");

        // The attempt claimed before it is still on the record.
        const { rows } = await db.query<{ count: string }>(
          `select count(*) as count from public.referral_invitation_attempts
            where user_id = $1`,
          [zainab],
        );
        return Number(rows[0].count);
      });

      expect(used).toBeGreaterThanOrEqual(2);
    });

    it("keeps a member's attempts to themselves, and unwritable", async () => {
      await db.query(
        `insert into public.referral_invitation_attempts (user_id, program_key)
         values ($1, 'launch')`,
        [zainab],
      );

      const seen = await asUser(db, ama, async () => {
        const { rows } = await db.query(
          `select id from public.referral_invitation_attempts`,
        );
        return rows;
      });
      expect(seen).toEqual([]);

      // A rate limit whose rows the limited party can delete is not one.
      await asUser(db, zainab, async () => {
        await expect(
          db.query(`delete from public.referral_invitation_attempts`),
        ).rejects.toThrow(/permission denied|row-level security/);
      });

      await db.query(`delete from public.referral_invitation_attempts`);
    });

    it("still bounds a direct insert that claimed no attempt", async () => {
      // The trigger is no longer the primary gate, but it must still hold for
      // any path that reaches the table without going through the claim.
      await asUser(db, zainab, async () => {
        for (let i = 0; i < 10; i += 1) {
          await db.query(
            `insert into public.referral_invitations
               (user_id, program_key, email, token_hash)
             values ($1, 'launch', $2, $3)`,
            [zainab, `flood${i}@elsewhere.test`, `flood-${i}`],
          );
        }
        await expect(
          db.query(
            `insert into public.referral_invitations
               (user_id, program_key, email, token_hash)
             values ($1, 'launch', 'onemore@elsewhere.test', 'flood-11')`,
            [zainab],
          ),
        ).rejects.toThrow(/referral_invitation_rate_limit/);
      });
    });

    it("refuses a second pending invitation to the same mailbox", async () => {
      await asUser(db, zainab, async () => {
        await db.query(
          `insert into public.referral_invitations
             (user_id, program_key, email, token_hash)
           values ($1, 'launch', 'Ama.Mensah@gmail.com', 'dup-a')`,
          [zainab],
        );
        // A plus tag and a dot are the two cheapest ways to make one address
        // look like two at a provider that treats them as one.
        await expect(
          db.query(
            `insert into public.referral_invitations
               (user_id, program_key, email, token_hash)
             values ($1, 'launch', 'amamensah+later@gmail.com', 'dup-b')`,
            [zainab],
          ),
        ).rejects.toThrow(/one_pending_per_address/);
      });
    });
  });

  // -------------------------------------------------------------------------
  // The duplicated rule
  // -------------------------------------------------------------------------

  it("normalises an address identically in SQL and in TypeScript", async () => {
    // `normaliseEmail` in lib/referrals/attribution.ts is a deliberate copy of
    // `public.normalise_email`. Two copies of a rule is a defect if they can
    // disagree silently, so this is the test that stops them: the form's
    // warning and the database's refusal must mean the same thing.
    const fixtures = [
      "Ama.Mensah+home@Gmail.com",
      "ama.mensah@googlemail.com",
      "a.b+tag@outlook.com",
      "PLAIN@example.com",
      "  spaced@example.com  ",
      "no-at-sign",
    ];

    const { rows } = await db.query<{ input: string; normalised: string }>(
      `select x as input, public.normalise_email(x) as normalised
         from unnest($1::text[]) as x`,
      [fixtures],
    );

    for (const row of rows) {
      expect(normaliseEmail(row.input), row.input).toBe(row.normalised);
    }
  });
});
