import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { databaseUrl, sslConfig } from "./connection";
import { createConfirmedUser, rest, serviceRoleKey, type Session } from "./users";

/**
 * The group coordination chain, through the real HTTP API.
 *
 * Written because six browser runs reported the same symptom — a member with
 * sharing on and no published state — and three separate diagnoses of it were
 * wrong. Each was a two-minute round trip through a build, a browser and a
 * parallel suite, which is a bad instrument for locating a fault in a
 * five-step chain.
 *
 * This is the instrument instead. It walks the same steps the server action
 * walks, in order, through PostgREST, as a real signed-in user, and asserts
 * each one. Whichever step is actually broken, this names it in seconds rather
 * than leaving the browser to report only that the last one did not happen.
 *
 * It also covers the half a browser cannot reach: whether the CHECK constraint
 * tying consent to the published word, and the trigger guarding it, behave the
 * same against Supabase's `auth.uid()` as against the local shim. That
 * difference is exactly the kind the local tier cannot see.
 */
describe("hosted group coordination", () => {
  let db: Client;
  let alice: Session;

  let tripId: string;
  let groupId: string;

  beforeAll(async () => {
    const adminKey = await serviceRoleKey();
    alice = await createConfirmedUser(adminKey);

    const url = databaseUrl();
    db = new Client({ connectionString: url, ssl: sslConfig(url) });
    await db.connect();
  });

  afterAll(async () => {
    if (!db) return;
    await db.query(`delete from auth.users where email = $1`, [alice?.email]);
    await db.end();
  });

  it("1. creates a trip", async () => {
    const created = await rest("trips", alice.accessToken, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: alice.userId, destination_city: "Lagos" }),
    });
    expect(created.status, await created.clone().text()).toBeLessThan(300);
    tripId = (await created.json())[0].id;
    expect(tripId).toBeTruthy();
  });

  it("2. adds a traveller whose passport makes readiness checkable", async () => {
    // A far-future expiry with no trip dates yields `ready`, which is one of
    // the four states Iteration 4 counts. Without it the trip's readiness is
    // entirely unknowable and a null state is correct rather than a fault.
    const expiry = new Date(Date.now() + 900 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const created = await rest("travelers", alice.accessToken, {
      method: "POST",
      body: JSON.stringify({
        trip_id: tripId,
        user_id: alice.userId,
        full_name: "Ama Mensah",
        passport_expires_on: expiry,
      }),
    });
    expect(created.status, await created.clone().text()).toBeLessThan(300);
  });

  it("3. creates a group and the creator's own membership", async () => {
    const group = await rest("travel_groups", alice.accessToken, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ owner_id: alice.userId, name: "Probe group" }),
    });
    expect(group.status, await group.clone().text()).toBeLessThan(300);
    groupId = (await group.json())[0].id;

    const membership = await rest("group_memberships", alice.accessToken, {
      method: "POST",
      body: JSON.stringify({
        group_id: groupId,
        user_id: alice.userId,
        role: "owner",
      }),
    });
    expect(membership.status, await membership.clone().text()).toBeLessThan(300);
  });

  it("4. links the trip, and the link reads back", async () => {
    const linked = await rest("group_trips", alice.accessToken, {
      method: "POST",
      body: JSON.stringify({
        group_id: groupId,
        trip_id: tripId,
        user_id: alice.userId,
      }),
    });
    expect(linked.status, await linked.clone().text()).toBeLessThan(300);

    // The read the derivation performs. If this comes back empty the
    // derivation returns null and every downstream symptom follows.
    const read = await rest(
      `group_trips?select=trip_id&group_id=eq.${groupId}&user_id=eq.${alice.userId}`,
      alice.accessToken,
    );
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual([{ trip_id: tripId }]);
  });

  it("5. reads the trip and its travellers back as the derivation does", async () => {
    const trip = await rest(
      `trips?select=id,depart_on,return_on&id=eq.${tripId}`,
      alice.accessToken,
    );
    expect(trip.status).toBe(200);
    expect(await trip.json()).toHaveLength(1);

    const travelers = await rest(
      `travelers?select=id,passport_expires_on&trip_id=eq.${tripId}`,
      alice.accessToken,
    );
    expect(travelers.status).toBe(200);
    const rows = (await travelers.json()) as Array<{
      passport_expires_on: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].passport_expires_on).toBeTruthy();
  });

  it("6. accepts consent and a published state in one write", async () => {
    // The shape the action now uses. If the CHECK constraint or the guard
    // trigger behaves differently against Supabase's auth.uid() than against
    // the local shim, this is where it shows.
    const written = await rest(
      `group_memberships?group_id=eq.${groupId}&user_id=eq.${alice.userId}`,
      alice.accessToken,
      {
        method: "PATCH",
        body: JSON.stringify({
          shares_readiness: true,
          coordination_state: "ready",
          display_name: "Ama",
        }),
      },
    );
    expect(written.status, await written.clone().text()).toBeLessThan(300);

    const read = await rest(
      `group_memberships?select=shares_readiness,coordination_state,display_name` +
        `&group_id=eq.${groupId}&user_id=eq.${alice.userId}`,
      alice.accessToken,
    );
    expect(await read.json()).toEqual([
      { shares_readiness: true, coordination_state: "ready", display_name: "Ama" },
    ]);
  });

  it("7. clears the published word when consent is withdrawn", async () => {
    const written = await rest(
      `group_memberships?group_id=eq.${groupId}&user_id=eq.${alice.userId}`,
      alice.accessToken,
      {
        method: "PATCH",
        body: JSON.stringify({
          shares_readiness: false,
          coordination_state: null,
        }),
      },
    );
    expect(written.status, await written.clone().text()).toBeLessThan(300);

    const read = await rest(
      `group_memberships?select=shares_readiness,coordination_state` +
        `&group_id=eq.${groupId}&user_id=eq.${alice.userId}`,
      alice.accessToken,
    );
    expect(await read.json()).toEqual([
      { shares_readiness: false, coordination_state: null },
    ]);
  });

  it("8. refuses a published word without consent", async () => {
    // The constraint, against the real database rather than the shim.
    const forged = await rest(
      `group_memberships?group_id=eq.${groupId}&user_id=eq.${alice.userId}`,
      alice.accessToken,
      {
        method: "PATCH",
        body: JSON.stringify({ coordination_state: "ready" }),
      },
    );
    expect(forged.status).toBeGreaterThanOrEqual(400);
  });
});
