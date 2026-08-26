import { expect, test } from "@playwright/test";

/**
 * Iteration 1's protected-route path, exercised through the real middleware
 * against a production build.
 *
 * There is no sign-in flow yet, so what is provable here is the half that
 * matters most: an unauthenticated request to a protected route must never be
 * served. The gate is expected to fail *closed* — including when Supabase is
 * unconfigured, which is how CI runs it.
 */
test.describe("protected routes", () => {
  test("redirects an unauthenticated request away from the dashboard", async ({
    page,
  }) => {
    const response = await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/\?auth=required$/);
    // The redirect resolved to the marketing page, not the dashboard.
    expect(response?.url()).not.toContain("/dashboard");
    await expect(
      page.getByRole("heading", { level: 1, name: /go home/i }),
    ).toBeVisible();
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
    await expect(page).toHaveURL(/\/\?auth=required$/);
  });

  test("leaves the public marketing route open", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).not.toHaveURL(/auth=required/);
  });
});
