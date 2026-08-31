import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { databaseUrl, sslConfig } from "./connection";
import { createConfirmedUser, rest, serviceRoleKey, type Session } from "./users";

/**
 * The referral chain, through the real HTTP API.
 *
 * This is the instrument, written the way Iteration 11's was and for the same
 * reason. When a browser journey fails at the last step, it reports only that
 * a page did not show something — equally true whether the write failed, the
 * read failed, or the render did. Nine runs went to guessing which.
 *
 * So each step of the chain is walked in order, as a real signed-in user,
 * through PostgREST, and asserted on its own. Whichever step is actually
 * broken, this names it in seconds.
 *
 * It also covers the half a browser cannot reach: whether the definer
 * functions, the CHECK constraints and the guard triggers behave the same
 * against Supabase's `auth.uid()` and its non-superuser `postgres` role as
 * they do against the local shim. That difference is exactly the kind the
 * local tier cannot see — a definer function that writes fine locally because
 * it is owned by a superuser, and is refused by `force row level security` on
 * a project where it is not.
 */
describe("hosted referral", () => {
  let db: Client;
  let referrer: Session;
  let referred: Session;
  let stranger: Session;

  let code: string;
  let invitationToken: string;

  function hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  beforeAll(async () => {
    const adminKey = await serviceRoleKey();
    referrer = await createConfirmedUser(adminKey);
    stranger = await createConfirmedUser(adminKey);

    const url = databaseUrl();
    db = new Client({ connectionString: url, ssl: sslConfig(url) });
    await db.connect();
  });

  afterAll(async () => {
    if (!db) return;
    for (const email of [referrer?.email, referred?.email, stranger?.email]) {
      if (email) {
        await db.query(`delete from auth.users where email = $1`, [email]);
      }
    }
    await db.end();
  });

  it("1. exposes exactly one programme in force to a signed-in user", async () => {
    const response = await rest(
      "referral_programs?select=key,qualification_predicate,attribution_window_days,invitation_rate_limit_per_day&effective_to=is.null",
      referrer.accessToken,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const rows = await response.json();
    expect(rows).toEqual([
      {
        key: "launch",
        qualification_predicate: "first_trip_created",
        attribution_window_days: 30,
        invitation_rate_limit_per_day: 20,
      },
    ]);
  });

  it("2. mints a referral code, and refuses a second for the same programme", async () => {
    code = `HOSTED${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const created = await rest("referral_codes", referrer.accessToken, {
      method: "POST",
      body: JSON.stringify({
        user_id: referrer.userId,
        program_key: "launch",
        code,
      }),
    });
    expect(created.status, await created.clone().text()).toBeLessThan(300);

    // Idempotency, in the schema rather than in a read-then-write.
    const again = await rest("referral_codes", referrer.accessToken, {
      method: "POST",
      body: JSON.stringify({
        user_id: referrer.userId,
        program_key: "launch",
        code: `${code}X`,
      }),
    });
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  it("3. creates an invitation, storing only the token's hash", async () => {
    invitationToken = `tok-${Math.random().toString(36).slice(2)}-${Date.now()}`;

    const created = await rest("referral_invitations", referrer.accessToken, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: referrer.userId,
        program_key: "launch",
        email: `invitee-${Date.now()}@takemehome-probe.dev`,
        token_hash: hash(invitationToken),
      }),
    });
    expect(created.status, await created.clone().text()).toBeLessThan(300);

    const [row] = (await created.json()) as Array<{
      token_hash: string;
      email_normalised: string;
      email: string;
    }>;
    // The row a sender can read must not hand them a working credential.
    expect(row.token_hash).not.toContain(invitationToken);
    // The generated column ran on the hosted project, not just locally.
    expect(row.email_normalised).toBe(row.email.toLowerCase());
  });

  it("4. refuses a signed-in stranger any sight of that invitation", async () => {
    const response = await rest(
      "referral_invitations?select=email",
      stranger.accessToken,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("5. attributes a new account through the invitation token", async () => {
    // Created now, after the touch below — the order the engine requires and
    // the order a real person follows.
    const adminKey = await serviceRoleKey();
    const touchedAt = new Date(Date.now() - 60_000).toISOString();
    referred = await createConfirmedUser(adminKey);

    const response = await rest("rpc/attribute_referral", referred.accessToken, {
      method: "POST",
      body: JSON.stringify({
        candidate: "opaque",
        hashed_token: hash(invitationToken),
        touched_at: touchedAt,
      }),
    });
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    const rows = (await response.json()) as Array<{ outcome: string }>;
    expect(rows[0]?.outcome).toBe("attributed");
  });

  it("6. shows the referral to both parties and to nobody else", async () => {
    const asReferrer = await rest(
      "referrals?select=state,code",
      referrer.accessToken,
    );
    const asReferred = await rest(
      "referrals?select=state,code",
      referred.accessToken,
    );
    const asStranger = await rest(
      "referrals?select=state,code",
      stranger.accessToken,
    );

    expect(await asReferrer.json()).toHaveLength(1);
    // The referred user can always see who was credited for introducing them.
    expect(await asReferred.json()).toHaveLength(1);
    expect(await asStranger.json()).toEqual([]);
  });

  it("7. refuses an attribution asserted directly", async () => {
    // The property the whole engine rests on. If PostgREST accepts this,
    // anybody can credit anybody, and provenance means nothing.
    const forged = await rest("referrals", stranger.accessToken, {
      method: "POST",
      body: JSON.stringify({
        program_key: "launch",
        referrer_id: stranger.userId,
        referred_user_id: referred.userId,
        code: "FORGED001",
        touched_at: new Date().toISOString(),
      }),
    });
    expect(forged.status).toBeGreaterThanOrEqual(400);
  });

  it("8. refuses a second attribution of the same person", async () => {
    const response = await rest("rpc/attribute_referral", referred.accessToken, {
      method: "POST",
      body: JSON.stringify({
        candidate: code,
        hashed_token: "no-such-hash",
        touched_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    });
    expect(response.status).toBeLessThan(300);
    const rows = (await response.json()) as Array<{ outcome: string }>;
    expect(rows[0]?.outcome).toBe("already_attributed");
  });

  it("9. reports not_yet until the qualifying action has happened", async () => {
    const response = await rest(
      "rpc/evaluate_referral_qualification",
      referred.accessToken,
      { method: "POST", body: "{}" },
    );
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    const rows = (await response.json()) as Array<{ outcome: string }>;
    expect(rows[0]?.outcome).toBe("not_yet");
  });

  it("10. qualifies once a trip exists, and is idempotent", async () => {
    const trip = await rest("trips", referred.accessToken, {
      method: "POST",
      body: JSON.stringify({
        user_id: referred.userId,
        destination_city: "Lagos",
      }),
    });
    expect(trip.status, await trip.clone().text()).toBeLessThan(300);

    const first = await rest(
      "rpc/evaluate_referral_qualification",
      referred.accessToken,
      { method: "POST", body: "{}" },
    );
    expect(((await first.json()) as Array<{ outcome: string }>)[0]?.outcome).toBe(
      "qualified",
    );

    // Twice. This is where a definer function that mints an entitlement per
    // call would show up, and where the unique constraint on referral_id is
    // the thing actually preventing it.
    const second = await rest(
      "rpc/evaluate_referral_qualification",
      referred.accessToken,
      { method: "POST", body: "{}" },
    );
    expect(((await second.json()) as Array<{ outcome: string }>)[0]?.outcome).toBe(
      "already_settled",
    );
  });

  it("11. gives the referrer exactly one entitlement, carrying no amount", async () => {
    const response = await rest(
      "reward_entitlements?select=reward_policy_key,earned_at,revoked_at",
      referrer.accessToken,
    );
    expect(response.status).toBe(200);
    const rows = (await response.json()) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].reward_policy_key).toBe("recognition-only");

    // Read the whole row back and assert on its shape: PRD §8 says the product
    // holds no money, and the moment a column here carries an amount it is
    // recording a liability.
    const full = await rest("reward_entitlements", referrer.accessToken);
    const [entitlement] = (await full.json()) as Array<Record<string, unknown>>;
    for (const key of Object.keys(entitlement)) {
      expect(key, `entitlement must not carry ${key}`).not.toMatch(
        /amount|balance|currency|owed|payout|settle|transfer/i,
      );
    }
  });

  it("12. shows the referred user's trip to nobody but them", async () => {
    // The privacy boundary, at the API rather than in a rendered page. A
    // referrer with a qualified referral still gets nothing.
    const asReferrer = await rest(
      "trips?select=id,destination_city",
      referrer.accessToken,
    );
    expect(asReferrer.status).toBe(200);
    expect(await asReferrer.json()).toEqual([]);

    for (const table of ["travelers", "document_records", "vault_files", "cost_estimates"]) {
      const response = await rest(`${table}?select=id`, referrer.accessToken);
      expect(await response.json(), `${table} must stay private`).toEqual([]);
    }
  });

  it("13. refuses to re-point a qualified attribution", async () => {
    // The immutability trigger, against the real database rather than the
    // shim. An attribution may be reversed; it may never change hands.
    const repointed = await rest(
      `referrals?referred_user_id=eq.${referred.userId}`,
      referred.accessToken,
      {
        method: "PATCH",
        body: JSON.stringify({ referrer_id: stranger.userId }),
      },
    );
    expect(repointed.status).toBeGreaterThanOrEqual(400);
  });
});
