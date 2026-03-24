import { loadEnv } from "./config/env.js";
import { initSqlite } from "./db/sqlite.js";
import { buildServer } from "./server.js";

loadEnv();
initSqlite();

const port = Number.parseInt(process.env.PORT || "8787", 10);

const app = await buildServer();
await app.listen({ port, host: "0.0.0.0" });
