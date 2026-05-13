import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Basic Vite config for a single-page React app.
export default defineConfig({
  plugins: [react()]
});