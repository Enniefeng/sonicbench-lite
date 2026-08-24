/* eslint-disable no-console */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = __dirname;
const root = { innerHTML: "", addEventListener() {}, querySelector() { return null; } };
const document = {
  getElementById(id) { return id === "aggregate-app" ? root : null; },
  createElement() { return { click() {}, remove() {} }; },
  body: { appendChild() {} }
};
const context = { URL, Blob, console, crypto: crypto.webcrypto, document, navigator: {}, setTimeout, clearTimeout };
context.window = context;
context.SB_UI = { escapeHtml: (value) => String(value), icon: (name) => `<i>${name}</i>`, toast() {} };
vm.createContext(context);
["utils.js", "shared-data.js", "aggregation-tool.js"].forEach((file) => vm.runInContext(fs.readFileSync(path.join(base, file), "utf8"), context, { filename: file }));

const api = context.SB_AGGREGATION_TEST;
const ids = ["BLIND-A", "BLIND-B"];
const mapping = {
  mapping_version: "sonicbench-mapping/flexible-model/1.0",
  batch_id: "BATCH-TEST",
  model_count: 2,
  entries: ids.map((blindId, index) => ({
    batch_id: "BATCH-TEST",
    task_bundle_id: "TASK-1",
    case_id: "CASE-1",
    blind_id: blindId,
    source_model_key: `model_${index + 1}`,
    source_column: `model_${index + 1}_url`,
    source_url: `https://example.com/${index + 1}.mp3`
  }))
};
const scores = Object.fromEntries(context.SB_SHARED_DATA.MOS_DIMENSIONS.map((dimension) => [dimension.key, 4]));
const dimensionResults = Object.fromEntries(context.SB_SHARED_DATA.ELO_DIMENSIONS.map((dimension) => [dimension.key, "left"]));
const annotation = {
  schema_version: "sonicbench-annotation-result/flexible-model/1.0",
  batch_id: "BATCH-TEST",
  task_bundle_id: "TASK-1",
  case_id: "CASE-1",
  model_count: 2,
  work_order: { candidates: ids.map((blind_id) => ({ blind_id })) },
  mos: ids.map((blind_id, index) => ({ subtask_id: `MOS-0${index + 1}`, blind_id, scores })),
  elo_matches: [{ subtask_id: "ELO-01", left_blind_id: ids[0], right_blind_id: ids[1], dimension_results: dimensionResults }],
  status: "complete"
};

const bundle = api.parseMapping(JSON.stringify(mapping));
assert.strictEqual(bundle.index.size, 2);
assert.strictEqual(api.parseResults(JSON.stringify(annotation)).length, 1);
assert.strictEqual(api.parseResults(JSON.stringify([annotation])).length, 1);
assert.strictEqual(api.parseResults(context.SB_UTILS.serializeCSV([["annotation_result_json"], [JSON.stringify(annotation)]])).length, 1);
const finalSnapshot = context.SB_SHARED_DATA.finalSnapshotResult({ ...annotation, result_revision: 3, revision_remark: "changed", revision_history: [{ revision: 3, changes: [] }] });
const parsedSnapshot = api.parseResults(JSON.stringify(finalSnapshot));
assert.strictEqual(parsedSnapshot.length, 1, "aggregation must accept the history-free final snapshot");
assert.strictEqual(parsedSnapshot[0].result_revision, 3, "final snapshot aggregation input must retain its revision number");
assert.strictEqual(parsedSnapshot[0].revision_history, undefined, "final snapshot must omit modification history");
const resolved = api.validateAndResolve([annotation], bundle);
const mos = api.calculateMos(resolved);
const elo = api.calculateElo(resolved);
assert.strictEqual(mos.summary.length, 2);
assert.strictEqual(mos.summary[0].overall, 4);
assert.strictEqual(elo.summary.length, 2);
assert(elo.summary.find((item) => item.source_model_key === "model_1").overall > 1500);
assert(elo.summary.find((item) => item.source_model_key === "model_2").overall < 1500);
assert(api.mosSummaryCsv({ mos_summary: mos.summary }).includes("source_model_key"));
assert(api.eloSummaryCsv({ elo_summary: elo.summary }).includes("overall_elo"));
assert(root.innerHTML.includes("还原成可决策的模型指标"));

console.log("Aggregation mapping, MOS, and ELO regression passed.");
