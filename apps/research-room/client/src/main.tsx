import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { applyAppearanceToDocument, readAppearancePreferences } from "./preferences/appearance.js";
import "./styles/tokens.css";
import "./styles/app.css";

applyAppearanceToDocument(readAppearancePreferences());
const root = document.getElementById("root");
if (!root) throw new Error("The Sestina client root is missing.");
createRoot(root).render(<StrictMode><App /></StrictMode>);
