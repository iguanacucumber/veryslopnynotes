import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import { watchViewport } from "./lib/viewport";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/madoka.css";

const root = document.getElementById("root");
if (!root) throw new Error("root absent");

// La hauteur utile suit le viewport réel (le clavier réduit la zone visible).
// Branché AVANT le premier rendu : la mise en page part de la bonne hauteur.
watchViewport(window, document);

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
