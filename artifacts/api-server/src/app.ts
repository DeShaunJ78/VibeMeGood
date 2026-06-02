import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { addSSEClient } from "./lib/sse";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// CORS allowlist. The SPA is same-origin (served behind the same proxy) so it
// needs no CORS. The only legitimate cross-origin caller is the PrizePicks sync
// bookmarklet, which runs on *.prizepicks.com and POSTs the lines feed to the
// import endpoint. Everything else is rejected so a random site the user visits
// cannot script writes against the API.
const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /\.replit\.dev$/,
  /\.replit\.app$/,
  /\.repl\.co$/,
  /(^|\.)prizepicks\.com$/,
];
const EXTRA_ALLOWED_ORIGINS = (process.env.REPLIT_DOMAINS ?? "")
  .split(",")
  .map(d => d.trim())
  .filter(Boolean)
  .flatMap(d => [`https://${d}`, `http://${d}`]);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header => same-origin navigation, curl, server-to-server. Allow.
      if (!origin) return callback(null, true);
      if (EXTRA_ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      let host: string;
      try {
        host = new URL(origin).host;
      } catch {
        return callback(null, false);
      }
      const ok = ALLOWED_ORIGIN_PATTERNS.some(re => re.test(origin) || re.test(host));
      return callback(null, ok);
    },
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.get("/api/events", (req, res) => addSSEClient(res));
app.use("/api", router);

export default app;
