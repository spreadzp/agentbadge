const typography = require("@tailwindcss/typography");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/views/**/*.ts", "./src/server/routes/**/*.ts"],
  safelist: [
    // Classes used in dynamic JS innerHTML (progress bars, report rendering)
    "h-2",
    "bg-indigo-500",
    "bg-emerald-500",
    "bg-slate-800",
  ],
  theme: {
    extend: {},
  },
  plugins: [typography],
};
