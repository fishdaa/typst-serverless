/**
 * State interface unit tests.
 * Tests: in-memory and file-based state implementations.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { createInMemoryState, createFileState } from "../../src/core/state.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("core/state - InMemoryState", () => {
  it("get/set document status", async () => {
    const state = createInMemoryState();
    const id = "doc-123";
    await state.set(id, { status: "pending", createdAt: Date.now() });
    const doc = await state.get(id);
    assert.strictEqual(doc?.status, "pending");
  });

  it("update document status", async () => {
    const state = createInMemoryState();
    const id = "doc-456";
    await state.set(id, { status: "pending" });
    await state.update(id, { status: "completed" });
    const doc = await state.get(id);
    assert.strictEqual(doc?.status, "completed");
  });

  it("returns undefined for missing document", async () => {
    const state = createInMemoryState();
    const doc = await state.get("nonexistent");
    assert.strictEqual(doc, undefined);
  });
});

describe("core/state - FileState", () => {
  it("get/set document status to file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "typst-state-"));
    try {
      const state = createFileState(dir);
      const id = "doc-789";
      await state.set(id, { status: "compiling", outputPath: "/workspace/out.pdf" });
      const doc = await state.get(id);
      assert.strictEqual(doc?.status, "compiling");
      assert.strictEqual(doc?.outputPath, "/workspace/out.pdf");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("update persists to file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "typst-state-"));
    try {
      const state = createFileState(dir);
      const id = "doc-update";
      await state.set(id, { status: "pending" });
      await state.update(id, { status: "completed" });
      const doc = await state.get(id);
      assert.strictEqual(doc?.status, "completed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined for missing document", async () => {
    const dir = mkdtempSync(join(tmpdir(), "typst-state-"));
    try {
      const state = createFileState(dir);
      const doc = await state.get("nonexistent");
      assert.strictEqual(doc, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
