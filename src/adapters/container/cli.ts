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
const PPI = process.env.TYPST_PPI ? Number(process.env.TYPST_PPI) : undefined;
const MAX_MEMORY = process.env.TYPST_MAX_MEMORY ? Number(process.env.TYPST_MAX_MEMORY) : undefined;

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

        const compileOpts: { ppi?: number; maxMemory?: number } = {};
        if (PPI !== undefined) compileOpts.ppi = PPI;
        if (MAX_MEMORY !== undefined) compileOpts.maxMemory = MAX_MEMORY;
        await compile(inputPath, outputPath, compileOpts);

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
