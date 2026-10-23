import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        page: "var(--page)",
        surface: {
          DEFAULT: "var(--surface-1)",
          alt: "var(--surface-2)",
          sunk: "var(--surface-3)",
        },
        ink: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        line: {
          grid: "var(--gridline)",
          base: "var(--baseline)",
          hair: "var(--border)",
          strong: "var(--border-strong)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          strong: "var(--accent-strong)",
          ink: "var(--accent-ink)",
          wash: "var(--accent-wash)",
          text: "var(--accent-text)",
        },
        good: { wash: "var(--good-wash)", ink: "var(--good-ink)", line: "var(--good-line)" },
        warn: { wash: "var(--warn-wash)", ink: "var(--warn-ink)", line: "var(--warn-line)" },
        crit: { wash: "var(--crit-wash)", ink: "var(--crit-ink)", line: "var(--crit-line)" },
        age: {
          1: "var(--age-1)",
          2: "var(--age-2)",
          3: "var(--age-3)",
          4: "var(--age-4)",
          5: "var(--age-5)",
        },
        credit: "var(--credit)",
        status: {
          good: "var(--status-good)",
          warning: "var(--status-warning)",
          serious: "var(--status-serious)",
          critical: "var(--status-critical)",
        },
      },
      borderRadius: {
        DEFAULT: "4px",
        md: "6px",
        lg: "8px",
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
