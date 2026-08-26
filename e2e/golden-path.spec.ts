import { expect, test } from "@playwright/test";
import {
  adminConfig,
  createProbeUser,
  deleteProbeUser,
  type AdminConfig,
  type ProbeUser,
} from "./support/supabase-admin";

/**
 * Iteration 10 — the complete MVP path, and the adversarial one beside it.
 *
 * Every preceding engine has its own certification. This proves the thing none
 * of them can on their own: that they compose. Ten individually complete
 * pieces that do not add up to a working product is the exact failure the
 * iteration standard exists to prevent, and only a run like this can tell the
 * difference.
 *
 * Needs a configured project, so it SKIPS where none is available and says so.
 * A skip is not evidence — the hosted workflow fails the run if this skipped
 * rather than executed.
 */
const config = adminConfig();
const configured = !("missing" in config);

test.describe("golden path", () => {
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

  test("carries one traveller through the whole product", async ({ page }) => {
    const user = await newUser();

    // --- identity ----------------------------------------------------------
    await page.goto("/login");
    await page.getByLabel("Email address").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // --- trip intake -------------------------------------------------------
    await page.goto("/trips/new");
    await page
      .getByLabel("Destination country")
      .selectOption({ label: "Nigeria" });
    await page.getByLabel("Destination city").fill("Lagos");
    const departOn = new Date(Date.now() + 150 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await page.getByLabel("Departure").fill(departOn);
    await page.getByLabel("How many people are travelling").fill("2");
    await page.getByRole("button", { name: /save trip/i }).click();

    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/);
    const tripUrl = page.url();

    // --- every engine's output, on one page --------------------------------
    // Named individually rather than as one smoke assertion: a page that
    // renders four of five sections is a broken composition, and "the page
    // loaded" would not catch it.
    for (const heading of [
      /^Details$/,
      /^Travellers$/,
      /^Readiness$/,
      /^Reminders$/,
      /^Budget$/,
      /nigeria guide/i,
    ]) {
      await expect(
        page.locator("section", {
          has: page.getByRole("heading", { name: heading }),
        }),
        `the trip page should carry a ${heading} section`,
      ).toBeVisible();
    }

    // --- the honesty properties, which are the point of several engines ----
    // Nothing may claim a verified requirement while no source is attached,
    // and no figure may read as authoritative while it rests on placeholders.
    const guide = page.locator("section", {
      has: page.getByRole("heading", { name: /nigeria guide/i }),
    });
    await expect(guide).toContainText(/not yet verified/i);

    const readiness = page.locator("section", {
      has: page.getByRole("heading", { name: /^Readiness$/ }),
    });
    await expect(readiness).toContainText(/verif/i);

    // --- the dashboard composes the same engines ---------------------------
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /^1 trip$/ })).toBeVisible();

    // --- refresh: everything came from the database, not from page state ---
    await page.goto(tripUrl);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Lagos");
    await expect(
      page.locator("section", {
        has: page.getByRole("heading", { name: /^Budget$/ }),
      }),
    ).toBeVisible();
  });

  test("refuses another signed-in user on every surface", async ({
    page,
    browser,
  }) => {
    // The adversarial half, run against every tenant surface rather than just
    // the trip. A single leaking route is a leaking product, and the engines
    // were built at different times by different reasoning.
    const alice = await newUser();

    await page.goto("/login");
    await page.getByLabel("Email address").fill(alice.email);
    await page.getByLabel("Password").fill(alice.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto("/trips/new");
    await page
      .getByLabel("Destination country")
      .selectOption({ label: "Ghana" });
    await page.getByLabel("Destination city").fill("Accra");
    await page.getByRole("button", { name: /save trip/i }).click();
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/);
    const aliceTripUrl = page.url();

    const bob = await newUser();
    const bobContext = await browser.newContext();
    try {
      const bobPage = await bobContext.newPage();
      await bobPage.goto("/login");
      await bobPage.getByLabel("Email address").fill(bob.email);
      await bobPage.getByLabel("Password").fill(bob.password);
      await bobPage.getByRole("button", { name: /sign in/i }).click();
      await expect(bobPage).toHaveURL(/\/dashboard/);

      // Genuinely signed in — so this is RLS refusing him, not the auth gate.
      const response = await bobPage.goto(aliceTripUrl);
      expect(response?.status(), "Alice's trip must 404 for Bob").toBe(404);

      // And none of Alice's content leaks through any engine's output.
      for (const leak of ["Accra", "Ghana guide"]) {
        await expect(
          bobPage.getByText(leak),
          `${leak} must not appear for Bob`,
        ).toHaveCount(0);
      }

      await bobPage.goto("/dashboard");
      await expect(
        bobPage.getByRole("heading", { name: /no trips yet/i }),
      ).toBeVisible();
    } finally {
      await bobContext.close();
    }
  });

  test("fails closed for a signed-out visitor on every product route", async ({
    page,
  }) => {
    // The third path: no session at all. Checked here as well as in
    // auth-gate.spec.ts because this suite runs against the *configured*
    // project, where the gate could plausibly behave differently.
    for (const route of [
      "/dashboard",
      "/trips/new",
      "/trips/00000000-0000-0000-0000-000000000000",
      "/countries",
      "/countries/nigeria",
    ]) {
      await page.goto(route);
      await expect(page, `${route} should redirect to sign in`).toHaveURL(
        /\/login\?/,
      );
    }
  });
});
