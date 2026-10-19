import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build local de l'UI, copié dans les assets de l'APK. `base: "./"` garde les
// chemins relatifs sous `https://appassets.androidplatform.net/`.
// ponytail: pas de serveur de dev dans l'APK ; `bun run dev:web` sert seulement
// à itérer dans Chromium avec le pont factice.
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../android/app/src/main/assets/web",
    emptyOutDir: true,
    target: "es2018",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) n'accepte plus l'objet manuel : une fonction garde
        // le même regroupement et reste compatible avec l'ancien Rollup.
        manualChunks(id) {
          return /node_modules\/(react|react-dom|react-router|react-router-dom)\//.test(id)
            ? "react"
            : undefined;
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
