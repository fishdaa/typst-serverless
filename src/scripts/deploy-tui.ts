/**
 * Interactive TUI for Typst Serverless Lambda deploy (Phase 5).
 * Prompts for SQS, S3, API Gateway options and runs pulumi config set.
 */
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// From dist/scripts/ → project root
const projectRoot = resolve(__dirname, "../..");
const pulumiDir = resolve(projectRoot, "src/adapters/lambda-layer/pulumi");

function ask(rl: ReturnType<typeof createInterface>, question: string, defaultValue: string): Promise<string> {
    return new Promise((res) => {
        const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
        rl.question(prompt, (answer) => res(answer.trim() || defaultValue));
    });
}

function askBool(rl: ReturnType<typeof createInterface>, question: string, defaultValue: boolean): Promise<boolean> {
    return new Promise((res) => {
        const defStr = defaultValue ? "Y/n" : "y/N";
        rl.question(`${question} [${defStr}]: `, (answer) => {
            const a = answer.trim().toLowerCase();
            if (!a) res(defaultValue);
            else res(a === "y" || a === "yes" || a === "true" || a === "1");
        });
    });
}

function pulumiConfigSet(key: string, value: string | boolean): boolean {
    const v = typeof value === "boolean" ? String(value) : value;
    const r = spawnSync("pulumi", ["config", "set", key, v, "--non-interactive"], {
        cwd: pulumiDir,
        stdio: "inherit",
    });
    return r.status === 0;
}

async function main() {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    console.log("\nTypst Serverless — Lambda Deploy (Interactive)\n");

    const enableApi = await askBool(rl, "Enable API Gateway (REST endpoints)?", true);
    const enableSqs = await askBool(rl, "Enable SQS for batch jobs (parallelized, 1 doc per Lambda)?", false);
    const retention = await ask(rl, "S3 output retention (days)", "7");
    const customerBuckets = await ask(
        rl,
        "Customer S3 output buckets (comma-separated, optional)",
        ""
    );

    rl.close();

    console.log("\nApplying config...");
    pulumiConfigSet("enableApiGateway", enableApi);
    pulumiConfigSet("enableSqs", enableSqs);
    pulumiConfigSet("s3RetentionDays", retention);
    if (customerBuckets) {
        pulumiConfigSet("customerOutputBuckets", customerBuckets);
    }

    console.log("\nConfig summary:");
    console.log(`  API Gateway: ${enableApi ? "enabled" : "disabled"}`);
    console.log(`  SQS (batch): ${enableSqs ? "enabled" : "disabled"}`);
    console.log(`  S3 retention: ${retention} days`);
    if (customerBuckets) console.log(`  Customer buckets: ${customerBuckets}`);

    console.log("\nRun: npm run build:lambda && npm run deploy:lambda\n");
}

main().catch(console.error);
