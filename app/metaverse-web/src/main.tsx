import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installTokens } from "./theme";
import "./style.css";
installTokens();
createRoot(document.getElementById("root")!).render(<App />);
