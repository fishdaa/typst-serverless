import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
    test: {
        globals: false,
        include: ["test/**/*.test.{js,ts}"],
        environment: "node",
        setupFiles: ["./test/setup.ts"],
    },
    resolve: {
        alias: {
            "@core": resolve(__dirname, "src/core"),
            "@adapters": resolve(__dirname, "src/adapters"),
        },
    },
});
