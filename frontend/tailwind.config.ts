import type { Config } from "tailwindcss";

// The whole `slate` scale is bound to CSS variables (see globals.css). Dark values are the default,
// `:root:not(.dark)` flips the scale for light mode, so every existing bg-slate-* / text-slate-* class themes itself.
const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const slate = Object.fromEntries(steps.map((n) => [n, `rgb(var(--slate-${n}) / <alpha-value>)`]));

export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: { colors: { slate } } },
  plugins: [],
} satisfies Config;
