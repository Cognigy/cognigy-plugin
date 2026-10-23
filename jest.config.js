export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "./tsconfig.test.json",
      },
    ],
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
  // Agent worktrees under .claude/ hold full repo copies; skip their tests.
  // Anchored to <rootDir> so a checkout that itself lives in a worktree still runs its tests.
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/.claude/worktrees/"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts", "!src/**/*.test.ts"],
};
