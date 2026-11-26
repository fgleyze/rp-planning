import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En dev : Vite sert le front (5173) et proxie /api vers Express (3002).
// En prod : `npm run build` produit dist/, qu'Express sert lui-même.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3002",
    },
  },
  build: { outDir: "dist" },
});
