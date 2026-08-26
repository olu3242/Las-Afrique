import { expect, test } from "@playwright/test";
import {
  adminConfig,
  createProbeUser,
  deleteProbeUser,
  type AdminConfig,
  type ProbeUser,
} from "./support/supabase-admin";

/**
 * Iteration 2's engine, driven through the browser against a real project.
 *
 *   sign in → trip intake → validation → persistence → authorization
 *           → trip detail → traveller → refresh
 *
 * Every step here goes through the shipped UI and the real server actions.
 * Nothing is mocked and no database call is faked — the whole point is that
 * the pieces compose, which is the one thing unit tests cannot show.
 *
 * Needs a configured project, so it is SKIPPED where none is available (a
 * fresh checkout, the default CI job). A skip is reported as a skip: it is not
 * evidence the path works, and must never be read as one. The hosted workflow
 * runs this with credentials, and that run is the certification.
 */
const config = adminConfig();
const configured = !("missing" in config);

test.describe("trip onboarding, signed in", () => {
  test.skip(
    !configured,
    `No Supabase project configured — missing ${
      "missing" in config ? config.missing.join(", ") : ""
    }. This proves nothing until it runs against a real project.`,
  );

  /**
   * A fresh user per test, not one shared across the file.
   *
   * Shared would be a latent failure: the first test asserts absolute counts
   * ("1 trip", "1 traveller") and the second creates another trip for the same
   * account. Serial declaration order hides it until a retry reorders the
   * effective sequence — and `retries: 1` is on in CI — at which point the
   * first test sees two trips and fails for a reason that has nothing to do
   * with the code under test.
   *
   * Each test owning its users also means they can run in parallel, which is
   * how the config is set.
   */
  const created: ProbeUser[] = [];

  async function newUser(): Promise<ProbeUser> {
    const probe = await createProbeUser(config as AdminConfig);
    created.push(probe);
    return probe;
  }

  test.afterAll(async () => {
    if (!configured) return;
    // Cascades take the trips and travellers with them.
    for (const probe of created) {
      await deleteProbeUser(config as AdminConfig, probe.id);
    }
  });

  test("carries a new user from sign-in to a saved trip and back", async ({
    page,
  }) => {
    const user = await newUser();
    // --- sign in, through the form ------------------------------------------
    await page.goto("/login");
    await page.getByLabel("Email address").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(user.email)).toBeVisible();

    // A brand-new account has no trips, and should say so rather than render
    // an empty list.
    await expect(
      page.getByRole("heading", { name: /no trips yet/i }),
    ).toBeVisible();

    // --- intake -------------------------------------------------------------
    await page.getByRole("link", { name: /plan a trip/i }).click();
    await expect(page).toHaveURL(/\/trips\/new/);

    // Validation first, through the real server action. A departure in the
    // past must come back as a message on the field, not as a saved trip.
    await page
      .getByLabel("Destination country")
      .selectOption({ label: "Nigeria" });
    await page.getByLabel("Departure").fill("2020-01-01");
    await page.getByRole("button", { name: /save trip/i }).click();

    const departureError = page.locator("#departOn-error");
    await expect(departureError).toContainText(/past/i);
    await expect(page).toHaveURL(/\/trips\/new/);
    // The control is marked invalid for assistive tech too, not just coloured.
    await expect(page.getByLabel("Departure")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    // Now a valid submission.
    const departOn = new Date(Date.now() + 120 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await page.getByLabel("Departure").fill(departOn);
    await page.getByLabel("Destination city").fill("Lagos");
    await page.getByLabel("How many people are travelling").fill("2");
    await page.getByRole("button", { name: /save trip/i }).click();

    // --- persistence and the detail consumer --------------------------------
    // Named errors before the URL check. A bare toHaveURL failure says only
    // "still on /trips/new", which is what the previous hosted run reported and
    // it cost a round trip to find out which field had been refused.
    const fieldErrors = page.locator('[id$="-error"]');
    await expect(
      fieldErrors,
      `validation refused the submission: ${(await fieldErrors.allTextContents()).join(
        " | ",
      )}`,
    ).toHaveCount(0);

    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/);
    const tripUrl = page.url();

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Lagos");

    // Read each figure from the <dd> that belongs to its own <dt>, rather than
    // by searching the page for the text. A bare getByText("2") would match
    // any stray "2" on the page and pass for the wrong reason.
    const fact = (term: string) =>
      page
        .locator("dt", { hasText: new RegExp(`^${term}$`) })
        .locator("xpath=following-sibling::dd[1]");

    await expect(fact("Destination")).toHaveText("Lagos, Nigeria");
    // Came back out of the database, not out of the form state.
    await expect(fact("Party size")).toHaveText("2");
    await expect(fact("Departure")).not.toHaveText("Not set");

    // --- travellers ---------------------------------------------------------
    await expect(page.getByText(/no travellers added yet/i)).toBeVisible();

    await page.getByLabel("Full name").fill("Ama Mensah");
    await page.getByLabel("Relationship").fill("Mother");
    await page.getByLabel("Last four of passport").fill("8f2c");
    await page.getByRole("button", { name: /add traveller/i }).click();

    // Scoped to the list entry, not searched for across the page. A bare
    // getByText("Ama Mensah") matches twice — once in the entry and once in the
    // remove button's sr-only label, which exists so that button is announced
    // as "Remove Ama Mensah" rather than a row of identical "Remove"s. The
    // duplicate is correct markup; the locator was what needed to be precise.
    const traveller = page
      .getByRole("listitem")
      .filter({ hasText: "Ama Mensah" });

    await expect(traveller).toHaveCount(1);
    await expect(traveller.getByText(/····8F2C/)).toBeVisible();

    // --- refresh / replay ---------------------------------------------------
    // The one that separates "the page updated" from "the row was written".
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Lagos");
    await expect(traveller).toHaveCount(1);
    await expect(traveller.getByText(/····8F2C/)).toBeVisible();

    // And the trip now shows on the dashboard with its traveller counted.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /^1 trip$/ })).toBeVisible();
    await expect(page.getByText(/1 traveller/)).toBeVisible();

    // --- country intelligence, consumed by the trip -------------------------
    // Iteration 3's path ends here: the trip reads the real Country Data
    // Service rather than restating anything about Nigeria itself.
    await page.goto(tripUrl);
    const guideSection = page.locator("section", {
      has: page.getByRole("heading", { name: /nigeria guide/i }),
    });
    await expect(guideSection).toBeVisible();

    // The seeded countries carry no verified source, so the guide must say so
    // rather than render an empty section that reads as "nothing is required".
    await expect(guideSection).toContainText(/not yet verified/i);
    await expect(guideSection).toContainText(/no verified source/i);

    // And it always points the traveller at the source rather than answering
    // for it. Matched on the instruction, not one spelling of it: the
    // unverified copy says "check the official source" and the verified copy
    // says "verify before you travel" — asserting only the second failed a
    // hosted run against a page that was doing the right thing.
    await expect(guideSection).toContainText(
      /verify before you travel|check the official source/i,
    );

    await page.getByRole("link", { name: /open the full guide/i }).click();
    await expect(page).toHaveURL(/\/countries\/nigeria$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Nigeria",
    );

    // --- traveller removal, and its refresh ---------------------------------
    await page.goto(tripUrl);
    await page.getByRole("button", { name: /remove ama mensah/i }).click();
    await expect(traveller).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(/no travellers added yet/i)).toBeVisible();
  });

  test("keeps one user's trip out of another user's session", async ({
    page,
    browser,
  }) => {
    // The adversarial half. Alice creates a trip; Bob, signed in for real,
    // gets a 404 for its URL rather than its contents.
    const user = await newUser();

    await page.goto("/login");
    await page.getByLabel("Email address").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
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

      // Bob is genuinely signed in — this is RLS refusing him, not the gate.
      const response = await bobPage.goto(aliceTripUrl);
      expect(response?.status()).toBe(404);
      await expect(bobPage.getByText("Accra")).toHaveCount(0);

      // And Alice's trip is not in his list.
      await bobPage.goto("/dashboard");
      await expect(
        bobPage.getByRole("heading", { name: /no trips yet/i }),
      ).toBeVisible();
    } finally {
      await bobContext.close();
    }
  });
});
