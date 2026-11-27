/**
 * Reads a local file a tool was pointed at. The path comes from the model, so
 * errors name only the file (never the directory), symlinks can be refused,
 * the extension is checked on the real path, and the file is checked and read
 * through one descriptor so it cannot be swapped between the check and the read.
 */
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "fs";
import { homedir } from "os";
import { basename, isAbsolute, join } from "path";

export interface LocalInputFileOptions {
  /** Accepted extensions with their dot, e.g. [".csv"]. */
  extensions: string[];
  /** Largest accepted size in bytes. */
  maxBytes?: number;
  /** Refuse a path that is itself a symbolic link. */
  rejectSymlinks?: boolean;
}

export interface LocalInputFile {
  /** The real path, after symlinks. */
  path: string;
  /** The real file's name. */
  name: string;
  data: Buffer;
}

/** Expands `~` and `~/...` to the user's home directory; nothing else. */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Runs an fs call, turning its native error (which carries the full path) into
 * one that names only the file and the error code.
 */
function fsCall<T>(name: string, run: () => T): T {
  try {
    return run();
  } catch (error: any) {
    // The native error is deliberately not attached as `cause`: its message
    // and `path` carry the full path, which must not reach the model.
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      // eslint-disable-next-line preserve-caught-error -- keeps the full path out of the result
      throw new Error(`File not found: ${name}`);
    }
    // eslint-disable-next-line preserve-caught-error -- keeps the full path out of the result
    throw new Error(`${name} could not be read (${error?.code ?? "unknown"}).`);
  }
}

export function resolveLocalInputFile(
  filePath: string,
  options: LocalInputFileOptions,
): LocalInputFile {
  const extensions = options.extensions.join(" or ");
  const expanded = expandHome(filePath);
  if (!isAbsolute(expanded)) {
    throw new Error(
      `filePath must be an absolute path to a local ${extensions} file`,
    );
  }

  const stats = fsCall(basename(expanded), () => lstatSync(expanded));
  if (options.rejectSymlinks && stats.isSymbolicLink()) {
    throw new Error(
      `${basename(expanded)} is a symbolic link; pass the path of the file itself.`,
    );
  }

  const real = fsCall(basename(expanded), () => realpathSync(expanded));
  const name = basename(real);
  if (!options.extensions.some((ext) => name.toLowerCase().endsWith(ext))) {
    throw new Error(
      `Unsupported file "${name}". Only ${extensions} files are supported.`,
    );
  }

  const fd = fsCall(name, () => openSync(real, "r"));
  try {
    const opened = fsCall(name, () => fstatSync(fd));
    if (!opened.isFile()) throw new Error(`${name} is not a regular file.`);
    if (opened.size === 0) throw new Error(`File is empty: ${name}`);
    if (options.maxBytes !== undefined && opened.size > options.maxBytes) {
      throw new Error(
        `${name} is ${opened.size} bytes, over the ${options.maxBytes}-byte limit.`,
      );
    }
    const data = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < data.length) {
      const read = fsCall(name, () =>
        readSync(fd, data, offset, data.length - offset, offset),
      );
      if (read === 0) break;
      offset += read;
    }
    return { path: real, name, data: data.subarray(0, offset) };
  } finally {
    fsCall(name, () => closeSync(fd));
  }
}
