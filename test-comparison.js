/* eslint-disable no-console */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = __dirname;
let downloadedFilename = "";
let audioDockRenderCount = 0;
const body = { appendChild() {}, insertBefore(node) { node.parentNode = body; } };
const root = {
  innerHTML: "", addEventListener() {}, querySelector(selector) {
    if (selector !== "[data-audio-dock-anchor]" || !this.innerHTML.includes("data-audio-dock-anchor")) return null;
    return { replaceWith(node) { node.parentNode = root; root.innerHTML = root.innerHTML.replace('<div data-audio-dock-anchor></div>', node.innerHTML); } };
  }
};
const audioDock = {
  _innerHTML: "", hidden: true, dataset: {}, parentNode: body,
  get innerHTML() { return this._innerHTML; },
  set innerHTML(value) { this._innerHTML = value; audioDockRenderCount += 1; },
  querySelectorAll() { return []; }
};
const canvasContext = new Proxy({ measureText(value) { return { width: String(value).length * 7 }; } }, { get(target, key) { return key in target ? target[key] : () => {}; }, set(target, key, value) { target[key] = value; return true; } });
const context = {
  console, URL, Blob, setTimeout, clearTimeout,
  document: {
    getElementById(id) { return id === "comparison-app" ? root : id === "comparison-audio-dock" ? audioDock : null; },
    createElement(tag) {
      if (tag === "canvas") return { width: 0, height: 0, getContext() { return canvasContext; }, toBlob(callback) { callback(new Blob(["png"], { type: "image/png" })); } };
      return { href: "", set download(value) { downloadedFilename = value; }, click() {}, remove() {} };
    },
    body
  },
  navigator: {},
  SB_UI: { escapeHtml(value) { return String(value == null ? "" : value); }, icon() { return ""; }, toast() {} }
};
context.window = context;
vm.createContext(context);
["utils.js", "shared-data.js", "comparison-tool.js"].forEach((file) => vm.runInContext(fs.readFileSync(path.join(base, file), "utf8"), context, { filename: file }));

const api = context.__SB_COMPARISON_TEST__;
api.makeDemo();
assert(root.innerHTML.includes("TASK-DEMO-COMPARE"), "demo loader must render valid reference and annotator JSON");
const dimensions = context.SB_SHARED_DATA.MOS_DIMENSIONS;
const eloDimensions = context.SB_SHARED_DATA.ELO_DIMENSIONS;
const ids = ["R-TEST-A", "R-TEST-B"];
function annotation() {
  return {
    schema_version: context.SB_SHARED_DATA.REVIEW_SCHEMA,
    work_order_fingerprint: "same-fingerprint",
    batch_id: "BATCH-TEST", task_bundle_id: "TASK-TEST", case_id: "CASE-TEST", model_count: 2,
    work_order: { candidates: ids.map((blind_id, index) => ({ slot: index + 1, blind_id, url: index ? `[https://example.com/${index}.mp3](https://example.com/${index}.mp3)` : `https://example.com/${index}.mp3` })) },
    mos: ids.map((blind_id, index) => ({ subtask_id: `MOS-0${index + 1}`, blind_id, scores: Object.fromEntries(dimensions.map((dimension) => [dimension.key, 4])), low_score_issues: {}, notes: {}, instruction_deductions: [], instruction_note: "" })),
    elo_matches: [{ subtask_id: "ELO-01", left_blind_id: ids[0], right_blind_id: ids[1], dimension_results: Object.fromEntries(eloDimensions.map((dimension) => [dimension.key, "left"])), note: "" }]
  };
}

const reference = annotation();
const candidate = annotation();
const finalSnapshot = context.SB_SHARED_DATA.finalSnapshotResult({ ...candidate, result_revision: 2, revision_history: [{ revision: 2, changes: [] }] });
assert.strictEqual(api.parseJson(JSON.stringify(finalSnapshot), "标注结果").error, undefined, "comparison must accept the standard history-free final snapshot without translation");
candidate.mos[0].scores.melody = 3;
candidate.mos[0].low_score_issues.melody = ["主旋律难以分辨"];
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

api.state.reference = JSON.parse(JSON.stringify(reference));
api.state.original = JSON.parse(JSON.stringify(candidate));
api.state.editable = JSON.parse(JSON.stringify(candidate));
api.state.initial = api.compare(api.state.reference, api.state.original, api.state.tolerance);
api.state.selectedBlindId = ids[0];
api.state.expanded.add(`${ids[0]}:melody`);
api.state.screen = "compare";
api.render();
const correctedResult = api.buildCorrectedResult();
const refinedResult = api.buildRefinedResult();
assert.strictEqual(refinedResult.revision_history, undefined, "administrator refined result must omit revision history");
assert.strictEqual(refinedResult.revision_remark, undefined, "administrator refined result must omit the revision remark");
assert.strictEqual(refinedResult.result_revision, correctedResult.result_revision, "administrator refined result must retain the corrected revision number");
assert.deepStrictEqual(refinedResult.admin_quality_review, correctedResult.admin_quality_review, "administrator refined result must retain review metadata");
assert(/^\d{8}-\d{6}$/.test(api.exportTimestamp()), "administrator result filenames need a filesystem-safe timestamp");
assert.strictEqual(api.buildResultExportBundle().preferFull, true, "administrator save must prefer the full audit result when it fits");
assert(root.innerHTML.includes("推荐保存：完整审计 JSON"), "comparison page must visibly recommend the full audit result below the limit");
assert(root.innerHTML.includes("下载完整审计 JSON"), "comparison page must preserve a full revision-history download");
assert.strictEqual(context.SB_SHARED_DATA.RESULT_CELL_CHAR_LIMIT, 50000, "spreadsheet result limit must be 50,000 characters");
assert(root.innerHTML.includes("未超过 5 万"), "comparison page must display the 50,000-character status");
const comparisonOriginal = JSON.parse(JSON.stringify(api.state.original));
const comparisonEditable = JSON.parse(JSON.stringify(api.state.editable));
api.state.original.revision_history = [{ revision: 1, updated_at: null, remark: "历史记录".repeat(20000), changes: [] }];
api.state.editable.revision_history = JSON.parse(JSON.stringify(api.state.original.revision_history));
api.render();
assert.strictEqual(api.buildResultExportBundle().preferFull, false, "administrator save must switch to refined output when audit history exceeds 50,000 characters");
assert(root.innerHTML.includes("推荐保存：精简结果 JSON"), "comparison page must clearly recommend the refined result only after full audit overflow");
api.state.original = comparisonOriginal;
api.state.editable = comparisonEditable;
api.render();
assert(root.innerHTML.includes("下载对比长图 PNG"), "comparison page must provide a PNG long-image export");
assert(root.innerHTML.includes("Case 音频试听"), "comparison page must provide a dedicated case audio panel");
assert(root.innerHTML.includes('class="comparison-audio-player"'), "valid candidate URLs must render playable audio controls");
assert(root.innerHTML.includes('data-export-exclude="true"'), "the audio panel must be explicitly excluded from visual report content");
assert(root.innerHTML.includes("https://example.com/0.mp3"), "the audio player must use the self-contained work-order URL");
assert(root.innerHTML.includes('src="https://example.com/1.mp3"'), "Markdown-wrapped audio URLs must be normalized before playback");
const stableAudioRenderCount = audioDockRenderCount;
api.render();
assert.strictEqual(audioDockRenderCount, stableAudioRenderCount, "comparison updates must reuse the existing audio DOM instead of rebuilding players");
assert(!root.innerHTML.includes('data-action="download-report"'), "the primary report download must no longer be JSON");
assert(root.innerHTML.includes("主旋律难以分辨"), "comparison editor must reuse the evaluator's exact low-score options");
assert(root.innerHTML.includes("旋律听感生硬/不顺/杂乱"), "comparison editor must expose the full evaluator option set");
assert.strictEqual(typeof api.downloadComparisonImage, "function", "PNG export must be testable as a first-class action");
const imageDownload = api.downloadComparisonImage();
assert(imageDownload && typeof imageDownload.then === "function", "PNG export must return an asynchronous completion signal");
assert.strictEqual(downloadedFilename, "comparison-CASE-TEST.png", "PNG export must use a clear Case-based filename");

const wrongCase = annotation(); wrongCase.work_order_fingerprint = "wrong";
assert(api.validatePair(reference, wrongCase).some((error) => error.includes("work_order_fingerprint")), "different work orders must be rejected");
const wrongAudio = annotation(); wrongAudio.work_order.candidates[0].url = "https://example.com/different.mp3";
assert(api.validatePair(reference, wrongAudio).some((error) => error.includes("R-TEST-A 的音频 URL 不一致")), "candidate audio URLs must match exactly across both answers");
const wrongCaseInfo = annotation(); wrongCaseInfo.work_order.tag = "different case prompt";
assert(api.validatePair(reference, wrongCaseInfo).some((error) => error.includes("Case 的 tag 信息不一致")), "case source information must match across both answers");
assert(root.innerHTML.includes("管理员专用"), "administrator page must identify its restricted purpose");
assert(root.innerHTML.includes("继续对比下一份"), "comparison result must provide a direct batch-comparison continuation action");
const preservedReference = api.state.referenceText;
api.state.candidateText = JSON.stringify(candidate);
api.prepareNextComparison();
assert.strictEqual(api.state.referenceText, preservedReference, "batch continuation must preserve the reference answer");
assert.strictEqual(api.state.candidateText, "", "batch continuation must clear only the annotator answer");
assert.strictEqual(api.state.screen, "import", "batch continuation must return to the comparison import screen");
assert(root.innerHTML.includes("已保留 · 验收基准"), "the import screen must clearly indicate that the reference answer was retained");
console.log("Administrator reference comparison regression passed.");
