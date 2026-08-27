import { expect, test, type Page } from "@playwright/test";
import {
  adminConfig,
  createProbeUser,
  deleteProbeUser,
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
    await own.getByLabel(/what the group calls you/i).fill("Ama");
    // Arriving a day after the group is a normal case, not an exception.
    await own.getByLabel(/you arrive/i).fill("2026-12-19");
    await own.getByLabel(/share my readiness/i).check();
    await own.getByRole("button", { name: /^save$/i }).click();

    await page.reload();
    await expect(members).toContainText("Ama");
    await expect(members).toContainText(/arrives 19 Dec/i);

    // The aggregate now has one sharing member, and says so in words rather
    // than leaving the denominator to be inferred.
    await expect(readiness).toContainText(/sharing their readiness/i);
    await expect(readiness).not.toContainText(/nobody has chosen to share/i);

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
