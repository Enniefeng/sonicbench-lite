/* eslint-disable no-console */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = __dirname;

function fakeRoot() {
  const listeners = {};
  return {
    innerHTML: "",
    scrollTop: 0,
    _listeners: listeners,
    addEventListener(name, handler) {
      if (!listeners[name]) listeners[name] = [];
      listeners[name].push(handler);
    },
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
    "state", "parseWorkOrder", "parseResultJson", "completeAnnotationForDemo", "loadTask", "validateAnnotation", "render",
    "initializeAudioPlayers", "autoPlayCurrentTask", "collectChanges", "createAnnotation", "adoptExportedRevision"
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
  assert(root.innerHTML.includes("首音频自动播放"), "task header must expose the autoplay preference");
  assert(!root.innerHTML.includes("播放器快捷键"), "reviewer must not expose playback shortcut hints");
  assert(!root.innerHTML.includes("aggregation.html"), "regular evaluator pages must not expose administrator tools");
  assert(!root.innerHTML.includes("admin-console.html"), "regular evaluator pages must not expose the administrator center");
  assert(!root._listeners.keydown, "reviewer must not register global keyboard shortcuts");
  assert(!root.innerHTML.includes("为当前音频完成分层评分"), "MOS cards must not repeat the large stage title");
  assert.strictEqual((root.innerHTML.match(/data-action="go-task"/g) || []).length, parsed.task.totalSubtaskCount);
  assert.strictEqual((root.innerHTML.match(/progress-segment--mos/g) || []).length, modelCount);
  assert.strictEqual((root.innerHTML.match(/progress-segment--elo/g) || []).length, parsed.task.eloMatchCount);

  const initialAudio = {
    tagName: "AUDIO",
    currentSrc: parsed.task.candidates[0].url,
    src: parsed.task.candidates[0].url,
    currentTime: 4.25,
    volume: 0.8,
    readyState: 1,
    paused: false,
    dataset: { positionMemory: "none" },
    addEventListener() {},
    pause() { this.paused = true; },
    play() { this.paused = false; return Promise.resolve(); }
  };
  const nextAudio = {
    tagName: "AUDIO",
    currentSrc: parsed.task.candidates[1].url,
    src: parsed.task.candidates[1].url,
    currentTime: 1.5,
    volume: 1,
    readyState: 1,
    paused: false,
    dataset: { positionMemory: "none" },
    addEventListener() {},
    pause() { this.paused = true; },
    play() { this.paused = false; return Promise.resolve(); }
  };
  root.querySelectorAll = (selector) => String(selector).startsWith("audio") ? [initialAudio, nextAudio] : [];
  root._listeners.play[0]({ target: nextAudio });
  assert.strictEqual(initialAudio.paused, true, "starting B must pause A");
  assert.strictEqual(initialAudio.currentTime, 4.25, "pausing A must preserve its playback position");
  assert.strictEqual(nextAudio.paused, false, "starting B must not pause B itself");
  nextAudio.paused = true;
  root._listeners.pause[0]({ target: nextAudio });
  assert.strictEqual(nextAudio.paused, true, "manual pause must remain paused without an auto-resume path");

  nextAudio.currentTime = 38;
  root._listeners.pause[0]({ target: nextAudio });
  const nextMatchAudio = {
    tagName: "AUDIO",
    currentSrc: nextAudio.currentSrc,
    src: nextAudio.src,
    currentTime: 0,
    duration: 120,
    volume: 0.3,
    readyState: 1,
    paused: true,
    dataset: { positionMemory: "none" },
    addEventListener() {},
    pause() { this.paused = true; },
    play() { this.paused = false; return Promise.resolve(); }
  };
  api.initializeAudioPlayers({ querySelectorAll() { return [nextMatchAudio]; } });
  assert.strictEqual(nextMatchAudio.currentTime, 0, "a new ELO match must not restore a candidate position from an earlier match");

  initialAudio.paused = true;
  nextAudio.paused = true;
  api.state.autoPlayFirstAudio = true;
  api.autoPlayCurrentTask();
  assert.strictEqual(initialAudio.paused, false, "autoplay must start the first audio in the current subtask");
  assert.strictEqual(nextAudio.paused, true, "autoplay must not start the second ELO audio");
  api.state.autoPlayFirstAudio = false;
  api.state.currentIndex = 0;
  root.querySelectorAll = () => [];

  const mosHtmlBeforeClick = root.innerHTML;
  const mosTarget = {
    dataset: { action: "set-score", id: parsed.task.candidates[0].id, dimension: "melody", score: "4" },
    closest(selector) { return selector === "[data-action]" ? this : null; }
  };
  root._listeners.click[0]({ target: mosTarget });
  assert.strictEqual(root.innerHTML, mosHtmlBeforeClick, "MOS score clicks must not rebuild the audio workspace");
  assert.strictEqual(api.state.mos[parsed.task.candidates[0].id].scores.melody, 4);

  api.state.currentIndex = modelCount;
  api.render();
  parsed.task.candidates.forEach((candidate) => assert(!root.innerHTML.includes(candidate.id), "ELO screen must hide Blind IDs"));
  assert(!root.innerHTML.includes("从四个维度分别判断胜、平、负"), "ELO cards must not repeat the large stage title");
  assert(!root.innerHTML.includes("每场对战独立播放"), "ELO cards must not repeat the playback reset notice");
  const eloHtmlBeforeClick = root.innerHTML;
  const firstMatch = parsed.task.eloMatches[0];
  const eloTarget = {
    dataset: { action: "set-elo-outcome", match: firstMatch.match_id, dimension: "musicality", outcome: "left" },
    closest(selector) { return selector === "[data-action]" ? this : null; }
  };
  root._listeners.click[0]({ target: eloTarget });
  assert.strictEqual(root.innerHTML, eloHtmlBeforeClick, "ELO outcome clicks must not rebuild either audio player");
  assert.strictEqual(api.state.eloMatches[firstMatch.match_id].dimension_results.musicality, "left");
  api.loadTask(quality.task, quality.annotation, { skipDraft: true, workMode: "quality" });
  assert(root.innerHTML.includes("质检验收模式"));
  assert(root.innerHTML.includes("本次修改明细"), "quality mode must expose a field-level change panel");
  assert.strictEqual(JSON.stringify(api.createAnnotation()), JSON.stringify(quality.annotation), "unchanged quality review must preserve the original result");

  const firstMosId = quality.task.candidates[0].id;
  api.state.mos[firstMosId].scores.melody = 3;
  api.state.mos[firstMosId].low_score_issues.melody = ["主旋律难以分辨"];
  const firstChanges = api.collectChanges();
  assert(firstChanges.some((change) => change.subtask_id === "MOS-01" && change.field_path === "scores.melody"), "quality audit must record a changed MOS score");
  assert(firstChanges.some((change) => change.subtask_id === "MOS-01" && change.field_path === "low_score_issues.melody"), "quality audit must record changed low-score issues");
  const revisionTwo = api.createAnnotation();
  assert.strictEqual(revisionTwo.result_revision, 2, "first quality edit must create Revision 2");
  assert.strictEqual(revisionTwo.revision_history.length, 2, "first quality edit must append, not replace, revision history");
  assert.strictEqual(revisionTwo.revision_history[1].revision, 2);
  assert.strictEqual(revisionTwo.revision_history[1].changes.length, firstChanges.length);
  assert(revisionTwo.revision_remark.includes("MOS-01"), "revision remark must summarize the changed subtask");
  assert.strictEqual(revisionTwo.completed_at, quality.annotation.completed_at, "quality revisions must preserve the original completion time");
  assert.deepStrictEqual(Array.from(api.validateAnnotation(revisionTwo, quality.task)), []);

  api.state.exportResult = revisionTwo;
  api.adoptExportedRevision();
  api.state.mos[firstMosId].notes.overall = "第二轮质检补充说明";
  const secondChanges = api.collectChanges();
  assert.strictEqual(secondChanges.length, 1, "a second quality round must compare against the newly adopted revision");
  assert.strictEqual(secondChanges[0].field_path, "notes.overall");
  const revisionThree = api.createAnnotation();
  assert.strictEqual(revisionThree.result_revision, 3, "second quality edit must create Revision 3");
  assert.strictEqual(revisionThree.revision_history.length, 3, "second quality edit must retain all earlier revision entries");
  assert.strictEqual(revisionThree.revision_history[2].changes.length, 1, "latest revision must contain only its incremental change set");
  assert.deepStrictEqual(Array.from(api.validateAnnotation(revisionThree, quality.task)), []);

  if (modelCount === 2) {
    const historylessAnnotation = JSON.parse(JSON.stringify(annotation));
    delete historylessAnnotation.revision_remark;
    delete historylessAnnotation.revision_history;
    const historylessQuality = api.parseResultJson(JSON.stringify(historylessAnnotation));
    assert.deepStrictEqual(Array.from(historylessQuality.errors), [], "historyless legacy results must remain loadable");
    api.loadTask(historylessQuality.task, historylessQuality.annotation, { skipDraft: true, workMode: "quality" });
    const legacyFirstId = historylessQuality.task.candidates[0].id;
    api.state.mos[legacyFirstId].scores.melody = 3;
    api.state.mos[legacyFirstId].low_score_issues.melody = ["主旋律难以分辨"];
    const migratedRevision = api.createAnnotation();
    assert.strictEqual(migratedRevision.result_revision, 2);
    assert.strictEqual(migratedRevision.revision_history.length, 2, "first edit of a historyless result must backfill its original revision");
    assert.strictEqual(migratedRevision.revision_history[0].changes.length, 0);
    assert(migratedRevision.revision_history[0].remark.includes("此前未记录"));
    assert(migratedRevision.revision_history[1].changes.length > 0);
    assert.deepStrictEqual(Array.from(api.validateAnnotation(migratedRevision, historylessQuality.task)), []);
  }

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
