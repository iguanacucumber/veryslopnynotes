import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build local de l'UI, copié dans les assets de l'APK. `base: "./"` garde les
// chemins relatifs sous `https://appassets.androidplatform.net/`.
// ponytail: pas de serveur de dev dans l'APK ; `bun run dev:web` sert à itérer
// dans Chromium avec le pont factice.
export default defineConfig(({ command }) => {
  // Le bundle de l'APK est TOUJOURS un build de production : un
  // `NODE_ENV=development` dans l'environnement embarquerait le pont factice
  // et des données fictives. `vite` (serve) garde son mode développement.
  if (command === "build") process.env.NODE_ENV = "production";
  return {
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
          // Fonction, pas objet : Rolldown (Vite 8) refuse l'objet manuel.
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
  };
});
