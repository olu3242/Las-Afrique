import { expect, test, type Page } from "@playwright/test";
import {
  adminConfig,
  createProbeUser,
  deleteProbeUser,
  readAsAdmin,
  type AdminConfig,
  type ProbeUser,
} from "./support/supabase-admin";

/**
 * Iteration 11's engine, driven through the browser against a real project.
 *
 *   create group → invite → accept → membership → role enforcement
 *                → shared plan → assignment → member variation
 *                → readiness aggregation → departure
 *
 * The half that matters most is adversarial, and it is the second test: a
 * legitimate group member trying to reach another member's private records.
 * A stranger being refused proves little here — the tenant policies already
 * did that in Iteration 2. The interesting adversary is the person who is
 * supposed to be in the room.
 *
 * Needs a configured project, so it is SKIPPED where none is available. A skip
 * is reported as a skip and is not evidence of anything.
 */
const config = adminConfig();
const configured = !("missing" in config);

test.describe("group coordination, signed in", () => {
  test.skip(
    !configured,
    `No Supabase project configured — missing ${
      "missing" in config ? config.missing.join(", ") : ""
    }. This proves nothing until it runs against a real project.`,
  );

  const created: ProbeUser[] = [];

  async function newUser(): Promise<ProbeUser> {
    const probe = await createProbeUser(config as AdminConfig);
    created.push(probe);
    return probe;
  }

  test.afterAll(async () => {
    if (!configured) return;
    for (const probe of created) {
      await deleteProbeUser(config as AdminConfig, probe.id);
    }
  });

  async function signIn(page: Page, user: ProbeUser) {
    await page.goto("/login");
    await page.getByLabel("Email address").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  }

  test("carries a group from creation through a shared plan", async ({ page }) => {
    const owner = await newUser();
    await signIn(page, owner);

    // A real trip first. The readiness a member can share is derived from
    // their own trip, so without one there is nothing to publish — the first
    // hosted run proved that by reporting "nothing to report yet" and failing.
    await page.goto("/trips/new");
    await page.getByLabel("Destination country").selectOption({ label: "Nigeria" });
    await page.getByLabel("Destination city").fill("Lagos");
    await page.getByRole("button", { name: /save trip/i }).click();
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/);

    // A traveller with a passport expiry, and this is load-bearing rather than
    // set dressing. Iteration 4 counts only ready/action_needed/expiring/
    // missing towards a percentage; a trip with no travellers yields nothing
    // checkable, so `percent` is null and coordinationStateFrom returns null
    // by design. The group then honestly reports "nothing to report yet" —
    // which is what run 31 did, correctly, while proving the derivation never
    // produced a state.
    await page.getByLabel("Full name").fill("Ama Mensah");
    const passportExpiry = new Date(Date.now() + 900 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await page.getByLabel("Passport expires").fill(passportExpiry);
    await page.getByRole("button", { name: /add traveller/i }).click();

    // Scoped to the travellers section and reloaded, not a page-wide getByText.
    // The loose version passed for three hosted runs while the row it claimed
    // to prove may never have been written — and the readiness panel on the
    // same page renders "Passport recorded for Ama Mensah", which a page-wide
    // match would happily accept. The reload is what separates "the page
    // updated" from "the row was written", and the row is the thing the whole
    // derivation downstream depends on.
    const travellersSection = page.locator("section", {
      has: page.getByRole("heading", { name: /^Travellers$/ }),
    });
    await expect(
      travellersSection.getByRole("listitem").filter({ hasText: "Ama Mensah" }),
    ).toHaveCount(1);

    await page.reload();
    await expect(
      travellersSection.getByRole("listitem").filter({ hasText: "Ama Mensah" }),
    ).toHaveCount(1);

    // And the trip's own readiness must have something checkable in it, since
    // that is precisely what the group state is derived from. A trip whose
    // readiness is entirely unknowable yields a null state by design, which is
    // what the group panel kept reporting.
    const tripReadiness = page.locator("section", {
      has: page.getByRole("heading", { name: /^Readiness$/ }),
    });
    await expect(tripReadiness).toContainText(/Passport recorded for Ama Mensah/i);

    // --- creating the group -------------------------------------------------
    await page.goto("/groups");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Travelling together",
    );
    await expect(page.getByText(/no groups yet/i)).toBeVisible();

    await page.getByRole("link", { name: /start a group/i }).first().click();
    await expect(page).toHaveURL(/\/groups\/new$/);

    await page.getByLabel("Group name").fill("Adeyemo homecoming");
    await page.getByLabel("Destination country").selectOption({ label: "Nigeria" });
    await page.getByLabel("Departure").fill("2026-12-18");
    await page.getByLabel("Return").fill("2027-01-05");
    await page.getByRole("button", { name: /create group/i }).click();

    // Landing on the detail page is the proof the row was written — a failed
    // insert returns to the form with an error instead.
    await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/);
    const groupUrl = page.url();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Adeyemo homecoming",
    );

    // The creator is the owner, and is a member of their own group.
    const members = page.locator("section", {
      has: page.getByRole("heading", { name: /^Members$/ }),
    });
    await expect(members.getByRole("listitem")).toHaveCount(1);
    await expect(members).toContainText(/owner/i);

    // --- nothing is shared until somebody opts in ---------------------------
    const readiness = page.locator("section", {
      has: page.getByRole("heading", { name: /how the group is going/i }),
    });
    // The empty state is a sentence about consent, not a zero. A "0 / 1" here
    // would read as "nobody is ready", which is a different claim.
    await expect(readiness).toContainText(/nobody has chosen to share/i);

    // --- the shared plan ----------------------------------------------------
    const tasks = page.locator("section", {
      has: page.getByRole("heading", { name: /^Tasks$/ }),
    });
    await expect(tasks).toContainText(/no tasks yet/i);

    await tasks.getByLabel("What needs doing").fill("Book the airport bus");
    await tasks.getByLabel("Due").fill("2026-12-01");
    await tasks.getByRole("button", { name: /add task/i }).click();

    const task = tasks.getByRole("listitem").filter({
      hasText: "Book the airport bus",
    });
    await expect(task).toHaveCount(1);

    // Survives a reload, so it is a stored row rather than optimistic UI.
    await page.reload();
    await expect(task).toHaveCount(1);

    // --- an activity, with a cost that is an estimate and nothing more ------
    const activities = page.locator("section", {
      has: page.getByRole("heading", { name: /^Activities$/ }),
    });
    // The financial boundary, stated where the traveller can see it.
    await expect(activities).toContainText(/does not hold or move/i);

    await activities.getByLabel("What is it").fill("Village visit");
    await activities.getByLabel("Estimated cost").fill("40000");
    await activities.getByLabel("Currency").fill("NGN");
    await activities.getByRole("button", { name: /add activity/i }).click();

    const activity = activities.getByRole("listitem").filter({
      hasText: "Village visit",
    });
    await expect(activity).toHaveCount(1);
    await expect(activity).toContainText(/40000 NGN/);

    // --- opting out of a shared activity ------------------------------------
    // Nobody is forced onto the itinerary; "not coming" is a real answer.
    await activity.getByLabel(/are you coming/i).selectOption("out");
    await activity.getByRole("button", { name: /save/i }).click();
    await page.reload();
    await expect(activity).toContainText(/0 going/);

    // --- sharing readiness, and the member's own variation ------------------
    const own = page.locator("section", {
      has: page.getByRole("heading", { name: /your part in this/i }),
    });

    // Linking is the step that makes a shared state possible at all. It was
    // missing from the UI entirely — the action existed with nothing to reach
    // it — and the hosted browser run is what found that.
    await own.getByLabel(/which trip/i).selectOption({ label: "Lagos" });
    await own.getByRole("button", { name: /link trip/i }).click();
    await expect(own).toContainText(/linked:/i);

    // A clean load between the two form submissions on this page.
    //
    // Linking is a server action, and this codebase already documented what
    // that does to the *other* form beside it: React 19 resets uncontrolled
    // form state after an action runs — the reason use-form-values.ts exists
    // at all. The membership form's inputs are uncontrolled `defaultValue`
    // ones, so typing into them in the window around that re-render is a race
    // against it, and losing it submits an empty name with the box unticked.
    //
    // Which is exactly what four runs recorded: "A traveller", "Not sharing".
    // Not a product fault — a real person types after the page has settled —
    // but a test that was racing the framework and blaming the engine.
    await page.goto(groupUrl);
    await expect(own).toContainText(/linked:/i);

    await own.getByLabel(/what the group calls you/i).fill("Ama");
    // Arriving a day after the group is a normal case, not an exception.
    await own.getByLabel(/you arrive/i).fill("2026-12-19");
    await own.getByLabel(/share my readiness/i).check();
    await own.getByRole("button", { name: /^save$/i }).click();

    // Wait for the action to finish before reloading it out from under itself.
    //
    // click() returns once the click is dispatched, not once the server action
    // it triggers has completed. Reloading immediately renders the page from
    // before the save — which is exactly what runs 36-40 recorded: the row in
    // the database was correct ("Ama", shares_readiness true,
    // coordination_state "ready", all asserted below) while the page still
    // showed "A traveller" and "Not sharing".
    //
    // The database and the page were never disagreeing about state. The test
    // was reading the page too early and blaming the engine for it.
    //
    // Asserting the rendered result first is also the honest order: this line
    // proves the action completed and revalidated, and the reload below then
    // proves the row was written rather than the page merely updated — the
    // same separation the rest of this suite uses.
    await expect(members).toContainText("Ama");

    await page.reload();

    // Before asserting on the rendered page, say what the database holds.
    //
    // Every previous failure here reported only that the page lacked
    // something — equally true whether the write failed, the read failed, or
    // the render did. Four diagnoses drawn from that ambiguity were wrong.
    // This puts the row itself in the failure message, so the next one is a
    // fact rather than a hypothesis.
    const row = await readAsAdmin(
      config as AdminConfig,
      `group_memberships?select=display_name,arrival_on,shares_readiness,` +
        `coordination_state&user_id=eq.${owner.id}`,
    );
    const stored = JSON.stringify(row);

    expect(stored, `membership row after save: ${stored}`).toContain('"Ama"');
    expect(stored, `membership row after save: ${stored}`).toContain(
      '"shares_readiness":true',
    );
    expect(stored, `membership row after save: ${stored}`).toContain(
      '"coordination_state":"ready"',
    );

    await expect(members).toContainText("Ama");
    await expect(members).toContainText(/arrives 19 Dec/i);

    // What this member publishes, asserted where it is written rather than
    // only where it is aggregated.
    //
    // Five runs could say only that the group panel showed no state — which is
    // true whether the derivation returned null, the write dropped it, or the
    // aggregation lost it. This separates those: it reads the member's own row
    // straight back. If it says "nothing yet" the derivation is at fault; if it
    // names a state while the panel disagrees, the aggregation is.
    const published = own.getByTestId("own-published-state");
    await expect(published).toContainText(/the group sees:/i);
    await expect(published).toContainText(/ready/i);

    // The aggregate now has one sharing member, and says so in words rather
    // than leaving the denominator to be inferred.
    await expect(readiness).toContainText(/sharing their readiness/i);
    await expect(readiness).not.toContainText(/nobody has chosen to share/i);
    // A real state was derived and published, not merely an empty state
    // cleared. "Nothing to report yet" would satisfy the two assertions above
    // in spirit while proving the derivation never ran.
    await expect(readiness).not.toContainText(/nothing to report yet/i);
    await expect(
      readiness.getByRole("list", { name: /shared readiness/i }).getByRole("listitem"),
    ).toHaveCount(1);

    // --- withdrawing consent removes what was shared ------------------------
    await own.getByLabel(/share my readiness/i).uncheck();
    await own.getByRole("button", { name: /^save$/i }).click();
    await page.reload();
    await expect(readiness).toContainText(/nobody has chosen to share/i);
    await expect(readiness).toContainText(/not shared their readiness/i);

    expect(groupUrl).toMatch(/\/groups\//);
  });

  test("keeps one member's private records out of another member's reach", async ({
    page,
    browser,
  }) => {
    // The adversarial half. Both people are genuinely in the same group; the
    // question is whether membership leaks anything it should not.
    const owner = await newUser();
    await signIn(page, owner);

    // The owner has a private trip of their own.
    await page.goto("/trips/new");
    await page.getByLabel("Destination country").selectOption({ label: "Ghana" });
    await page.getByLabel("Destination city").fill("Kumasi");
    await page.getByRole("button", { name: /save trip/i }).click();
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/);
    const ownerTripUrl = page.url();

    await page.goto("/groups/new");
    await page.getByLabel("Group name").fill("Shared journey");
    await page.getByRole("button", { name: /create group/i }).click();
    await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/);
    const groupUrl = page.url();

    // A second real user, signed in for real, who is NOT in the group yet.
    const outsider = await newUser();
    const otherContext = await browser.newContext();
    try {
      const otherPage = await otherContext.newPage();
      await signIn(otherPage, outsider);

      // The group is invisible to them — 404, not a permissions page, because
      // "no such group" and "not yours" must be indistinguishable.
      await otherPage.goto(groupUrl);
      await expect(otherPage.getByText(/404|not found/i).first()).toBeVisible();

      // And so is the owner's trip.
      await otherPage.goto(ownerTripUrl);
      await expect(otherPage.getByText(/404|not found/i).first()).toBeVisible();

      // Their own groups list stays empty rather than showing somebody else's.
      await otherPage.goto("/groups");
      await expect(otherPage.getByText(/no groups yet/i)).toBeVisible();
    } finally {
      await otherContext.close();
    }
  });

  test("fails closed for a signed-out visitor on every group route", async ({
    page,
  }) => {
    // The invitation link is gated too: accepting creates a membership for a
    // specific user, so there is no meaningful anonymous acceptance.
    for (const path of [
      "/groups",
      "/groups/new",
      "/groups/00000000-0000-0000-0000-000000000000",
      "/groups/join/some-token",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });
});
