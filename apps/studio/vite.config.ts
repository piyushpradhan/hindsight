import { defineConfig } from "vite";
import type { ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

// Proxy target mirrors DEFAULTS.replayEnginePort in @hindsight/shared.
const REPLAY_ENGINE = "http://localhost:4123";

// When replay-engine is down, answer with a distinct 502 so the client's
// DEV ONLY mock fallback can tell "backend down" apart from real API errors.
const engineProxy: ProxyOptions = {
  target: REPLAY_ENGINE,
  configure: (proxy) => {
    proxy.on("error", (_err, _req, res) => {
      if ("writeHead" in res && typeof res.writeHead === "function" && !res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "replay-engine unreachable" }));
      }
    });
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": engineProxy,
      "/hooks": engineProxy,
    },
  },
});
