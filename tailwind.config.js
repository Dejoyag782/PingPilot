/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { ink: "#111827", muted: "#64748b", accent: "#2563eb" }, boxShadow: { soft: "0 10px 35px rgba(15,23,42,.07)" } } },
  plugins: []
};
