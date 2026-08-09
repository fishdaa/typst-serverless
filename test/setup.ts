import { existsSync } from "node:fs";
import { join } from "node:path";

// Run before all tests. Sets AWS env so SDK clients don't error in integration tests.
process.env.AWS_REGION ??= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";

// Prefer the locally built fishdaa/typst binary when running Vitest directly;
// devbox still supplies it on PATH in the normal workflow. Override with
// TYPST_PATH when a different binary is required.
const localTypst = join(process.cwd(), ".bin", "typst");
process.env.TYPST_PATH ??= existsSync(localTypst) ? localTypst : "typst";
