/** @type {import('tailwindcss').Config} */
export default {
  // CRITICAL: This content array lists all files that Tailwind should scan
  // for class names. It ensures the necessary CSS is generated.
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
