import { describe, it, expect, afterAll } from "@jest/globals";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { homedir, tmpdir } from "os";
import { join, relative } from "path";
import { expandHome, resolveLocalInputFile } from "../utils/localInputFile.js";

const dir = mkdtempSync(join(tmpdir(), "local-input-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const CSV = { extensions: [".csv"], maxBytes: 64, rejectSymlinks: true };
const file = (name: string, content: string) => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

describe("expandHome", () => {
  it("expands only ~ and ~/ with the user's home directory", () => {
    expect(expandHome("~")).toBe(homedir());
    expect(expandHome("~/a.csv")).toBe(join(homedir(), "a.csv"));
    expect(expandHome("~other/a.csv")).toBe("~other/a.csv");
    expect(expandHome("/abs/a.csv")).toBe("/abs/a.csv");
  });
});

describe("resolveLocalInputFile", () => {
  it("reads a regular file through one descriptor", () => {
    const path = file("ok.csv", "a,b\n1,2\n");
    const result = resolveLocalInputFile(path, CSV);
    expect(result.name).toBe("ok.csv");
    expect(result.data.toString()).toBe("a,b\n1,2\n");
  });

  it("resolves ~/ against the home directory", () => {
    // Only meaningful when the temp dir lives under home; otherwise the
    // expansion itself is covered above and this proves the not-found path.
    const underHome = relative(homedir(), join(dir, "ok.csv"));
    if (underHome.startsWith("..")) {
      expect(() =>
        resolveLocalInputFile("~/no-such-file-for-test.csv", CSV),
      ).toThrow("File not found: no-such-file-for-test.csv");
    } else {
      expect(resolveLocalInputFile(`~/${underHome}`, CSV).name).toBe("ok.csv");
    }
  });

  it("rejects a relative path", () => {
    expect(() => resolveLocalInputFile("chat.csv", CSV)).toThrow(
      "filePath must be an absolute path to a local .csv file",
    );
  });

  it("names only the file, never its directory, when it is missing", () => {
    let message = "";
    try {
      resolveLocalInputFile(join(dir, "missing.csv"), CSV);
    } catch (error: any) {
      message = error.message;
    }
    expect(message).toBe("File not found: missing.csv");
    expect(message).not.toContain(dir);
  });

  it("rejects a symlink when asked", () => {
    const target = file("target.csv", "x");
    const link = join(dir, "link.csv");
    symlinkSync(target, link);
    expect(() => resolveLocalInputFile(link, CSV)).toThrow(
      "link.csv is a symbolic link; pass the path of the file itself.",
    );
    expect(
      resolveLocalInputFile(link, { ...CSV, rejectSymlinks: false }).name,
    ).toBe("target.csv");
  });

  it("checks the extension on the real path", () => {
    const secret = file("secret.txt", "x");
    const disguised = join(dir, "disguised.csv");
    symlinkSync(secret, disguised);
    expect(() =>
      resolveLocalInputFile(disguised, { ...CSV, rejectSymlinks: false }),
    ).toThrow('Unsupported file "secret.txt". Only .csv files are supported.');
  });

  it("rejects a file of another type", () => {
    expect(() => resolveLocalInputFile(file("chat.txt", "x"), CSV)).toThrow(
      'Unsupported file "chat.txt". Only .csv files are supported.',
    );
  });

  it("rejects an empty file", () => {
    expect(() => resolveLocalInputFile(file("empty.csv", ""), CSV)).toThrow(
      "File is empty: empty.csv",
    );
  });

  it("rejects a file over the size limit", () => {
    expect(() =>
      resolveLocalInputFile(file("big.csv", "x".repeat(65)), CSV),
    ).toThrow("big.csv is 65 bytes, over the 64-byte limit.");
  });

  it("rejects a directory", () => {
    const csvDir = join(dir, "folder.csv");
    mkdirSync(csvDir);
    expect(() => resolveLocalInputFile(csvDir, CSV)).toThrow(
      "folder.csv is not a regular file.",
    );
  });

  it("names only the file and the error code when a parent directory loops", () => {
    symlinkSync(join(dir, "loop-b"), join(dir, "loop-a"));
    symlinkSync(join(dir, "loop-a"), join(dir, "loop-b"));
    let message = "";
    try {
      resolveLocalInputFile(join(dir, "loop-a", "chat.csv"), CSV);
    } catch (error: any) {
      message = error.message;
    }
    expect(message).toBe("chat.csv could not be read (ELOOP).");
  });

  it("names only the file and the error code when the link itself loops", () => {
    symlinkSync(join(dir, "self.csv"), join(dir, "self.csv"));
    let message = "";
    try {
      resolveLocalInputFile(join(dir, "self.csv"), {
        ...CSV,
        rejectSymlinks: false,
      });
    } catch (error: any) {
      message = error.message;
    }
    expect(message).toBe("self.csv could not be read (ELOOP).");
  });

  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  (isRoot ? it.skip : it)(
    "names only the file and the error code when it cannot be opened",
    () => {
      const locked = file("locked.csv", "a,b");
      chmodSync(locked, 0o000);
      try {
        expect(() => resolveLocalInputFile(locked, CSV)).toThrow(
          /^locked\.csv could not be read \(EACCES\)\.$/,
        );
      } finally {
        chmodSync(locked, 0o600);
      }
    },
  );
});
