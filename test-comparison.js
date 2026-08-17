/* eslint-disable no-console */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = __dirname;
const root = { innerHTML: "", addEventListener() {}, querySelector() { return null; } };
const context = {
  console, URL, Blob, setTimeout, clearTimeout,
  document: { getElementById(id) { return id === "comparison-app" ? root : null; } },
  navigator: {},
  SB_UI: { escapeHtml(value) { return String(value == null ? "" : value); }, icon() { return ""; }, toast() {} }
};
context.window = context;
vm.createContext(context);
["utils.js", "shared-data.js", "comparison-tool.js"].forEach((file) => vm.runInContext(fs.readFileSync(path.join(base, file), "utf8"), context, { filename: file }));

const api = context.__SB_COMPARISON_TEST__;
const dimensions = context.SB_SHARED_DATA.MOS_DIMENSIONS;
const eloDimensions = context.SB_SHARED_DATA.ELO_DIMENSIONS;
const ids = ["R-TEST-A", "R-TEST-B"];
function annotation() {
  return {
    schema_version: context.SB_SHARED_DATA.REVIEW_SCHEMA,
    work_order_fingerprint: "same-fingerprint",
    batch_id: "BATCH-TEST", task_bundle_id: "TASK-TEST", case_id: "CASE-TEST", model_count: 2,
    work_order: { candidates: ids.map((blind_id, index) => ({ slot: index + 1, blind_id, url: `https://example.com/${index}.mp3` })) },
    mos: ids.map((blind_id, index) => ({ subtask_id: `MOS-0${index + 1}`, blind_id, scores: Object.fromEntries(dimensions.map((dimension) => [dimension.key, 4])), low_score_issues: {}, notes: {}, instruction_deductions: [], instruction_note: "" })),
    elo_matches: [{ subtask_id: "ELO-01", left_blind_id: ids[0], right_blind_id: ids[1], dimension_results: Object.fromEntries(eloDimensions.map((dimension) => [dimension.key, "left"])), note: "" }]
  };
}

const reference = annotation();
const candidate = annotation();
candidate.mos[0].scores.melody = 3;
candidate.mos[1].scores.audio_quality = 1;
candidate.elo_matches[0].dimension_results.overall = "right";
assert.deepStrictEqual(Array.from(api.validatePair(reference, candidate)), []);
const result = api.compare(reference, candidate, 2);
assert.strictEqual(result.metrics.acceptable, 1, "one-point MOS difference must be acceptable at ±2");
assert.strictEqual(result.metrics.outliers, 1, "three-point MOS difference must require review at ±2");
assert.strictEqual(result.metrics.eloSame, result.metrics.eloTotal - 1, "ELO mismatch must be tracked independently");

const strict = api.compare(reference, candidate, 1);
assert.strictEqual(strict.metrics.acceptable, 1);
assert.strictEqual(strict.metrics.outliers, 1);
candidate.mos[0].scores.melody = 2;
assert.strictEqual(api.compare(reference, candidate, 1).metrics.outliers, 2, "two-point difference must exceed a ±1 policy");
assert(api.collectChanges(reference, candidate).some((change) => change.field_path === "scores.melody"));

const wrongCase = annotation(); wrongCase.work_order_fingerprint = "wrong";
assert(api.validatePair(reference, wrongCase).some((error) => error.includes("work_order_fingerprint")), "different work orders must be rejected");
assert(root.innerHTML.includes("管理员专用"), "administrator page must identify its restricted purpose");
console.log("Administrator reference comparison regression passed.");
