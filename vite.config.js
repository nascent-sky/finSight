import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  server: {
    host: true,
  },
  preview: {
    host: true,
    strictPort: true,
    allowedHosts: [
      ".ngrok-free.app", // allow all ngrok free domains
    ],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: false,
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        importScripts: ["/share-target-handler.js"],
      },
      manifest: {
        name: "FinSight",
        short_name: "FinSight",
        description: "Finance tracking app",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        scope: "/",
        share_target: {
          action: "/share-target",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            files: [
              {
                name: "statement",
                accept: ["application/pdf"],
              },
            ],
          },
        },
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
})
