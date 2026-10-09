#!/usr/bin/env node
/* Compare a `claude plugin eval` run against the committed baseline. Run:
 *   npm run evals:compare              newest run in plugin/evals/results/
 *   npm run evals:compare -- <file>    a specific aggregate-result.json
 *   npm run evals:compare -- --update  write the run as the new baseline
 * Exits 1 when a case or grader passes less often than in the baseline, or when
 * a run errored (timeout, usage/rate limit): errored runs are still graded, so
 * their pass rates are not comparable. --update needs a clean run of every case.
 *
 * Each case carries a fingerprint of its own files (prompt, graders, mocks)
 * plus the suite's shared mocks, so an edited case reads as "changed, re-baseline"
 * instead of a regression. _tools.json is left out on purpose: tool descriptions
 * are the plugin surface under test, not part of the case.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

const PLUGIN_DIR = "plugin";
const EVALS_DIR = join(PLUGIN_DIR, "evals");
const RESULTS_DIR = join(EVALS_DIR, "results");
const BASELINE_FILE = join(EVALS_DIR, "baseline.json");
const SHARED_MOCKS_DIR = join(EVALS_DIR, "mocks");

const args = process.argv.slice(2);
const update = args.includes("--update");
const resultFile = args.find((a) => !a.startsWith("--")) ?? newestResult();

function newestResult() {
  const runs = existsSync(RESULTS_DIR)
    ? readdirSync(RESULTS_DIR)
        .filter((d) =>
          existsSync(join(RESULTS_DIR, d, "aggregate-result.json")),
        )
        .sort()
    : [];
  if (!runs.length) {
    console.error(`No runs in ${RESULTS_DIR}. Run \`npm run evals\` first.`);
    process.exit(1);
  }
  return join(RESULTS_DIR, runs.at(-1), "aggregate-result.json");
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name !== "_tools.json")
    .map((e) => join(e.parentPath ?? e.path, e.name))
    .filter((f) => !f.includes(`${join("mocks", ".replay")}`))
    .sort();
}

function fingerprint(caseDir) {
  const hash = createHash("sha256");
  for (const f of [...filesUnder(SHARED_MOCKS_DIR), ...filesUnder(caseDir)]) {
    // "/" on every OS, so a baseline made on macOS still matches on Windows.
    const path = relative(EVALS_DIR, f).split(sep).join("/");
    hash.update(path).update("\0").update(readFileSync(f));
  }
  return hash.digest("hex").slice(0, 12);
}

// Case dirs on disk (a dir holding prompt.md or case.yaml), by name.
function casesOnDisk() {
  return readdirSync(EVALS_DIR, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && ["prompt.md", "case.yaml"].includes(e.name))
    .map((e) => relative(EVALS_DIR, e.parentPath ?? e.path))
    .filter((d) => !d.split(sep).some((p) => p === "results" || p === "mocks"))
    .map((d) => basename(d));
}

function summarize(result) {
  const cases = {};
  for (const c of result.cases) {
    const runs = c.arms?.with ?? [];
    const graders = {};
    for (const g of c.graders) {
      const passed = runs.filter(
        (r) => r.graders.find((rg) => rg.name === g.name)?.passed,
      ).length;
      graders[g.name] = `${passed}/${runs.length}`;
    }
    cases[c.name] = {
      fingerprint: fingerprint(join(PLUGIN_DIR, c.dir)),
      score: Math.round(c.aggregates.score * 100) / 100,
      graders,
      errors: runs.filter((r) => r.error).map((r) => r.error),
    };
  }
  return cases;
}

const result = JSON.parse(readFileSync(resultFile, "utf8"));
if (result.partial) {
  console.error(`${resultFile} is a partial run (${result.partialReason}).`);
  process.exit(1);
}
const current = summarize(result);
const errored = Object.entries(current).filter(([, c]) => c.errors.length);

if (update) {
  const missing = [...new Set(casesOnDisk())].filter((n) => !current[n]);
  if (missing.length || errored.length) {
    console.error(
      `Not updating the baseline: it needs a clean run of every case.${missing.length ? `\n  not in this run: ${missing.join(", ")}` : ""}${errored.map(([n, c]) => `\n  errored: ${n} (${c.errors[0]})`).join("")}`,
    );
    process.exit(1);
  }
  for (const c of Object.values(current)) delete c.errors;
  const commit = execSync("git rev-parse --short HEAD").toString().trim();
  const baseline = {
    takenAt: result.startedAt,
    commit,
    claudeVersion: result.claudeVersion,
    pluginVersion: result.suite.plugins?.[0]?.version,
    cases: current,
  };
  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`Wrote ${BASELINE_FILE} from ${resultFile}`);
  process.exit(0);
}

if (!existsSync(BASELINE_FILE)) {
  console.error(`No ${BASELINE_FILE}. Create one with --update.`);
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
const rate = (s) => {
  const [p, n] = s.split("/").map(Number);
  return n ? p / n : 0;
};

let regressions = 0;
console.log(
  `Baseline ${baseline.commit} (Claude Code ${baseline.claudeVersion}) vs ${resultFile} (Claude Code ${result.claudeVersion})\n`,
);
for (const [name, cur] of Object.entries(current)) {
  const base = baseline.cases[name];
  if (cur.errors.length) {
    console.log(
      `  ERRORED  ${name}  ${cur.errors.length} run(s) ended abnormally (${cur.errors[0]}) — not comparable, re-run`,
    );
    continue;
  }
  if (!base) {
    console.log(`  new      ${name}  score ${cur.score}`);
    continue;
  }
  if (base.fingerprint !== cur.fingerprint) {
    console.log(
      `  changed  ${name}  case files differ — re-baseline with --update`,
    );
    continue;
  }
  const drops = Object.entries(cur.graders)
    .filter(([g, s]) => base.graders[g] && rate(s) < rate(base.graders[g]))
    .map(([g, s]) => `${g} ${base.graders[g]} → ${s}`);
  regressions += drops.length;
  const status = drops.length
    ? "WORSE"
    : cur.score > base.score
      ? "better"
      : "same";
  console.log(
    `  ${status.padEnd(7)}  ${name}  score ${base.score} → ${cur.score}${drops.length ? `  (${drops.join(", ")})` : ""}`,
  );
}
for (const name of Object.keys(baseline.cases)) {
  if (!current[name]) console.log(`  not run  ${name}`);
}

if (errored.length) {
  console.log(
    `\n${errored.length} case(s) had errored runs. Check for usage or rate limits, then re-run them.`,
  );
}
if (regressions) {
  console.log(
    `\n${regressions} grader(s) dropped. Re-run those cases (--runs 5) before calling it a regression; one flaky run moves 3/3 to 2/3.`,
  );
  process.exit(1);
}
if (errored.length) process.exit(1);
