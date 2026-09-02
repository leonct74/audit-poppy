import { createRoot } from "react-dom/client";
// The kit's token sheet loads FIRST (the design contract), then our components.
import "./poppy.css";
import "./app.css";
import App from "./App";

const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<App />);
