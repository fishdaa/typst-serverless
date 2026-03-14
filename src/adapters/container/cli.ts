#!/usr/bin/env node
/**
 * Container CLI adapter.
 * Invokes core compile; supports volume, pipe, state via env vars.
 */
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { compile } from "@/core/compile.js";
import { createFileState } from "@/core/state.js";
import { randomUUID } from "node:crypto";

const WORKSPACE = process.env.TYPST_WORKSPACE || "/workspace";
const MAIN = process.env.TYPST_MAIN || "main.typ";
const OUTPUT = process.env.TYPST_OUTPUT || "output.pdf";
const PIPE = process.env.TYPST_PIPE === "true";
const STATE = process.env.TYPST_STATE === "true";

const inputPath = join(WORKSPACE, MAIN);
const outputPath = join(WORKSPACE, OUTPUT);
const stateDir = join(WORKSPACE, ".typst-state");

let docId: string | undefined;

async function main(): Promise<void> {
    try {
        docId = randomUUID();
        if (STATE) {
            const state = createFileState(stateDir);
            await state.set(docId, { status: "pending", createdAt: Date.now() });
            await state.update(docId, { status: "compiling" });
        }

        await compile(inputPath, outputPath);

        if (STATE && docId) {
            const state = createFileState(stateDir);
            await state.update(docId, { status: "completed", outputPath });
        }

        if (PIPE) {
            const buf = readFileSync(outputPath);
            process.stdout.write(buf);
        }

        process.exit(0);
    } catch (err) {
        if (STATE && docId) {
            try {
                const state = createFileState(stateDir);
                await state.update(docId, { status: "failed", error: String((err as Error).message) });
            } catch {}
        }
        console.error((err as Error).message || err);
        process.exit(1);
    }
}

main();
