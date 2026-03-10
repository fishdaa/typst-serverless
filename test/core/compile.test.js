/**
 * Core compile logic unit tests.
 * Tests: compile .typ -> PDF, error handling, output path.
 * Run via `npm test` (inside Docker) — typst is available in the container.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { compile } from "../../src/core/compile.js";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

const FIXTURES = join(import.meta.dirname, "../fixtures");

describe("core/compile", () => {
  it("compiles minimal.typ to PDF", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "typst-test-"));
    try {
      const input = join(FIXTURES, "minimal.typ");
      const output = join(outDir, "out.pdf");
      await compile(input, output);
      assert(existsSync(output), "Output PDF should exist");
      const buf = readFileSync(output);
      assert(buf.length > 0, "Output should be non-empty");
      assert(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44, "Output should be valid PDF header %PD");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("compiles simple-doc.typ to PDF", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "typst-test-"));
    try {
      const input = join(FIXTURES, "simple-doc.typ");
      const output = join(outDir, "simple.pdf");
      await compile(input, output);
      assert(existsSync(output), "Output PDF should exist");
      const buf = readFileSync(output);
      assert(buf.length > 100, "Output should be meaningful size");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("throws on invalid input path", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "typst-test-"));
    try {
      await assert.rejects(
        () => compile(join(FIXTURES, "nonexistent.typ"), join(outDir, "out.pdf")),
        /ENOENT|not found|No such file/i
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("throws on invalid Typst syntax", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "typst-test-"));
    try {
      const input = join(FIXTURES, "invalid-syntax.typ");
      await assert.rejects(
        () => compile(input, join(outDir, "out.pdf")),
        /compile|error|failed|invalid/i
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
