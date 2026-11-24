import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db";
import { MERCHANTS_SQL, BACKFILL_SQL } from "@ce/core";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.resolve(here, "../../../db/schema.sql"), "utf8");
await db().query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
await db().query(sql);
await db().query(MERCHANTS_SQL); // stores (the web app adds the first store from its settings)
await db().query(BACKFILL_SQL);
console.log("schema applied");
await db().end();
