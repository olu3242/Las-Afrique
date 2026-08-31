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
 * Iteration 12's engine, driven through the browser against a real project.
 *
 *   programme → code → invitation → link resolved → signup attributed
 *             → qualifying action → qualified → entitlement
 *
 * Two things are being proved, and only one of them is the happy path.
 *
 * The first is that attribution is *earned*: the referred user causes it, but
 * cannot dictate it. The second is the privacy boundary — a referrer learns a
 * status and nothing else — which is asserted by pointing the referrer at the
 * referred user's own trip and getting a 404.
 *
 * The order of the primary journey is not incidental. It encodes what eleven
 * hosted runs of Iteration 11 cost to learn:
 *
 *   ACTION → ASSERT POST-ACTION RENDER → VERIFY PERSISTENCE → RELOAD →
 *   ASSERT DURABLE
 *
 * `click()` is not proof that a server action completed. Reloading straight
 * after a click races the action out from under itself, and the failure that
 * produces looks exactly like a write that never happened. So the render is
 * awaited first, the row is read second — before the durable assertions, so
 * the diagnostic actually executes when they fail — and only then is the page
 * reloaded.
 *
 * There is a second ordering rule here that Iteration 12 adds: the link must
 * be resolved *before* the referred account exists. That is the real sequence
 * — a person follows a link and then signs up — and `attribute_referral`
 * refuses a touch that predates the account, so a fixture that creates the
 * user first would be testing the opposite of the product.
 *
 * Needs a configured project, so it is SKIPPED where none is available. A skip
 * is reported as a skip and is not evidence of anything.
 */
const config = adminConfig();
const configured = !("missing" in config);

test.describe("referral, signed in", () => {
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

  /**
   * Open /referrals and prove it actually rendered.
   *
   * Written after a hosted run in which all three journeys failed on their
   * first locator with "element(s) not found" — which is equally true whether
   * the page rendered its empty state, redirected, or returned a 500. It was a
   * 500, and the log could not say so: the whole engine looked broken when one
   * unsupported call in one component was.
   *
   * So the failure message carries what the page actually said. Same principle
   * as Iteration 11's admin read: put the real state into the message rather
   * than leave the next person to guess between three possibilities.
   */
  async function openReferrals(page: Page) {
    const response = await page.goto("/referrals");
    const status = response?.status();
    const heading = await page
      .getByRole("heading", { level: 1 })
      .textContent()
      .catch(() => null);
    const body = ((await page.locator("body").textContent()) ?? "").slice(0, 400);

    expect(
      status,
      `GET /referrals answered ${status}. h1: ${heading}. Body: ${body}`,
    ).toBeLessThan(400);

    await expect(
      page.getByRole("heading", { level: 1 }),
      `/referrals did not render its own heading. Status ${status}. Body: ${body}`,
    ).toContainText("Introducing someone");
  }

  async function signIn(page: Page, user: ProbeUser) {
    await page.goto("/login");
    await page.getByLabel("Email address").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  }

  test("carries a referral from a link to a qualified entitlement", async ({
    page,
    browser,
  }) => {
    const referrer = await newUser();
    await signIn(page, referrer);

    // --- the referrer's own code -------------------------------------------
    await openReferrals(page);
    const link = page.getByRole("region", { name: "Your link" });
    await expect(link).toContainText("/r/");

    // Read from the code's own element, not the section's combined text. The
    // prose after it begins "Anyone who signs up…", and in `textContent` that
    // runs straight on from the code with no separator — so a regex over the
    // section captured the leading "A" as part of the code and then asserted
    // against a string the database had never held.
    const codeText = (await link.locator("code").textContent()) ?? "";
    const code = /^\/r\/([A-Z0-9]{8,16})$/.exec(codeText.trim())?.[1];
    expect(code, `no referral code rendered — element said: ${codeText}`).toBeTruthy();

    // Idempotent: the page mints on every load, and must not mint twice. The
    // second load is also the one that used to work while the first returned
    // 500, so asserting both is what distinguishes "minting is broken" from
    // "minting during render is broken".
    await openReferrals(page);
    await expect(link).toContainText(`/r/${code}`);

    // --- an invitation ------------------------------------------------------
    // The address is chosen now and the account is created later, because the
    // touch has to precede the account.
    const invitedAddress = `referred-${Date.now()}@takemehome-probe.dev`;

    await page.getByLabel("Email address").fill(invitedAddress);
    await page.getByRole("button", { name: /create invitation/i }).click();

    // ACTION → ASSERT POST-ACTION RENDER. Waiting for the invitation's own
    // output is what proves the action finished; nothing below may run before
    // it, and a reload here would race it.
    const invitationLink = page.getByText(/^\/r\/[A-Za-z0-9_-]{20,}$/);
    await expect(invitationLink).toBeVisible();
    const token = ((await invitationLink.textContent()) ?? "").replace("/r/", "");
    expect(token.length).toBeGreaterThan(20);

    await expect(
      page.getByRole("list", { name: "Referrals you have made" }),
    ).toContainText(invitedAddress);

    // --- the referred person, in their own browser --------------------------
    const referredContext = await browser.newContext();
    const referredPage = await referredContext.newPage();

    // Resolve the link first. This writes no row anywhere — it leaves a touch
    // on this browser and sends the visitor to signup.
    await referredPage.goto(`/r/${token}`);
    await expect(referredPage).toHaveURL(/\/signup/);

    // *Now* the account exists. Created after the touch, which is the order
    // attribute_referral requires and the order a real person follows.
    const referred = await newUser();
    await signIn(referredPage, referred);

    // The qualifying action under the approved programme: a first trip.
    await referredPage.goto("/trips/new");
    await referredPage
      .getByLabel("Destination country")
      .selectOption({ label: "Nigeria" });
    await referredPage.getByLabel("Destination city").fill("Lagos");
    await referredPage.getByRole("button", { name: /save trip/i }).click();
    await expect(referredPage).toHaveURL(/\/trips\/[0-9a-f-]{36}$/);
    const tripUrl = referredPage.url();

    // The referred user's own view of the attribution. They can always see
    // that they were attributed — being the subject of an attribution you
    // cannot inspect is not a position to put someone in.
    //
    // What they see is the *referrer's code*, not the invitation token they
    // followed. This assertion is what found migration 0014: it was showing
    // the token, because attribute_referral had stored the plaintext of a
    // credential the schema deliberately hashes.
    await openReferrals(referredPage);
    const arrival = referredPage.getByRole("region", { name: "How you arrived" });
    await expect(arrival).toContainText(code as string);
    await expect(arrival).not.toContainText(token);

    // --- back to the referrer ----------------------------------------------
    // VERIFY PERSISTENCE, before the rendered assertions rather than after, so
    // that when they fail this has actually run and the message carries the
    // real state instead of a guess.
    const persisted = await readAsAdmin(
      config as AdminConfig,
      `referrals?select=state,code,invitation_id&referrer_id=eq.${referrer.id}`,
    );
    const entitlements = await readAsAdmin(
      config as AdminConfig,
      `reward_entitlements?select=reward_policy_key,user_id&user_id=eq.${referrer.id}`,
    );

    await openReferrals(page);
    const referralList = page.getByRole("list", { name: "Referrals you have made" });

    await expect(
      referralList,
      `referral row not rendered. Database holds: ${JSON.stringify(persisted)}`,
    ).toContainText("Qualified");
    await expect(referralList).toContainText(invitedAddress);

    await expect(
      page.getByRole("list", { name: "Your entitlements" }),
      `entitlement not rendered. Database holds: ${JSON.stringify(entitlements)}`,
    ).toContainText("recognition-only");

    // RELOAD → ASSERT DURABLE. The row was written, not the page updated.
    await page.reload();
    await expect(referralList).toContainText("Qualified");
    await expect(page.getByRole("list", { name: "Your entitlements" })).toContainText(
      "recognition-only",
    );

    // --- the privacy boundary ----------------------------------------------
    // The assertion the whole engine rests on, and the one that cannot pass by
    // accident: the referrer holds a qualified referral and still gets nothing
    // of that person's trip.
    await page.goto(tripUrl);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /not found/i,
    );

    // Nor anything about them on the referral page itself.
    await openReferrals(page);
    await expect(page.locator("body")).not.toContainText("Lagos");
    await expect(page.locator("body")).not.toContainText(referred.email);

    await referredContext.close();
  });

  test("refuses to attribute a referrer their own link", async ({ page }) => {
    // Self-referral, driven end to end rather than asserted in SQL: the whole
    // path has to refuse it, not just the constraint at the bottom of it.
    const referrer = await newUser();
    await signIn(page, referrer);

    await openReferrals(page);
    await expect(page.getByLabel("Email address")).toBeVisible();
    await page.getByLabel("Email address").fill(referrer.email);
    await page.getByRole("button", { name: /create invitation/i }).click();

    await expect(page.getByText("That is your own address.")).toBeVisible();

    // And nothing was written for it.
    await page.reload();
    await expect(page.locator("body")).not.toContainText("Invitation created");
  });

  test("shows an unrelated member nothing of somebody else's referral", async ({
    page,
  }) => {
    const stranger = await newUser();
    await signIn(page, stranger);

    await openReferrals(page);
    // Their own page, with their own code — and an empty list, because a
    // referral is visible to its two parties and nobody else.
    await expect(page.getByRole("region", { name: "Your link" })).toContainText(
      "/r/",
    );
    await expect(
      page.getByRole("list", { name: "Referrals you have made" }),
    ).toHaveCount(0);
    await expect(page.getByText("Nothing yet. Invitations and link signups")).toBeVisible();
  });
});
