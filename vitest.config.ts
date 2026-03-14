import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
    test: {
        globals: false,
        include: ["test/**/*.spec.{js,ts}"],
        environment: "node",
        setupFiles: ["./test/setup.ts"],
    },
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
        },
    },
});
