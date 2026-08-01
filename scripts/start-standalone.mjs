/**
 * Serves the artifact the Docker image actually ships — .next/standalone/server.js
 * — instead of `next start`, which Next warns does not work with
 * output: "standalone".
 *
 * `next build` leaves the standalone bundle without static assets or public/,
 * so this assembles them exactly as the Dockerfile's runner stage does. Running
 * the e2e suite against this is what keeps the shipped image from drifting.
 */
import "dotenv/config";
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const server = path.join(standalone, "server.js");

if (!existsSync(server)) {
  console.error(
    "No .next/standalone/server.js — run `npm run build` first (needs output: \"standalone\").",
  );
  process.exit(1);
}

// Dockerfile runner stage copies both of these; `next build` does not.
cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), {
  recursive: true,
});
if (existsSync(path.join(root, "public"))) {
  cpSync(path.join(root, "public"), path.join(standalone, "public"), {
    recursive: true,
  });
}

// server.js chdirs into its own directory, so a relative file: URL would point
// at a different (empty) database than the one migrations and the seed used.
const url = process.env.DATABASE_URL;
if (url?.startsWith("file:")) {
  const file = url.slice("file:".length);
  if (!path.isAbsolute(file)) {
    process.env.DATABASE_URL = `file:${path
      .join(root, file)
      .split(path.sep)
      .join("/")}`;
  }
}

await import(pathToFileURL(server).href);
