import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./charte.css";
import "./mise-en-page.css";
import "./agents.css";
import "./brouillons.css";
import "./prospection.css";

const root = document.getElementById("root");
if (root === null) throw new Error("#root is missing from index.html");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
