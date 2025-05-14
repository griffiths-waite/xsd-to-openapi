import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["**/*.test.ts"],
        root: "src",
        reporters: ["default"],
        coverage: {
            provider: "istanbul",
            reporter: ["lcov", "html", "text"],
            reportsDirectory: "../coverage",
        },
    },
});
