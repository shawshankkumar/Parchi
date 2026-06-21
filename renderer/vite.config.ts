import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages project site is served from /parchi/.
export default defineConfig({
  base: "/parchi/",
  plugins: [react()],
});
