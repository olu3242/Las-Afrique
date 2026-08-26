import { expect, test, type Page } from "@playwright/test";

/** Widths the project treats as first-class. Mobile is not a fallback. */
const WIDTHS = [375, 768, 1024, 1440] as const;

/** Collects console errors and uncaught page errors for the life of a page. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

test.describe("marketing landing page", () => {
  test("renders and reports no console errors", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: /go home/i }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("has one h1 and no skipped heading levels", async ({ page }) => {
    await page.goto("/");

    const levels = await page
      .locator("h1, h2, h3, h4, h5, h6")
      .evaluateAll((nodes) => nodes.map((n) => Number(n.tagName[1])));

    expect(levels.filter((l) => l === 1)).toHaveLength(1);

    let previous = 0;
    for (const level of levels) {
      if (previous) expect(level).toBeLessThanOrEqual(previous + 1);
      previous = level;
    }
  });

  test("exposes the expected landmarks", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("footer")).toHaveCount(1);
    await expect(page.locator("nav")).not.toHaveCount(0);
  });

  test("gives keyboard users a visible skip link first", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const focused = page.locator(":focus");
    await expect(focused).toContainText(/skip to content/i);
    await expect(focused).toBeVisible();
  });

  test("labels every form control and hides decorative SVG", async ({ page }) => {
    await page.goto("/");

    const unlabelled = await page.locator("input:not([type=hidden])").evaluateAll(
      (nodes) =>
        nodes.filter((node) => {
          const input = node as HTMLInputElement;
          return (
            !input.labels?.length &&
            !input.getAttribute("aria-label") &&
            !input.getAttribute("aria-labelledby")
          );
        }).length,
    );
    expect(unlabelled).toBe(0);

    const exposedSvg = await page
      .locator("svg")
      .evaluateAll(
        (nodes) =>
          nodes.filter(
            (n) => !n.hasAttribute("aria-hidden") && !n.getAttribute("role"),
          ).length,
      );
    expect(exposedSvg).toBe(0);
  });

  for (const width of WIDTHS) {
    test(`has no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      // One pixel of slack for sub-pixel rounding.
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
  }

  test("keeps every interactive target at or above 24px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const undersized = await page
      .locator("a, button, input, summary")
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            // The skip link is visually hidden until focused.
            if (node.className.toString().includes("sr-only")) return false;
            const rect = node.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return false;
            return rect.height < 24 || rect.width < 24;
          })
          .map((node) => node.textContent?.trim().slice(0, 30) ?? ""),
      );

    expect(undersized).toEqual([]);
  });
});

test.describe("landing page interactions", () => {
  test("country selector updates the featured guide", async ({ page }) => {
    await page.goto("/");

    // Nigeria is the primary example and the default selection.
    await expect(page.getByRole("button", { name: "Nigeria" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("button", { name: "Ghana", exact: true }).click();

    await expect(page.getByRole("button", { name: "Ghana", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The live region carries the change to assistive technology.
    await expect(page.locator('[aria-live="polite"]')).toContainText("Accra");
  });

  test('"Why this estimate?" discloses assumptions and confidence', async ({
    page,
  }) => {
    await page.goto("/");

    const disclosure = page.locator("details", {
      has: page.getByText("Why this estimate?"),
    });
    await expect(disclosure).not.toHaveAttribute("open", "");

    await page.getByText("Why this estimate?").click();

    await expect(disclosure).toHaveAttribute("open", "");
    await expect(disclosure).toContainText(/assumptions/i);
    await expect(disclosure).toContainText(/confidence/i);
  });

  test("waitlist form accepts an address and confirms", async ({ page }) => {
    await page.goto("/");

    await page.fill("#waitlist-email", "traveller@example.com");
    await page.getByRole("button", { name: /join the waitlist/i }).last().click();

    await expect(page.getByRole("status")).toContainText(
      /we['\u2019]ve got your address/i,
    );
  });

  test("labels illustrative figures as illustrative", async ({ page }) => {
    await page.goto("/");
    // Example data must never read as live user data.
    await expect(page.getByText(/illustrative, not live data/i).first()).toBeVisible();
  });
});

test.describe("reduced motion", () => {
  test("neutralises animation but still renders the route motif", async ({
    page,
  }) => {
    // Set explicitly rather than via test.use(): the fixture form did not
    // actually reach matchMedia here, which made the assertion vacuous.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    // Prove the emulation landed before asserting on what it should cause.
    const matches = await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    expect(matches).toBe(true);

    const state = await page.evaluate(() => {
      const animated = document.querySelector(".animate-route-draw");
      return {
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        duration: animated ? getComputedStyle(animated).animationDuration : null,
        rendered: animated ? animated.getBoundingClientRect().width > 0 : false,
      };
    });

    expect(state.scrollBehavior).toBe("auto");
    // The global rule collapses duration rather than removing the animation, so
    // the finished line is simply present.
    expect(parseFloat(state.duration ?? "1")).toBeLessThan(0.01);
    expect(state.rendered).toBe(true);
  });
});
