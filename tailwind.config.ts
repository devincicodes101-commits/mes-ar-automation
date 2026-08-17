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
          ink: "var(--accent-ink)",
          wash: "var(--accent-wash)",
        },
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
        DEFAULT: "2px",
        md: "3px",
        lg: "4px",
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
