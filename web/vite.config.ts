import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build local de l'UI, copié dans les assets de l'APK. `base: "./"` garde les
// chemins relatifs sous `https://appassets.androidplatform.net/`.
// ponytail: pas de serveur de dev dans l'APK ; `bun run dev:web` sert seulement
// à itérer dans Chromium avec le pont factice.
export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../android/app/src/main/assets/web",
    emptyOutDir: true,
    target: "es2018",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [".."] },
  },
});
