import { expect, test } from "@playwright/test";

/**
 * The protected-route gate, exercised through the real middleware against a
 * production build.
 *
 * This suite runs with Supabase deliberately unconfigured, which is how CI
 * runs it. That is the harder case, not the easier one: the gate must fail
 * *closed* — a protected route is never served, and the sign-in page it
 * redirects to says it is unavailable rather than throwing.
 *
 * The signed-in half of the path is proved separately, against the real
 * project, in e2e/trip-onboarding.spec.ts.
 */
test.describe("protected routes", () => {
  test("redirects an unauthenticated request to sign in", async ({ page }) => {
    const response = await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/login\?/);
    expect(response?.url()).not.toContain("/dashboard");
  });

  test("carries where the visitor was headed, so sign-in resumes it", async ({
    page,
  }) => {
    await page.goto("/trips/new");
    await expect(page).toHaveURL(/next=%2Ftrips%2Fnew/);
  });

  test("never renders dashboard content to an unauthenticated visitor", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.getByText(/your homecoming/i)).toHaveCount(0);
    await expect(page.getByText(/signed in as/i)).toHaveCount(0);
  });

  test("gates nested paths under a protected prefix", async ({ page }) => {
    await page.goto("/dashboard/anything");
    await expect(page).toHaveURL(/\/login\?/);
  });

  test("gates a trip detail route", async ({ page }) => {
    await page.goto("/trips/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/login\?/);
  });

  test("leaves the public marketing route open", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("serves the sign-in page in whichever mode it is deployed", async ({
    page,
  }) => {
    // Two legitimate modes, and the deployment decides which: configured, so
    // the form renders; or unconfigured, so it says accounts are unavailable.
    // What is never acceptable is a 500 — the middleware redirects here, so a
    // throwing /login turns a closed gate into a broken site.
    //
    // Asserted this way rather than by reading env: the spec's Node process
    // does not see the server's .env.local, so a configuration check here
    // would silently test the wrong branch.
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);

    const emailField = page.getByLabel("Email address");
    const unavailable = page.getByRole("status");

    if ((await emailField.count()) > 0) {
      await expect(emailField).toBeVisible();
      await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    } else {
      await expect(unavailable).toContainText(/unavailable/i);
      // And it must not offer a form it cannot honour.
      await page.goto("/signup");
      await expect(page.getByLabel("Email address")).toHaveCount(0);
    }
  });

  test("gives the sign-in page exactly one h1", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toHaveCount(1);
  });

  for (const width of [375, 768, 1024, 1440]) {
    test(`sign-in has no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/login");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${width}px`).toBe(false);
    });
  }

  test("keeps sign-in interactive targets at or above 24px", async ({ page }) => {
    await page.goto("/login");
    const targets = page.locator("a, button, input, select");
    const count = await targets.count();
    for (let i = 0; i < count; i += 1) {
      const target = targets.nth(i);
      if (!(await target.isVisible())) continue;
      const box = await target.boundingBox();
      if (!box) continue;
      const name = (await target.textContent())?.trim() || (await target.getAttribute("name")) || `#${i}`;
      expect(box.height, `${name} height`).toBeGreaterThanOrEqual(24);
      expect(box.width, `${name} width`).toBeGreaterThanOrEqual(24);
    }
  });
});
