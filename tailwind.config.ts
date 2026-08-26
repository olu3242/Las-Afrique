import type { Config } from "tailwindcss";

/**
 * Take Me Home brand system.
 * Palette and typography are fixed brand decisions — see CLAUDE.md.
 * Do not introduce competing colour ramps or promote IBM Plex Mono to body text.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        indigo: {
          950: "#0F1026",
          900: "#14152B",
          800: "#1E2142",
        },
        sunset: "#D4A24C",
        // Lighter tint of baobab, for small text on baobab-tinted surfaces where
        // the base green falls below the 4.5:1 contrast floor. Not a new brand colour.
        "baobab-light": "#6FBFA9",
        baobab: "#3F8C7A",
        ivory: "#F5F1E8",
        muted: "#9593B0",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "Cambria", "serif"],
        sans: ["var(--font-inter)", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      maxWidth: {
        content: "72rem",
      },
      animation: {
        "route-draw": "route-draw 2.4s ease-out forwards",
      },
      keyframes: {
        "route-draw": {
          from: { strokeDashoffset: "1" },
          to: { strokeDashoffset: "0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
