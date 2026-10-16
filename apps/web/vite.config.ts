import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "AI Virtual Office",
        short_name: "AI Office",
        description: "Pantau tim AI Agent dari ponsel.",
        lang: "id",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#E8ECF1",
        theme_color: "#2F4BFF",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Jangan pernah mencegat navigasi ke API (login OAuth berupa navigasi biasa).
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
      },
    }),
  ],
  server: { proxy: { "/api": "http://localhost:8787" } },
});
