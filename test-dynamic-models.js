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
    "initializeAudioPlayers", "autoPlayCurrentTask"
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
  assert(root.innerHTML.includes("⌘/Ctrl"), "player hints must show the guarded shortcut modifier");
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

  const shortcutEvent = (code, target = { closest() { return null; } }, active = true) => ({
    key: "",
    code,
    repeat: false,
    isComposing: false,
    metaKey: active,
    ctrlKey: false,
    shiftKey: active,
    altKey: false,
    prevented: false,
    preventDefault() { this.prevented = true; },
    target
  });
  api.state.currentIndex = modelCount;
  nextAudio.paused = true;
  const unguardedB = shortcutEvent("Digit2", undefined, false);
  root._listeners.keydown[0](unguardedB);
  assert.strictEqual(unguardedB.prevented, false, "unguarded number keys must remain available to the page");
  assert.strictEqual(nextAudio.paused, true, "unguarded number keys must not control playback");
  const noteTarget = { closest(selector) { return selector.includes("textarea") ? this : null; } };
  const playB = shortcutEvent("Digit2", noteTarget);
  root._listeners.keydown[0](playB);
  assert.strictEqual(playB.prevented, true, "guarded ELO B shortcut must consume the key while editing a note");
  assert.strictEqual(nextAudio.paused, false, "guarded ELO B shortcut must start candidate B from a note field");
  const pauseRecent = shortcutEvent("Space", noteTarget);
  root._listeners.keydown[0](pauseRecent);
  assert.strictEqual(nextAudio.paused, true, "guarded Space must pause the most recently selected audio");
  const seekRecent = shortcutEvent("Period", noteTarget);
  root._listeners.keydown[0](seekRecent);
  assert.strictEqual(nextAudio.currentTime, 6.5, "guarded period must seek the recent audio forward five seconds");

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
