import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.resolve(here, "../../../db/schema.sql"), "utf8");
await db().query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
await db().query(sql);
console.log("schema applied");
await db().end();
