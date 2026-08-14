/* eslint-disable no-console */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = __dirname;

function fakeRoot() {
  return {
    innerHTML: "",
    scrollTop: 0,
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

function makeContext(appId) {
  const root = fakeRoot();
  const storage = new Map();
  const document = {
    getElementById(id) { return id === appId ? root : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return fakeRoot(); },
    body: { appendChild() {}, removeChild() {} }
  };
  const context = {
    URL,
    Blob,
    console,
    crypto: crypto.webcrypto,
    document,
    navigator: {},
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    confirm() { return true; }
  };
  context.window = context;
  context.window.crypto = crypto.webcrypto;
  context.window.localStorage = context.localStorage;
  context.SB_UI = {
    escapeHtml(value) { return String(value); },
    icon(name) { return `<i>${name}</i>`; },
    toast() {}
  };
  vm.createContext(context);
  ["utils.js", "shared-data.js"].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(base, file), "utf8"), context, { filename: file });
  });
  return { context, root };
}

function instrument(file, exportName, exports) {
  const source = fs.readFileSync(path.join(base, file), "utf8");
  const marker = "\n  render();\n})();";
  assert(source.includes(marker), `${file} test hook marker missing`);
  return source.replace(marker, `\n  window.${exportName} = { ${exports.join(", ")} };\n  render();\n})();`);
}

function adminLine(modelCount) {
  const { context, root } = makeContext("admin-app");
  vm.runInContext(fs.readFileSync(path.join(base, "admin-data.js"), "utf8"), context, { filename: "admin-data.js" });
  vm.runInContext(instrument("admin-tool.js", "__ADMIN_TEST__", ["state", "inspectRaw", "generateWorkOrder"]), context, { filename: "admin-tool.js" });
  const headers = ["case_id", "tag", "lyrics"]
    .concat(Array.from({ length: 6 }, (_, index) => `model_${index + 1}_url`));
  const row = ["CASE-DYNAMIC", "dynamic test", "line 1\nline 2"]
    .concat(Array.from({ length: modelCount }, (_, index) => {
      const url = `https://example.com/${modelCount}/audio-${index + 1}.mp3`;
      return index === 0 ? `[${url}](${url})` : url;
    }))
    .concat(Array.from({ length: 6 - modelCount }, () => ""));
  context.__ADMIN_TEST__.state.rawText = context.SB_UTILS.serializeCSV([headers, row]);
  context.__ADMIN_TEST__.generateWorkOrder();
  const state = context.__ADMIN_TEST__.state;
  assert.deepStrictEqual(Array.from(state.inspection.errors), [], `${modelCount} model admin errors`);
  assert.strictEqual(state.modelCount, modelCount);
  assert.strictEqual(state.generatedRows.length, 1);
  assert.strictEqual(state.mapping.model_count, modelCount);
  assert.strictEqual(state.mapping.entries.length, modelCount);
  assert(state.generatedRows[0].candidates.every((candidate) => /^https?:\/\//.test(candidate.url)), "admin must unwrap Markdown URLs");
  assert(state.mapping.entries.every((entry) => !entry.source_url.startsWith("[")), "mapping must store canonical URLs");
  const csvRows = context.SB_UTILS.parseDelimitedDetailed(state.workOrderCsv).rows;
  assert.strictEqual(csvRows[0].length, 8 + modelCount * 2);
  assert.strictEqual(csvRows[1].length, 8 + modelCount * 2);
  assert(root.innerHTML.includes(`${modelCount}</strong><span>MOS`));
  assert(root.innerHTML.includes(`${modelCount * (modelCount - 1) / 2}</strong><span>ELO`));
  assert(!root.innerHTML.includes("6 模型示例 CSV"), "admin actions should not expose a fixed six-model shortcut");
  return state.generatedLines[0];
}

function testReviewer(line, modelCount) {
  const { context, root } = makeContext("review-app");
  vm.runInContext(instrument("review-tool.js", "__REVIEW_TEST__", [
    "state", "parseWorkOrder", "parseResultJson", "completeAnnotationForDemo", "loadTask", "validateAnnotation", "render"
  ]), context, { filename: "review-tool.js" });
  const api = context.__REVIEW_TEST__;
  assert(root.innerHTML.includes("import-task-summary"), "review import must use the responsive task summary");
  assert(root.innerHTML.includes("3–21</b>"), "review import must keep the task range on one semantic value");
  const lineCells = context.SB_UTILS.parseDelimitedDetailed(line).rows[0];
  const rawUrl = lineCells[7];
  lineCells[7] = `[${rawUrl}](${rawUrl})`;
  const parsed = api.parseWorkOrder(context.SB_UTILS.serializeTSVRow(lineCells));
  assert.deepStrictEqual(Array.from(parsed.errors), [], `${modelCount} model reviewer errors`);
  assert.strictEqual(parsed.task.candidates[0].url, rawUrl, "reviewer must unwrap Markdown URLs before playback");
  assert.strictEqual(context.SB_UTILS.decodeFlatText(parsed.task.cells[7]), rawUrl, "canonical work order must retain the raw URL");
  assert.strictEqual(parsed.task.modelCount, modelCount);
  assert.strictEqual(parsed.task.eloMatchCount, modelCount * (modelCount - 1) / 2);
  assert.strictEqual(parsed.task.totalSubtaskCount, modelCount * (modelCount + 1) / 2);
  assert.strictEqual(new Set(parsed.task.eloMatches.map((match) => [match.left_id, match.right_id].sort().join("::"))).size, parsed.task.eloMatchCount);

  const annotation = api.completeAnnotationForDemo(parsed.task);
  assert.strictEqual(annotation.model_count, modelCount);
  assert.strictEqual(annotation.mos.length, modelCount);
  assert.strictEqual(annotation.elo_matches.length, parsed.task.eloMatchCount);
  assert.strictEqual(annotation.total_subtask_count, parsed.task.totalSubtaskCount);
  assert.deepStrictEqual(Array.from(api.validateAnnotation(annotation, parsed.task)), []);

  const quality = api.parseResultJson(JSON.stringify(annotation));
  assert.deepStrictEqual(Array.from(quality.errors), [], `${modelCount} model self-contained JSON errors`);
  assert.strictEqual(quality.task.modelCount, modelCount);
  api.loadTask(parsed.task, null, { skipDraft: true });
  assert(root.innerHTML.includes(`${modelCount} 模型 · ${parsed.task.totalSubtaskCount} 子任务`));
  assert(root.innerHTML.includes('preload="metadata"'), "audio players must fetch duration metadata before playback");
  assert.strictEqual((root.innerHTML.match(/data-action="go-task"/g) || []).length, parsed.task.totalSubtaskCount);
  assert.strictEqual((root.innerHTML.match(/progress-segment--mos/g) || []).length, modelCount);
  assert.strictEqual((root.innerHTML.match(/progress-segment--elo/g) || []).length, parsed.task.eloMatchCount);
  api.state.currentIndex = modelCount;
  api.render();
  parsed.task.candidates.forEach((candidate) => assert(!root.innerHTML.includes(candidate.id), "ELO screen must hide Blind IDs"));
  api.loadTask(quality.task, quality.annotation, { skipDraft: true, workMode: "quality" });
  assert(root.innerHTML.includes("质检验收模式"));

  if (modelCount === 6) {
    const cells = context.SB_UTILS.parseDelimitedDetailed(line).rows[0];
    cells[0] = "sonicbench-work-order/6-model/1.0";
    const legacy = api.parseWorkOrder(context.SB_UTILS.serializeTSVRow(cells));
    assert.deepStrictEqual(Array.from(legacy.errors), [], "legacy six-model work order should remain readable");
    const legacyAnnotation = api.completeAnnotationForDemo(legacy.task);
    legacyAnnotation.schema_version = "sonicbench-annotation-result/6-model/2.0";
    delete legacyAnnotation.model_count;
    delete legacyAnnotation.work_order.model_count;
    assert.deepStrictEqual(Array.from(api.validateAnnotation(legacyAnnotation, legacy.task)), [], "legacy six-model result should remain readable");
    assert.deepStrictEqual(Array.from(api.parseResultJson(JSON.stringify(legacyAnnotation)).errors), [], "legacy six-model self-contained JSON should remain readable");
  }
  if (modelCount >= 4) {
    const cells = context.SB_UTILS.parseDelimitedDetailed(line).rows[0];
    cells[0] = modelCount === 4 ? "sonicbench-work-order/1.0" : `sonicbench-work-order/${modelCount}-model/1.0`;
    assert.deepStrictEqual(Array.from(api.parseWorkOrder(context.SB_UTILS.serializeTSVRow(cells)).errors), [], `legacy ${modelCount}-model empty work order should remain readable`);
  }
}

for (let modelCount = 2; modelCount <= 6; modelCount += 1) {
  testReviewer(adminLine(modelCount), modelCount);
}

console.log("Dynamic 2–6 model admin/reviewer regression passed.");
