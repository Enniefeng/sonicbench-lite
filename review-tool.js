(function () {
  "use strict";

  const root = document.getElementById("review-app");
  const U = window.SB_UTILS;
  const D = window.SB_SHARED_DATA;
  const UI = window.SB_UI;
  if (!root || !U || !D || !UI) return;

  const { escapeHtml: h, icon, toast } = UI;
  const MIN_MODEL_COUNT = D.MIN_MODEL_COUNT || 2;
  const MAX_MODEL_COUNT = D.MAX_MODEL_COUNT || 6;
  const WORK_ORDER_SCHEMA = D.WORK_ORDER_SCHEMA || "sonicbench-work-order/flexible-model/1.0";
  const RESULT_SCHEMA = D.REVIEW_SCHEMA || "sonicbench-annotation-result/flexible-model/1.0";
  const MOS_GROUPS = Array.isArray(D.MOS_GROUPS) ? D.MOS_GROUPS : [];
  const DIMENSIONS = Array.isArray(D.MOS_DIMENSIONS) ? D.MOS_DIMENSIONS : [];
  const INSTRUCTION_DIMENSION = D.INSTRUCTION_DIMENSION || { key: "instruction_following", label: "指令遵循" };
  const TOTAL_DIMENSION = D.TOTAL_DIMENSION || { key: "overall", label: "总评整体分" };
  const ELO_DIMENSIONS = Array.isArray(D.ELO_DIMENSIONS) ? D.ELO_DIMENSIONS : [];
  const LOW_SCORE_OPTIONS = D.LOW_SCORE_OPTIONS || {};
  const INSTRUCTION_DEDUCTION_OPTIONS = Array.isArray(D.INSTRUCTION_DEDUCTION_OPTIONS) ? D.INSTRUCTION_DEDUCTION_OPTIONS : [];
  const normalizeInstructionDeductions = D.normalizeInstructionDeductions || ((values) => Array.isArray(values) ? values : []);
  const SUBDIMENSIONS = MOS_GROUPS.flatMap((group) => group.subdimensions || []);
  const GROUP_OVERALL_DIMENSIONS = MOS_GROUPS.map((group) => group.overall).filter(Boolean);
  const SCORE_CAPTIONS = { 1: "很差", 2: "较差", 3: "合格", 4: "良好", 5: "优秀" };
  const STORAGE_PREFIX = "sonicbench-lite-review-draft/flexible-model/1.0/";
  const LAST_DRAFT_KEY = "sonicbench-lite-review-last-draft/flexible-model/1.0";
  const PLAYBACK_PREFERENCE_KEY = "sonicbench-lite-playback-preferences/1.0";
  const MODEL_COUNT_PREFERENCE_KEY = "sonicbench-lite-model-count-preference/1.0";
  const playbackMemory = new Map();
  let draftSaveTimer = null;
  let lastRenderedSubtaskKey = "";
  let rememberedVolume = 1;

  function readAutoPlayPreference() {
    try {
      const value = JSON.parse(window.localStorage.getItem(PLAYBACK_PREFERENCE_KEY) || "null");
      return Boolean(value && value.auto_play_first_audio);
    } catch (error) {
      return false;
    }
  }

  function writeAutoPlayPreference(enabled) {
    try {
      window.localStorage.setItem(PLAYBACK_PREFERENCE_KEY, JSON.stringify({ auto_play_first_audio: Boolean(enabled) }));
    } catch (error) {
      /* The preference remains active for this tab when storage is unavailable. */
    }
  }

  function readModelCountPreference() {
    try {
      const value = Number(window.localStorage.getItem(MODEL_COUNT_PREFERENCE_KEY));
      return isSupportedModelCount(value) ? value : 6;
    } catch (error) {
      return 6;
    }
  }

  function writeModelCountPreference(modelCount) {
    try {
      window.localStorage.setItem(MODEL_COUNT_PREFERENCE_KEY, String(modelCount));
    } catch (error) {
      /* The selected model count remains active for this tab. */
    }
  }

  const state = {
    screen: "import",
    importMode: "annotate",
    workMode: "annotate",
    pasteText: "",
    errors: [],
    task: null,
    mos: {},
    eloMatches: {},
    currentIndex: 0,
    startedAt: null,
    baseline: null,
    loadedHistory: false,
    exportResult: null,
    resultExported: false,
    restoredDraft: false,
    sourceAnnotation: null,
    railScrollTop: 0,
    validationOpen: false,
    autoPlayFirstAudio: readAutoPlayPreference(),
    selectedModelCount: 6
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function invalidateExportResult() {
    state.exportResult = null;
    state.resultExported = false;
  }

  function markResultExported() {
    state.resultExported = true;
    saveDraft();
    const status = root.querySelector("[data-result-export-state]");
    if (status) {
      status.classList.add("is-exported");
      status.innerHTML = `${icon("checkCircle", 13)} 已复制或下载；可以继续下一条 Case`;
    }
  }

  function audioPlaybackKey(audio) {
    return audio ? audio.currentSrc || audio.src || "" : "";
  }

  function remembersPlaybackPosition(audio) {
    return Boolean(audio && (!audio.dataset || audio.dataset.positionMemory !== "none"));
  }

  function rememberAudioPlayback(audio, options = {}) {
    const key = audioPlaybackKey(audio);
    if (!key) return;
    if (Number.isFinite(audio.volume)) rememberedVolume = audio.volume;
    if (!remembersPlaybackPosition(audio)) return;
    const current = playbackMemory.get(key) || { time: 0, volume: 1 };
    const time = options.reset
      ? 0
      : Number.isFinite(audio.currentTime) && audio.currentTime >= 0
        ? audio.currentTime
        : current.time;
    playbackMemory.set(key, {
      time,
      volume: Number.isFinite(audio.volume) ? audio.volume : current.volume
    });
  }

  function rememberAllAudioPlayback() {
    root.querySelectorAll("audio").forEach((audio) => rememberAudioPlayback(audio));
  }

  function restoreAudioPlayback(audio) {
    const key = audioPlaybackKey(audio);
    const saved = key ? playbackMemory.get(key) : null;
    try {
      audio.volume = saved && Number.isFinite(saved.volume) ? saved.volume : rememberedVolume;
      if (!remembersPlaybackPosition(audio)) {
        audio.currentTime = 0;
        return;
      }
      if (!saved) return;
      const maxTime = Number.isFinite(audio.duration) && audio.duration > 0
        ? Math.max(0, audio.duration - 0.05)
        : saved.time;
      audio.currentTime = Math.min(saved.time, maxTime);
    } catch (error) {
      /* Seeking can be rejected until metadata is available. */
    }
  }

  function initializeAudioPlayers(scope = root) {
    scope.querySelectorAll("audio").forEach((audio) => {
      if (audio.dataset.playbackReady === "true") return;
      audio.dataset.playbackReady = "true";
      if (audio.readyState >= 1) restoreAudioPlayback(audio);
      else audio.addEventListener("loadedmetadata", () => restoreAudioPlayback(audio), { once: true });
    });
  }

  function currentAudioPlayers() {
    return Array.from(root.querySelectorAll("audio.audio-player"));
  }

  function currentSubtaskKey() {
    if (!state.task || state.screen !== "task") return "";
    return `${state.task.fingerprint}:${state.currentIndex}`;
  }

  function autoPlayCurrentTask() {
    if (!state.autoPlayFirstAudio) return false;
    const first = currentAudioPlayers()[0] || null;
    if (!first) return false;
    const playback = first.play();
    if (playback && typeof playback.catch === "function") {
      playback.catch(() => toast("浏览器阻止了自动播放，请点击播放器继续", "error"));
    }
    return true;
  }

  function arraysEqual(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, index) => value === b[index]);
  }

  function isSupportedModelCount(value) {
    return typeof D.isSupportedModelCount === "function"
      ? D.isSupportedModelCount(value)
      : Number.isInteger(value) && value >= MIN_MODEL_COUNT && value <= MAX_MODEL_COUNT;
  }

  state.selectedModelCount = readModelCountPreference();

  function eloMatchCount(modelCount) {
    return typeof D.eloMatchCount === "function" ? D.eloMatchCount(modelCount) : modelCount * (modelCount - 1) / 2;
  }

  function workOrderHeaders(modelCount) {
    if (typeof D.workOrderHeaders === "function") return D.workOrderHeaders(modelCount);
    const headers = ["schema_version", "batch_id", "task_bundle_id", "case_id", "tag", "lyrics"];
    for (let index = 1; index <= modelCount; index += 1) headers.push(`candidate_${index}_blind_id`, `candidate_${index}_url`);
    return headers.concat("elo_order_key", "annotation_result_json");
  }

  function contractFromColumnCount(columnCount) {
    const modelCount = typeof D.inferModelCountFromWorkOrderColumnCount === "function"
      ? D.inferModelCountFromWorkOrderColumnCount(columnCount)
      : (Number(columnCount) - 8) / 2;
    if (!isSupportedModelCount(modelCount)) return null;
    return {
      modelCount,
      eloMatchCount: eloMatchCount(modelCount),
      totalSubtaskCount: modelCount + eloMatchCount(modelCount),
      columnCount: Number(columnCount),
      eloKeyIndex: 6 + modelCount * 2,
      resultIndex: 7 + modelCount * 2,
      headers: workOrderHeaders(modelCount)
    };
  }

  function contractFromModelCount(modelCount) {
    return isSupportedModelCount(Number(modelCount)) ? contractFromColumnCount(8 + Number(modelCount) * 2) : null;
  }

  function looksLikeAnnotationResult(value) {
    const text = String(value || "").trim();
    if (!text.startsWith("{")) return false;
    const parsed = U.safeJsonParse(text);
    const schema = parsed.value && String(parsed.value.schema_version || "");
    return !parsed.error && parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
      && (schema.startsWith("sonicbench-annotation-result/") || Array.isArray(parsed.value.mos) || parsed.value.work_order);
  }

  function canonicalizeWorkOrderRow(row, contract, headerHasResultColumn) {
    const source = Array.from(row || []);
    if (source.length < contract.resultIndex) {
      return { errors: [`${contract.modelCount} 模型工单至少需要前 ${contract.resultIndex} 列（截至 elo_order_key），当前只有 ${source.length} 列`] };
    }
    const possibleExtraBlindId = displayCell(source[contract.eloKeyIndex]);
    const possibleExtraUrl = U.normalizeHttpUrl(displayCell(source[contract.eloKeyIndex + 1]));
    if (/^(?:R|AU)-[A-Z0-9-]+$/i.test(possibleExtraBlindId) && U.isHttpUrl(possibleExtraUrl)) {
      return { errors: [`当前选择了 ${contract.modelCount} 个模型，但工单中仍检测到下一组匿名 ID + URL；请把“本批次模型数量”改为实际数量后重试`] };
    }
    const candidateResult = source[contract.resultIndex];
    const hasResultSlot = headerHasResultColumn || candidateResult == null || String(candidateResult).trim() === "" || looksLikeAnnotationResult(candidateResult);
    const resultCell = hasResultSlot ? String(candidateResult || "") : "";
    const trailingCells = source.slice(hasResultSlot ? contract.resultIndex + 1 : contract.resultIndex);
    return {
      cells: source.slice(0, contract.resultIndex).concat(resultCell),
      trailingCells,
      inputColumnCount: source.length,
      ignoredColumnCount: trailingCells.length,
      errors: []
    };
  }

  function isCompatibleWorkOrderSchema(schema, modelCount) {
    if (typeof D.isCompatibleWorkOrderSchema === "function") return D.isCompatibleWorkOrderSchema(schema, modelCount);
    return schema === WORK_ORDER_SCHEMA
      || schema === `sonicbench-work-order/${modelCount}-model/1.0`
      || (modelCount === 4 && schema === "sonicbench-work-order/1.0");
  }

  function isCompatibleReviewSchema(schema, modelCount) {
    if (typeof D.isCompatibleReviewSchema === "function") return D.isCompatibleReviewSchema(schema, modelCount);
    return schema === RESULT_SCHEMA || (modelCount === 6 && schema === "sonicbench-annotation-result/6-model/2.0");
  }

  function eloPlan(candidates, orderKey) {
    if (typeof U.createEloOrderFromKey !== "function") throw new Error("缺少 ELO 顺序派生能力");
    return U.createEloOrderFromKey(candidates.map((candidate) => candidate.id), orderKey).map((match, index) => ({
      match_id: match.match_id || `ELO-${String(index + 1).padStart(2, "0")}`,
      left_id: match.left_id,
      right_id: match.right_id,
      left_slot: candidates.findIndex((candidate) => candidate.id === match.left_id) + 1,
      right_slot: candidates.findIndex((candidate) => candidate.id === match.right_id) + 1
    }));
  }

  function workOrderFingerprint(cells, resultIndex) {
    return U.hashString(JSON.stringify(cells.slice(0, resultIndex)));
  }

  function normalizeFlatCells(cells, resultIndex) {
    return cells.map((cell, index) => {
      if (index === resultIndex) return String(cell || "").trim();
      const decoded = U.decodeFlatText(U.unprotectSpreadsheetText(String(cell || "")));
      return U.encodeFlatText(U.protectSpreadsheetText(decoded));
    });
  }

  function normalizeWorkOrderUrls(cells, contract) {
    const normalized = cells.slice();
    for (let index = 0; index < contract.modelCount; index += 1) {
      const urlIndex = 7 + index * 2;
      const url = U.normalizeHttpUrl(displayCell(normalized[urlIndex]));
      normalized[urlIndex] = U.encodeFlatText(U.protectSpreadsheetText(url));
    }
    return normalized;
  }

  function displayCell(value) {
    return U.unprotectSpreadsheetText(U.decodeFlatText(String(value || "")));
  }

  function blankAnswers(task) {
    const mos = {};
    task.candidates.forEach((candidate) => {
      mos[candidate.id] = { scores: {}, low_score_issues: {}, notes: {}, instruction_deductions: [], instruction_note: "" };
      DIMENSIONS.forEach((dimension) => {
        mos[candidate.id].scores[dimension.key] = null;
        mos[candidate.id].low_score_issues[dimension.key] = [];
        mos[candidate.id].notes[dimension.key] = "";
      });
    });
    const eloMatches = {};
    task.eloMatches.forEach((match) => {
      eloMatches[match.match_id] = {
        dimension_results: ELO_DIMENSIONS.reduce((result, dimension) => {
          result[dimension.key] = null;
          return result;
        }, {}),
        note: ""
      };
    });
    return { mos, eloMatches };
  }

  function buildTask(cells) {
    const contract = contractFromColumnCount(cells.length);
    if (!contract) return null;
    const candidates = Array.from({ length: contract.modelCount }, (_, index) => ({
      slot: index + 1,
      id: displayCell(cells[6 + index * 2]).trim(),
      url: U.normalizeHttpUrl(displayCell(cells[7 + index * 2]))
    }));
    const task = {
      cells: cells.slice(),
      schema: displayCell(cells[0]).trim(),
      batchId: displayCell(cells[1]).trim(),
      taskBundleId: displayCell(cells[2]).trim(),
      caseId: displayCell(cells[3]).trim(),
      tag: displayCell(cells[4]),
      lyrics: displayCell(cells[5]),
      eloOrderKey: displayCell(cells[contract.eloKeyIndex]).trim(),
      candidates,
      modelCount: contract.modelCount,
      eloMatchCount: contract.eloMatchCount,
      totalSubtaskCount: contract.totalSubtaskCount,
      columnCount: contract.columnCount,
      eloKeyIndex: contract.eloKeyIndex,
      resultIndex: contract.resultIndex,
      headers: contract.headers,
      fingerprint: workOrderFingerprint(cells, contract.resultIndex)
    };
    try {
      task.eloMatches = eloPlan(candidates, task.eloOrderKey);
    } catch (error) {
      task.eloMatches = [];
      task.eloOrderError = error && error.message ? error.message : "无法派生 ELO 顺序";
    }
    return task;
  }

  function validateTask(task) {
    const errors = [];
    if (!isCompatibleWorkOrderSchema(task.schema, task.modelCount)) errors.push(`schema_version 与 ${task.modelCount} 模型工单不兼容`);
    if (!task.batchId) errors.push("batch_id 不能为空");
    if (!task.taskBundleId) errors.push("task_bundle_id 不能为空");
    if (!task.caseId) errors.push("case_id 不能为空");
    if (!task.eloOrderKey) errors.push("elo_order_key 不能为空");
    if (task.eloOrderError) errors.push(task.eloOrderError);

    const ids = task.candidates.map((candidate) => candidate.id);
    if (ids.some((id) => !id)) errors.push(`${task.modelCount} 个匿名音频 ID 均不能为空`);
    if (new Set(ids).size !== task.modelCount) errors.push(`${task.modelCount} 个匿名音频 ID 必须唯一`);
    task.candidates.forEach((candidate) => {
      if (!U.isHttpUrl(candidate.url)) errors.push(`候选 ${candidate.slot} 的 URL 不是有效 HTTP(S) 地址`);
    });

    if (task.eloMatches.length !== task.eloMatchCount) errors.push(`系统未能派生恰好 ${task.eloMatchCount} 个 ELO 对战`);
    const unordered = task.eloMatches.map((match) => [match.left_id, match.right_id].sort().join("::"));
    if (new Set(unordered).size !== task.eloMatchCount) errors.push("两两组合存在重复或遗漏");
    task.eloMatches.forEach((match) => {
      if (!ids.includes(match.left_id) || !ids.includes(match.right_id) || match.left_id === match.right_id) {
        errors.push(`${match.match_id} 的左右候选无效`);
      }
    });
    return errors;
  }

  function validateAnnotation(annotation, task) {
    const errors = [];
    if (!annotation || typeof annotation !== "object" || Array.isArray(annotation)) {
      return ["annotation_result_json 必须是 JSON 对象"];
    }
    if (!isCompatibleReviewSchema(annotation.schema_version, task.modelCount)) errors.push(`结果 schema_version 与 ${task.modelCount} 模型工单不兼容`);
    if (annotation.model_count != null && annotation.model_count !== task.modelCount) errors.push("结果中的 model_count 与当前工单不一致");
    if (annotation.batch_id !== task.batchId) errors.push("结果中的 batch_id 与当前工单不一致");
    if (annotation.task_bundle_id !== task.taskBundleId) errors.push("结果中的 task_bundle_id 与当前工单不一致");
    if (annotation.case_id !== task.caseId) errors.push("结果中的 case_id 与当前工单不一致");
    if (annotation.work_order_fingerprint !== task.fingerprint) errors.push("结果指纹与当前工单不一致，可能粘贴到了错误行");
    if (annotation.completed_subtask_count !== task.totalSubtaskCount || annotation.total_subtask_count !== task.totalSubtaskCount) {
      errors.push(`结果任务计数必须为 ${task.totalSubtaskCount}`);
    }

    if (!Array.isArray(annotation.mos) || annotation.mos.length !== task.modelCount) {
      errors.push(`历史结果必须包含 ${task.modelCount} 个 MOS 结果`);
    } else {
      const bySubtask = new Map(annotation.mos.map((item) => [item && item.subtask_id, item]));
      if (bySubtask.size !== task.modelCount) errors.push("MOS subtask_id 存在重复");
      task.candidates.forEach((candidate, index) => {
        const subtaskId = `MOS-${String(index + 1).padStart(2, "0")}`;
        const item = bySubtask.get(subtaskId);
        if (!item) {
          errors.push(`缺少 ${subtaskId}`);
          return;
        }
        if (item.blind_id !== candidate.id) errors.push(`${subtaskId} 未与当前匿名 ID 对齐`);
        if (!item.scores || typeof item.scores !== "object") {
          errors.push(`${subtaskId} 缺少 scores`);
          return;
        }
        DIMENSIONS.forEach((dimension) => {
          const score = item.scores[dimension.key];
          if (!Number.isInteger(score) || score < 1 || score > 5) {
            errors.push(`${subtaskId} 的「${dimension.label}」必须是 1–5 整数`);
          }
        });
        const issues = item.low_score_issues && typeof item.low_score_issues === "object" ? item.low_score_issues : {};
        const notes = item.notes && typeof item.notes === "object" ? item.notes : {};
        SUBDIMENSIONS.forEach((dimension) => {
          if (item.scores[dimension.key] <= 3) {
            const selected = Array.isArray(issues[dimension.key]) ? issues[dimension.key] : [];
            if (!selected.length) errors.push(`${subtaskId} 的「${dimension.label}」低分时至少选择一个问题`);
            if (selected.includes("其他") && !String(notes[dimension.key] || "").trim()) {
              errors.push(`${subtaskId} 的「${dimension.label}」选择“其他”后必须补充备注`);
            }
          }
        });
        GROUP_OVERALL_DIMENSIONS.forEach((dimension) => {
          if (item.scores[dimension.key] <= 3 && !String(notes[dimension.key] || "").trim()) {
            errors.push(`${subtaskId} 的「${dimension.label}」低分时必须备注`);
          }
        });
        if (!String(notes[TOTAL_DIMENSION.key] || "").trim()) errors.push(`${subtaskId} 的总评整体分必须备注`);
        const deductions = Array.isArray(item.instruction_deductions) ? item.instruction_deductions : [];
        if (item.scores[INSTRUCTION_DIMENSION.key] < 5 && !deductions.length) {
          errors.push(`${subtaskId} 的指令遵循扣分时至少选择一个扣分问题`);
        }
        if (deductions.length && !String(item.instruction_note || "").trim()) {
          errors.push(`${subtaskId} 的指令遵循扣分后必须备注原因`);
        }
      });
    }

    if (!Array.isArray(annotation.elo_matches) || annotation.elo_matches.length !== task.eloMatchCount) {
      errors.push(`历史结果必须包含 ${task.eloMatchCount} 个 ELO 对战结果`);
    } else {
      const byId = new Map(annotation.elo_matches.map((item) => [item && item.subtask_id, item]));
      if (byId.size !== task.eloMatchCount) errors.push("ELO subtask_id 存在重复");
      task.eloMatches.forEach((expected) => {
        const item = byId.get(expected.match_id);
        if (!item) {
          errors.push(`缺少 ${expected.match_id}`);
          return;
        }
        if (item.left_blind_id !== expected.left_id || item.right_blind_id !== expected.right_id) {
          errors.push(`${expected.match_id} 的左右匿名 ID 与当前工单不一致`);
        }
        if (!item.dimension_results || typeof item.dimension_results !== "object") errors.push(`${expected.match_id} 缺少 dimension_results`);
        ELO_DIMENSIONS.forEach((dimension) => {
          const outcome = item.dimension_results && item.dimension_results[dimension.key];
          if (!["left", "draw", "right"].includes(outcome)) errors.push(`${expected.match_id} 的「${dimension.label}」必须选择 A胜、平局或B胜`);
        });
        if (item.note != null && typeof item.note !== "string") errors.push(`${expected.match_id} 的备注必须是文本`);
      });
    }
    if (annotation.revision_history != null) {
      if (!Array.isArray(annotation.revision_history)) errors.push("revision_history 必须是数组");
      else {
        let previousRevision = 0;
        annotation.revision_history.forEach((entry, index) => {
          if (!entry || !Number.isInteger(entry.revision) || entry.revision <= previousRevision) {
            errors.push(`revision_history[${index}] 的 revision 必须严格递增`);
          } else previousRevision = entry.revision;
          if (!entry || typeof entry.remark !== "string") errors.push(`revision_history[${index}] 缺少 remark`);
          if (!entry || !Array.isArray(entry.changes)) errors.push(`revision_history[${index}] 缺少 changes 数组`);
          else entry.changes.forEach((change, changeIndex) => {
            const prefix = `revision_history[${index}].changes[${changeIndex}]`;
            if (!change || !["mos", "elo"].includes(change.scope)) errors.push(`${prefix} 缺少合法 scope`);
            if (!change || typeof change.subtask_id !== "string" || !change.subtask_id) errors.push(`${prefix} 缺少 subtask_id`);
            if (!change || typeof change.field_path !== "string" || !change.field_path) errors.push(`${prefix} 缺少 field_path`);
            if (!change || !Object.prototype.hasOwnProperty.call(change, "before") || !Object.prototype.hasOwnProperty.call(change, "after")) {
              errors.push(`${prefix} 缺少 before/after`);
            }
          });
        });
        const latest = annotation.revision_history[annotation.revision_history.length - 1];
        if (latest && latest.revision !== annotation.result_revision) errors.push("revision_history 最新版本与 result_revision 不一致");
      }
    }
    return [...new Set(errors)];
  }

  function annotationToAnswers(annotation, task) {
    const answers = blankAnswers(task);
    annotation.mos.forEach((item) => {
      answers.mos[item.blind_id] = {
        scores: clone(item.scores || {}),
        low_score_issues: clone(item.low_score_issues || {}),
        notes: clone(item.notes || {}),
        instruction_deductions: clone(normalizeInstructionDeductions(item.instruction_deductions)),
        instruction_note: item.instruction_note || ""
      };
    });
    annotation.elo_matches.forEach((item) => {
      answers.eloMatches[item.subtask_id] = {
        dimension_results: clone(item.dimension_results || {}),
        note: item.note || ""
      };
    });
    return answers;
  }

  function isHeader(row) {
    return Array.isArray(row) && row.length > 0
      && String(row[0] || "").trim().toLowerCase() === "schema_version";
  }

  function parseWorkOrder(text, requestedModelCount = state.selectedModelCount) {
    if (!String(text || "").trim()) return { errors: ["请先粘贴一行工单内容"] };
    const parsedTable = U.parseDelimitedDetailed(String(text));
    if (parsedTable.error) return { errors: [parsedTable.error] };
    const rows = parsedTable.rows;
    if (!rows.length) return { errors: ["没有识别到有效工单数据"] };

    let dataRow;
    let headerRow = null;
    if (isHeader(rows[0])) {
      if (rows.length !== 2) return { errors: ["带表头粘贴时，必须且只能包含 1 行数据"] };
      headerRow = rows[0].map((value) => String(value).trim());
      dataRow = rows[1];
    } else {
      if (rows.length !== 1) return { errors: ["一次只能粘贴一个 Case；检测到多行数据"] };
      dataRow = rows[0];
    }

    const contract = contractFromModelCount(requestedModelCount);
    if (!contract) {
      return { errors: ["请先选择 2–6 之间的模型数量"] };
    }
    const expectedPrefixHeaders = contract.headers.slice(0, contract.resultIndex);
    if (headerRow && !arraysEqual(headerRow.slice(0, contract.resultIndex), expectedPrefixHeaders)) {
      return { errors: [`表头前 ${contract.resultIndex} 列必须匹配 ${contract.modelCount} 模型工单字段；右侧附加列不受限制`] };
    }
    const headerHasResultColumn = Boolean(headerRow && String(headerRow[contract.resultIndex] || "").trim() === "annotation_result_json");
    const canonical = canonicalizeWorkOrderRow(dataRow, contract, headerHasResultColumn);
    if (canonical.errors.length) return { errors: canonical.errors };
    dataRow = normalizeWorkOrderUrls(normalizeFlatCells(canonical.cells, contract.resultIndex), contract);
    const task = buildTask(dataRow);
    task.trailingCells = canonical.trailingCells;
    task.inputColumnCount = canonical.inputColumnCount;
    task.ignoredColumnCount = canonical.ignoredColumnCount;
    const errors = validateTask(task);
    let annotation = null;
    const annotationText = String(dataRow[task.resultIndex] || "").trim();
    if (annotationText) {
      const parsed = U.safeJsonParse(annotationText);
      if (parsed.error) errors.push("annotation_result_json 不是有效 JSON");
      else {
        annotation = parsed.value;
        errors.push(...validateAnnotation(annotation, task));
      }
    }
    return { task, annotation, errors: [...new Set(errors)] };
  }

  function workOrderContext(task) {
    return {
      schema_version: task.schema,
      batch_id: task.batchId,
      task_bundle_id: task.taskBundleId,
      case_id: task.caseId,
      model_count: task.modelCount,
      tag: task.tag,
      lyrics: task.lyrics,
      candidates: task.candidates.map((candidate) => ({
        slot: candidate.slot,
        blind_id: candidate.id,
        url: candidate.url
      })),
      elo_order_key: task.eloOrderKey
    };
  }

  function parseResultJson(text) {
    if (!String(text || "").trim()) return { errors: ["请粘贴完整的结果 JSON"] };
    const parsed = U.safeJsonParse(String(text).trim());
    if (parsed.error || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return { errors: ["结果内容不是有效的 JSON 对象"] };
    }
    const annotation = parsed.value;
    const context = annotation.work_order;
    if (!context || typeof context !== "object" || !Array.isArray(context.candidates)) {
      return { errors: ["这是旧版结果 JSON，缺少 work_order 音频上下文。请粘贴带结果的完整动态列工单，或使用新版自包含 JSON。"] };
    }
    const modelCount = context.candidates.length;
    if (!isSupportedModelCount(modelCount)) {
      return { errors: [`work_order.candidates 必须包含 ${MIN_MODEL_COUNT}–${MAX_MODEL_COUNT} 个匿名音频`] };
    }
    const cells = [
      context.schema_version || WORK_ORDER_SCHEMA,
      context.batch_id || annotation.batch_id || "",
      context.task_bundle_id || annotation.task_bundle_id || "",
      context.case_id || annotation.case_id || "",
      context.tag || "",
      context.lyrics || ""
    ];
    context.candidates.forEach((candidate) => cells.push(candidate && candidate.blind_id || "", candidate && candidate.url || ""));
    cells.push(context.elo_order_key || "", JSON.stringify(annotation));
    const contract = contractFromColumnCount(cells.length);
    const normalized = normalizeWorkOrderUrls(normalizeFlatCells(cells, contract.resultIndex), contract);
    const task = buildTask(normalized);
    const errors = validateTask(task).concat(validateAnnotation(annotation, task));
    return { task, annotation, errors: [...new Set(errors)] };
  }

  function draftKey(task) {
    return `${STORAGE_PREFIX}${task.batchId}/${task.taskBundleId}/${task.fingerprint}`;
  }

  function readStorage(key) {
    try {
      const value = window.localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function saveDraft() {
    if (!state.task) return;
    const currentProgress = progress();
    const payload = {
      version: 3,
      sanitized_cells: state.task.cells.slice(0, state.task.resultIndex),
      fingerprint: state.task.fingerprint,
      case_id: state.task.caseId,
      batch_id: state.task.batchId,
      task_bundle_id: state.task.taskBundleId,
      model_count: state.task.modelCount,
      mos: state.mos,
      elo_matches: state.eloMatches,
      completed_subtask_count: currentProgress.total,
      total_subtask_count: state.task.totalSubtaskCount,
      status: currentProgress.total === state.task.totalSubtaskCount ? "complete" : "in_progress",
      export_result: state.exportResult ? clone(state.exportResult) : null,
      result_exported: Boolean(state.resultExported),
      current_index: state.currentIndex,
      started_at: state.startedAt,
      baseline: state.baseline,
      loaded_history: state.loadedHistory,
      trailing_cells: state.task.trailingCells || [],
      updated_at: U.nowISO()
    };
    const key = draftKey(state.task);
    if (writeStorage(key, payload)) writeStorage(LAST_DRAFT_KEY, { key, updated_at: payload.updated_at });
  }

  function scheduleDraftSave() {
    if (draftSaveTimer != null) window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(() => {
      draftSaveTimer = null;
      saveDraft();
    }, 160);
  }

  function flushDraftSave() {
    if (draftSaveTimer != null) {
      window.clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }
    saveDraft();
  }

  function validDraft(draft, task) {
    if (!draft || draft.fingerprint !== task.fingerprint || !draft.mos || !draft.elo_matches) return false;
    const ids = task.candidates.map((candidate) => candidate.id);
    if (!ids.every((id) => draft.mos[id])) return false;
    for (const id of ids) {
      if (!draft.mos[id].scores) return false;
      for (const dimension of DIMENSIONS) {
        const score = draft.mos[id].scores[dimension.key];
        if (score != null && (!Number.isInteger(score) || score < 1 || score > 5)) return false;
      }
    }
    return task.eloMatches.every((match) => {
      const answer = draft.elo_matches[match.match_id];
      if (!answer || !answer.dimension_results) return false;
      return ELO_DIMENSIONS.every((dimension) => [null, "left", "draw", "right"].includes(answer.dimension_results[dimension.key]));
    });
  }

  function loadTask(task, annotation, options) {
    const opts = options || {};
    const answers = annotation ? annotationToAnswers(annotation, task) : blankAnswers(task);
    state.task = task;
    state.mos = answers.mos;
    state.eloMatches = answers.eloMatches;
    state.baseline = annotation ? clone(answers) : null;
    state.loadedHistory = Boolean(annotation);
    state.workMode = opts.workMode || (annotation ? "quality" : "annotate");
    state.sourceAnnotation = annotation ? clone(annotation) : null;
    state.currentIndex = 0;
    state.startedAt = annotation && annotation.started_at ? annotation.started_at : U.nowISO();
    state.exportResult = null;
    state.resultExported = false;
    state.restoredDraft = false;
    state.validationOpen = false;
    playbackMemory.clear();
    lastRenderedSubtaskKey = "";

    if (!annotation && !opts.skipDraft) {
      const draft = readStorage(draftKey(task));
      if (validDraft(draft, task)) {
        state.mos = clone(draft.mos);
        Object.values(state.mos).forEach((answer) => { answer.instruction_deductions = normalizeInstructionDeductions(answer.instruction_deductions); });
        state.eloMatches = clone(draft.elo_matches);
        state.currentIndex = Math.max(0, Math.min(task.totalSubtaskCount - 1, Number(draft.current_index) || 0));
        state.startedAt = draft.started_at || state.startedAt;
        state.baseline = draft.baseline || null;
        state.loadedHistory = Boolean(draft.loaded_history);
        state.exportResult = draft.export_result ? clone(draft.export_result) : null;
        state.resultExported = Boolean(draft.result_exported);
        state.restoredDraft = true;
      }
    }
    state.screen = "task";
    state.errors = [];
    saveDraft();
    render();
    if (state.restoredDraft) toast("已恢复这条工单的本地草稿", "success");
  }

  function mosAnswerComplete(answer) {
    if (!answer || !answer.scores) return false;
    if (!DIMENSIONS.every((dimension) => Number.isInteger(answer.scores[dimension.key])
      && answer.scores[dimension.key] >= 1 && answer.scores[dimension.key] <= 5)) return false;
    if (SUBDIMENSIONS.some((dimension) => {
      if (answer.scores[dimension.key] > 3) return false;
      const selected = answer.low_score_issues[dimension.key] || [];
      return !selected.length || (selected.includes("其他") && !String(answer.notes[dimension.key] || "").trim());
    })) return false;
    if (GROUP_OVERALL_DIMENSIONS.some((dimension) => answer.scores[dimension.key] <= 3 && !String(answer.notes[dimension.key] || "").trim())) return false;
    if (!String(answer.notes[TOTAL_DIMENSION.key] || "").trim()) return false;
    if (answer.scores[INSTRUCTION_DIMENSION.key] < 5 && !(answer.instruction_deductions || []).length) return false;
    if ((answer.instruction_deductions || []).length && !String(answer.instruction_note || "").trim()) return false;
    return true;
  }

  function mosComplete(candidateId) {
    return mosAnswerComplete(state.mos[candidateId]);
  }

  function mosMissingCount(candidateId) {
    const answer = state.mos[candidateId];
    if (!answer || !answer.scores) return DIMENSIONS.length;
    let missing = DIMENSIONS.filter((dimension) => !Number.isInteger(answer.scores[dimension.key])).length;
    SUBDIMENSIONS.forEach((dimension) => {
      if (!Number.isInteger(answer.scores[dimension.key]) || answer.scores[dimension.key] > 3) return;
      const selected = answer.low_score_issues[dimension.key] || [];
      if (!selected.length) missing += 1;
      else if (selected.includes("其他") && !String(answer.notes[dimension.key] || "").trim()) missing += 1;
    });
    GROUP_OVERALL_DIMENSIONS.forEach((dimension) => {
      if (Number.isInteger(answer.scores[dimension.key]) && answer.scores[dimension.key] <= 3 && !String(answer.notes[dimension.key] || "").trim()) missing += 1;
    });
    if (!String(answer.notes[TOTAL_DIMENSION.key] || "").trim()) missing += 1;
    if (Number.isInteger(answer.scores[INSTRUCTION_DIMENSION.key]) && answer.scores[INSTRUCTION_DIMENSION.key] < 5 && !(answer.instruction_deductions || []).length) missing += 1;
    if ((answer.instruction_deductions || []).length && !String(answer.instruction_note || "").trim()) missing += 1;
    return missing;
  }

  function eloAnswerComplete(answer) {
    return Boolean(answer && answer.dimension_results && ELO_DIMENSIONS.every((dimension) => ["left", "draw", "right"].includes(answer.dimension_results[dimension.key])));
  }

  function eloMatchComplete(matchId) {
    return eloAnswerComplete(state.eloMatches[matchId]);
  }

  function eloMissingCount(matchId) {
    const answer = state.eloMatches[matchId];
    if (!answer || !answer.dimension_results) return ELO_DIMENSIONS.length;
    return ELO_DIMENSIONS.filter((dimension) => !["left", "draw", "right"].includes(answer.dimension_results[dimension.key])).length;
  }

  function mosMissingItems(candidateId) {
    const answer = state.mos[candidateId];
    if (!answer || !answer.scores) return [];
    const items = [];
    DIMENSIONS.forEach((dimension) => {
      if (!Number.isInteger(answer.scores[dimension.key])) {
        items.push({
          key: `score:${dimension.key}`,
          label: `${dimension.label}：请选择评分`,
          selector: `.dimension-block[data-dimension="${dimension.key}"] .score-scale`
        });
      }
    });
    SUBDIMENSIONS.forEach((dimension) => {
      if (!Number.isInteger(answer.scores[dimension.key]) || answer.scores[dimension.key] > 3) return;
      const selected = answer.low_score_issues[dimension.key] || [];
      if (!selected.length) {
        items.push({
          key: `issues:${dimension.key}`,
          label: `${dimension.label}：请选择低分问题`,
          selector: `.dimension-block[data-dimension="${dimension.key}"] .issue-panel`
        });
      } else if (selected.includes("其他") && !String(answer.notes[dimension.key] || "").trim()) {
        items.push({
          key: `other-note:${dimension.key}`,
          label: `${dimension.label}：请补充“其他”问题备注`,
          selector: `textarea[data-role="mos-note"][data-dimension="${dimension.key}"]`
        });
      }
    });
    GROUP_OVERALL_DIMENSIONS.forEach((dimension) => {
      if (Number.isInteger(answer.scores[dimension.key]) && answer.scores[dimension.key] <= 3 && !String(answer.notes[dimension.key] || "").trim()) {
        items.push({
          key: `overall-note:${dimension.key}`,
          label: `${dimension.label}：请填写低分备注`,
          selector: `textarea[data-role="mos-note"][data-dimension="${dimension.key}"]`
        });
      }
    });
    if (!String(answer.notes[TOTAL_DIMENSION.key] || "").trim()) {
      items.push({
        key: `total-note:${TOTAL_DIMENSION.key}`,
        label: "总评备注：请填写",
        selector: `textarea[data-role="mos-note"][data-dimension="${TOTAL_DIMENSION.key}"]`
      });
    }
    if (Number.isInteger(answer.scores[INSTRUCTION_DIMENSION.key]) && answer.scores[INSTRUCTION_DIMENSION.key] < 5 && !(answer.instruction_deductions || []).length) {
      items.push({
        key: `deductions:${INSTRUCTION_DIMENSION.key}`,
        label: "指令遵循：请选择未遵循项",
        selector: ".instruction-issues .issue-chips"
      });
    }
    if ((answer.instruction_deductions || []).length && !String(answer.instruction_note || "").trim()) {
      items.push({
        key: `instruction-note:${INSTRUCTION_DIMENSION.key}`,
        label: "指令遵循：请填写扣分原因",
        selector: 'textarea[data-role="instruction-note"]'
      });
    }
    return items;
  }

  function eloMissingItems(matchId) {
    const answer = state.eloMatches[matchId];
    if (!answer || !answer.dimension_results) return [];
    return ELO_DIMENSIONS.filter((dimension) => !["left", "draw", "right"].includes(answer.dimension_results[dimension.key])).map((dimension) => ({
      key: `elo:${dimension.key}`,
      label: `${dimension.label}：请选择 A 胜、平局或 B 胜`,
      selector: `.elo-dimension-row[data-dimension="${dimension.key}"]`
    }));
  }

  function currentMissingItems() {
    if (!state.task) return [];
    if (state.currentIndex < state.task.modelCount) return mosMissingItems(state.task.candidates[state.currentIndex].id);
    const match = state.task.eloMatches[state.currentIndex - state.task.modelCount];
    return match ? eloMissingItems(match.match_id) : [];
  }

  function progress() {
    if (!state.task) return { mos: 0, elo: 0, total: 0 };
    const mos = state.task.candidates.filter((candidate) => mosComplete(candidate.id)).length;
    const elo = state.task.eloMatches.filter((match) => eloMatchComplete(match.match_id)).length;
    return { mos, elo, total: mos + elo };
  }

  function effectiveMosAnswer(answer) {
    const source = answer || { scores: {}, low_score_issues: {}, notes: {}, instruction_deductions: [], instruction_note: "" };
    const lowScoreIssues = {};
    const notes = clone(source.notes || {});
    SUBDIMENSIONS.forEach((dimension) => {
      const active = Number(source.scores && source.scores[dimension.key]) <= 3;
      lowScoreIssues[dimension.key] = active ? clone(source.low_score_issues && source.low_score_issues[dimension.key] || []) : [];
      if (!active) notes[dimension.key] = "";
    });
    const instructionDeducted = Number(source.scores && source.scores[INSTRUCTION_DIMENSION.key]) < 5;
    return {
      scores: clone(source.scores || {}),
      low_score_issues: lowScoreIssues,
      notes,
      instruction_deductions: instructionDeducted ? clone(source.instruction_deductions || []) : [],
      instruction_note: instructionDeducted ? source.instruction_note || "" : ""
    };
  }

  function valuesEqual(left, right) {
    return JSON.stringify(left == null ? null : left) === JSON.stringify(right == null ? null : right);
  }

  function appendChange(changes, descriptor, before, after) {
    if (valuesEqual(before, after)) return;
    changes.push({
      scope: descriptor.scope,
      subtask_id: descriptor.subtask_id,
      field_path: descriptor.field_path,
      field_label: descriptor.field_label,
      dimension_key: descriptor.dimension_key || null,
      dimension_label: descriptor.dimension_label || null,
      before: clone(before == null ? null : before),
      after: clone(after == null ? null : after)
    });
  }

  function collectChanges() {
    if (!state.baseline || !state.task) return [];
    const changes = [];
    state.task.candidates.forEach((candidate, index) => {
      const subtaskId = `MOS-${String(index + 1).padStart(2, "0")}`;
      const before = effectiveMosAnswer(state.baseline.mos[candidate.id]);
      const after = effectiveMosAnswer(state.mos[candidate.id]);
      DIMENSIONS.forEach((dimension) => {
        appendChange(changes, { scope: "mos", subtask_id: subtaskId, field_path: `scores.${dimension.key}`, field_label: `${dimension.label}评分`, dimension_key: dimension.key, dimension_label: dimension.label }, before.scores[dimension.key], after.scores[dimension.key]);
      });
      SUBDIMENSIONS.forEach((dimension) => {
        appendChange(changes, { scope: "mos", subtask_id: subtaskId, field_path: `low_score_issues.${dimension.key}`, field_label: `${dimension.label}低分问题`, dimension_key: dimension.key, dimension_label: dimension.label }, before.low_score_issues[dimension.key] || [], after.low_score_issues[dimension.key] || []);
      });
      DIMENSIONS.forEach((dimension) => {
        appendChange(changes, { scope: "mos", subtask_id: subtaskId, field_path: `notes.${dimension.key}`, field_label: `${dimension.label}备注`, dimension_key: dimension.key, dimension_label: dimension.label }, before.notes[dimension.key] || "", after.notes[dimension.key] || "");
      });
      appendChange(changes, { scope: "mos", subtask_id: subtaskId, field_path: "instruction_deductions", field_label: "指令遵循扣分项", dimension_key: INSTRUCTION_DIMENSION.key, dimension_label: INSTRUCTION_DIMENSION.label }, before.instruction_deductions, after.instruction_deductions);
      appendChange(changes, { scope: "mos", subtask_id: subtaskId, field_path: "instruction_note", field_label: "指令遵循扣分原因", dimension_key: INSTRUCTION_DIMENSION.key, dimension_label: INSTRUCTION_DIMENSION.label }, before.instruction_note, after.instruction_note);
    });
    state.task.eloMatches.forEach((match) => {
      const before = state.baseline.eloMatches[match.match_id] || { dimension_results: {}, note: "" };
      const after = state.eloMatches[match.match_id] || { dimension_results: {}, note: "" };
      ELO_DIMENSIONS.forEach((dimension) => {
        appendChange(changes, { scope: "elo", subtask_id: match.match_id, field_path: `dimension_results.${dimension.key}`, field_label: `${dimension.label}结果`, dimension_key: dimension.key, dimension_label: dimension.label }, before.dimension_results[dimension.key], after.dimension_results[dimension.key]);
      });
      appendChange(changes, { scope: "elo", subtask_id: match.match_id, field_path: "note", field_label: "本场共用备注" }, before.note || "", after.note || "");
    });
    return changes;
  }

  function changedCount() {
    return collectChanges().length;
  }

  function taskChanged(index) {
    if (!state.baseline || !state.task) return false;
    const subtaskId = index < state.task.modelCount
      ? `MOS-${String(index + 1).padStart(2, "0")}`
      : state.task.eloMatches[index - state.task.modelCount].match_id;
    return collectChanges().some((change) => change.subtask_id === subtaskId);
  }

  function revisionRemark(changes) {
    if (!changes.length) return "初始评测完成";
    const labels = changes.slice(0, 6).map((change) => `${change.subtask_id} · ${change.field_label}`);
    return `质检修订：${labels.join("；")}${changes.length > labels.length ? `；另有 ${changes.length - labels.length} 处修改` : ""}`;
  }

  function buildRevisionHistory(previousAnnotation, revision, changes, now) {
    const history = previousAnnotation && Array.isArray(previousAnnotation.revision_history)
      ? clone(previousAnnotation.revision_history)
      : [];
    if (!history.length && previousAnnotation && Number(previousAnnotation.result_revision) > 0) {
      history.push({
        revision: Number(previousAnnotation.result_revision),
        updated_at: previousAnnotation.updated_at || previousAnnotation.completed_at || null,
        remark: previousAnnotation.revision_remark || "历史版本（此前未记录字段级修改明细）",
        changes: []
      });
    }
    const entry = {
      revision,
      updated_at: now,
      remark: revisionRemark(changes),
      changes: clone(changes)
    };
    history.push(entry);
    return { history, entry };
  }

  function createAnnotation() {
    const changes = collectChanges();
    const changeCount = changes.length;
    if (state.loadedHistory && changeCount === 0 && state.task.cells[state.task.resultIndex]) {
      const existing = U.safeJsonParse(state.task.cells[state.task.resultIndex]);
      if (!existing.error && existing.value && existing.value.work_order) return existing.value;
    }
    const previousAnnotation = state.loadedHistory ? state.sourceAnnotation : null;
    const previousRevision = previousAnnotation ? Number(previousAnnotation.result_revision) || 1 : 0;
    const resultRevision = previousRevision ? previousRevision + 1 : 1;
    const now = U.nowISO();
    const revision = buildRevisionHistory(previousAnnotation, resultRevision, changes, now);
    return {
      schema_version: RESULT_SCHEMA,
      work_order_fingerprint: state.task.fingerprint,
      batch_id: state.task.batchId,
      task_bundle_id: state.task.taskBundleId,
      case_id: state.task.caseId,
      model_count: state.task.modelCount,
      work_order: workOrderContext(state.task),
      mos: state.task.candidates.map((candidate, index) => {
        const answer = effectiveMosAnswer(state.mos[candidate.id]);
        return {
          subtask_id: `MOS-${String(index + 1).padStart(2, "0")}`,
          blind_id: candidate.id,
          scores: clone(answer.scores),
          low_score_issues: answer.low_score_issues,
          notes: answer.notes,
          instruction_deductions: answer.instruction_deductions,
          instruction_note: answer.instruction_note
        };
      }),
      elo_matches: state.task.eloMatches.map((match) => ({
        subtask_id: match.match_id,
        left_blind_id: match.left_id,
        right_blind_id: match.right_id,
        dimension_results: clone(state.eloMatches[match.match_id].dimension_results),
        note: state.eloMatches[match.match_id].note
      })),
      status: "complete",
      completed_subtask_count: state.task.totalSubtaskCount,
      total_subtask_count: state.task.totalSubtaskCount,
      started_at: state.startedAt,
      completed_at: state.loadedHistory && state.sourceAnnotation && state.sourceAnnotation.completed_at
        ? state.sourceAnnotation.completed_at
        : now,
      updated_at: now,
      result_revision: resultRevision,
      revision_remark: revision.entry.remark,
      revision_history: revision.history
    };
  }

  function completeAnnotationForDemo(task) {
    const answers = blankAnswers(task);
    task.candidates.forEach((candidate, candidateIndex) => {
      DIMENSIONS.forEach((dimension) => { answers.mos[candidate.id].scores[dimension.key] = 4; });
      answers.mos[candidate.id].scores[INSTRUCTION_DIMENSION.key] = 5;
      answers.mos[candidate.id].notes[TOTAL_DIMENSION.key] = `候选 ${candidateIndex + 1} 整体完成度良好。`;
    });
    task.eloMatches.forEach((match, index) => {
      ELO_DIMENSIONS.forEach((dimension, dimensionIndex) => {
        answers.eloMatches[match.match_id].dimension_results[dimension.key] = ["left", "draw", "right"][(index + dimensionIndex) % 3];
      });
      answers.eloMatches[match.match_id].note = index % 3 === 0 ? "两侧表现接近，主要差异在完成度。" : "";
    });
    return {
      schema_version: RESULT_SCHEMA,
      work_order_fingerprint: task.fingerprint,
      batch_id: task.batchId,
      task_bundle_id: task.taskBundleId,
      case_id: task.caseId,
      model_count: task.modelCount,
      work_order: workOrderContext(task),
      mos: task.candidates.map((candidate, index) => ({
        subtask_id: `MOS-${String(index + 1).padStart(2, "0")}`,
        blind_id: candidate.id,
        scores: answers.mos[candidate.id].scores,
        low_score_issues: answers.mos[candidate.id].low_score_issues,
        notes: answers.mos[candidate.id].notes,
        instruction_deductions: answers.mos[candidate.id].instruction_deductions,
        instruction_note: answers.mos[candidate.id].instruction_note
      })),
      elo_matches: task.eloMatches.map((match) => ({
        subtask_id: match.match_id,
        left_blind_id: match.left_id,
        right_blind_id: match.right_id,
        dimension_results: answers.eloMatches[match.match_id].dimension_results,
        note: answers.eloMatches[match.match_id].note
      })),
      status: "complete",
      completed_subtask_count: task.totalSubtaskCount,
      total_subtask_count: task.totalSubtaskCount,
      started_at: "2026-08-10T03:20:00.000Z",
      completed_at: "2026-08-10T03:34:00.000Z",
      updated_at: "2026-08-10T03:34:00.000Z",
      result_revision: 1,
      revision_remark: "初始评测完成",
      revision_history: [{
        revision: 1,
        updated_at: "2026-08-10T03:34:00.000Z",
        remark: "初始评测完成",
        changes: []
      }]
    };
  }

  function demoEmptyCells(modelCount = state.selectedModelCount) {
    const sample = Array.isArray(D.REVIEW_SAMPLE_ROW) ? D.REVIEW_SAMPLE_ROW : [];
    const row = [
      WORK_ORDER_SCHEMA, sample[1] || "BATCH-DEMO-01", sample[2] || "TASK-DEMO-0007", sample[3] || "CASE-0007",
      sample[4] || "温暖 R&B，男声，92 BPM，雨夜氛围", sample[5] || "玻璃窗上的雨，替我说出没有寄出的信"
    ];
    for (let index = 0; index < modelCount; index += 1) {
      row.push(
        sample[6 + index * 2] || `R-DEMO-${String(index + 1).padStart(2, "0")}`,
        sample[7 + index * 2] || `https://example.com/audio/case-demo-${index + 1}.mp3`
      );
    }
    row.push(`K-DEMO-${modelCount}M-7KQ2-MX9H`, "");
    return row;
  }

  function loadDemo(withHistory) {
    let cells = demoEmptyCells();
    const contract = contractFromColumnCount(cells.length);
    cells = normalizeFlatCells(cells, contract.resultIndex);
    if (withHistory) {
      const task = buildTask(cells);
      cells[task.resultIndex] = JSON.stringify(completeAnnotationForDemo(task));
    }
    state.pasteText = U.serializeTSVRow(cells);
    const parsed = parseWorkOrder(state.pasteText, state.selectedModelCount);
    if (parsed.errors.length) {
      state.errors = parsed.errors;
      render();
      return;
    }
    loadTask(parsed.task, parsed.annotation, { skipDraft: true });
    toast(withHistory ? "已加载完整历史结果，可直接检查和修改" : "已加载演示工单", "success");
  }

  function loadQualityDemo() {
    let cells = demoEmptyCells();
    const contract = contractFromColumnCount(cells.length);
    cells = normalizeFlatCells(cells, contract.resultIndex);
    const task = buildTask(cells);
    const annotation = completeAnnotationForDemo(task);
    state.pasteText = JSON.stringify(annotation, null, 2);
    const parsed = parseResultJson(state.pasteText);
    if (parsed.errors.length) {
      state.errors = parsed.errors;
      render();
      return;
    }
    loadTask(parsed.task, parsed.annotation, { skipDraft: true, workMode: "quality" });
    toast("已加载自包含质检结果，可查看时间并逐项验收", "success");
  }

  function taskFromDraft(draft) {
    if (!draft || !Array.isArray(draft.sanitized_cells)) return { task: null, errors: ["本机记录缺少工单字段"] };
    const contract = contractFromColumnCount(draft.sanitized_cells.length + 1);
    if (!contract) return { task: null, errors: ["本机记录与当前格式不兼容"] };
    const cells = draft.sanitized_cells.slice(0, contract.resultIndex).concat("");
    const task = buildTask(cells);
    task.trailingCells = Array.isArray(draft.trailing_cells) ? draft.trailing_cells.slice() : [];
    return { task, errors: validateTask(task) };
  }

  function listDraftHistory(limit = 12) {
    const entries = [];
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
        const draft = readStorage(key);
        const parsed = taskFromDraft(draft);
        if (!parsed.task || parsed.errors.length || !validDraft(draft, parsed.task)) continue;
        const task = parsed.task;
        const completed = Number.isInteger(draft.completed_subtask_count)
          ? draft.completed_subtask_count
          : task.candidates.filter((candidate) => mosAnswerComplete(draft.mos[candidate.id])).length
            + task.eloMatches.filter((match) => eloAnswerComplete(draft.elo_matches[match.match_id])).length;
        entries.push({
          key,
          draft,
          task,
          completed,
          total: task.totalSubtaskCount,
          updatedAt: draft.updated_at || ""
        });
      }
    } catch (error) {
      return [];
    }
    return entries
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, limit);
  }

  function resumeDraftByKey(key) {
    const draft = readStorage(key);
    const parsed = taskFromDraft(draft);
    if (!draft || !parsed.task || parsed.errors.length || !validDraft(draft, parsed.task)) {
      toast("这条本机记录已损坏或与当前格式不兼容", "error");
      return;
    }
    writeStorage(LAST_DRAFT_KEY, { key, updated_at: draft.updated_at || U.nowISO() });
    state.pasteText = U.serializeTSVRow(parsed.task.cells);
    state.selectedModelCount = parsed.task.modelCount;
    writeModelCountPreference(parsed.task.modelCount);
    loadTask(parsed.task, null);
  }

  function resumeLastDraft() {
    const pointer = readStorage(LAST_DRAFT_KEY);
    if (!pointer || !pointer.key) {
      toast("没有可恢复的本地草稿", "error");
      return;
    }
    resumeDraftByKey(pointer.key);
  }

  function renderTopbar(extra) {
    return `<header class="review-topbar">
      <div class="review-brand">
        <span class="brand-symbol">${icon("headphones", 19)}</span>
        <span><strong>SonicBench 2–6M</strong><small>动态多模型匿名评测任务卡</small></span>
      </div>
      <nav class="product-tabs" aria-label="产品页面"><a class="is-active" href="./index.html" aria-current="page">评测工作台</a><a href="./readme.html">README</a></nav>
      <div class="topbar-actions">${extra || ""}<span class="privacy-chip">${icon("shield", 15)} 仅处理脱敏工单</span></div>
    </header>`;
  }

  function renderAutoPlayToggle() {
    const enabled = state.autoPlayFirstAudio;
    return `<button type="button" class="autoplay-toggle ${enabled ? "is-on" : ""}" data-action="toggle-autoplay" aria-pressed="${enabled}" title="${enabled ? "关闭" : "开启"}进入子任务时自动播放第一个音频">
      <span class="autoplay-toggle-icon">${icon("headphones", 14)}</span>
      <span class="autoplay-toggle-copy"><strong>首音频自动播放</strong><small>${enabled ? "已开启" : "已关闭"}</small></span>
      <span class="autoplay-switch" aria-hidden="true"><i></i></span>
    </button>`;
  }

  function renderErrors() {
    if (!state.errors.length) return "";
    return `<div class="validation-panel" role="alert">
      <div class="validation-title">${icon("warning", 18)} 无法载入这条工单</div>
      <ul class="validation-list">${state.errors.map((error) => `<li>${h(error)}</li>`).join("")}</ul>
    </div>`;
  }

  function formatTimestamp(value) {
    if (!value) return "未记录";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  function formatAuditValue(value, change) {
    if (value == null || value === "") return "未填写";
    if (Array.isArray(value)) return value.length ? value.join("、") : "未选择";
    if (change && change.scope === "elo" && String(change.field_path || "").startsWith("dimension_results.")) {
      return { left: "A 胜", draw: "平局", right: "B 胜" }[value] || String(value);
    }
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return text.length > 90 ? `${text.slice(0, 87)}…` : text;
  }

  function renderQualityAudit(history) {
    const changes = collectChanges();
    const currentRevision = Number(history && history.result_revision) || 1;
    const revisionHistory = history && Array.isArray(history.revision_history) ? history.revision_history : [];
    const changeRows = changes.map((change) => `<li class="quality-change-row">
      <div class="quality-change-name"><span class="audit-scope audit-scope--${h(change.scope)}">${h(change.subtask_id)}</span><strong>${h(change.field_label)}</strong></div>
      <div class="quality-change-values"><del title="修改前">${h(formatAuditValue(change.before, change))}</del><span>${icon("arrowRight", 13)}</span><ins title="修改后">${h(formatAuditValue(change.after, change))}</ins></div>
    </li>`).join("");
    const historyRows = revisionHistory.map((entry) => `<li><span>Revision ${h(entry.revision)}</span><strong>${h(entry.remark || "未填写版本备注")}</strong><small>${h(formatTimestamp(entry.updated_at))}${Array.isArray(entry.changes) ? ` · ${entry.changes.length} 处字段修改` : ""}</small></li>`).join("");
    return `<div class="quality-audit-region">
      <div class="history-banner">${icon("eye", 18)}<div><strong>质检验收模式</strong><span>所有本次修改都会在导出时追加到版本记录。</span></div>${changes.length ? `<span class="modified-note">已修改 ${changes.length} 处</span>` : `<span class="badge success">原结果未修改</span>`}</div>
      <section class="history-meta" aria-label="历史评测信息">
        <div><span>开始评测</span><strong>${h(formatTimestamp(history && history.started_at))}</strong></div>
        <div><span>完成评测</span><strong>${h(formatTimestamp(history && history.completed_at))}</strong></div>
        <div><span>最近更新</span><strong>${h(formatTimestamp(history && history.updated_at))}</strong></div>
        <div><span>当前版本</span><strong>Revision ${h(currentRevision)}</strong></div>
      </section>
      <section class="quality-change-panel ${changes.length ? "has-changes" : "is-empty"}" aria-label="本次质检修改明细">
        <div class="quality-change-heading"><div><strong>本次修改明细</strong><small>${changes.length ? `导出后将形成 Revision ${currentRevision + 1}` : "修改评分、问题项或备注后会实时显示在这里"}</small></div><span>${changes.length} 处</span></div>
        ${changes.length ? `<ul class="quality-change-list">${changeRows}</ul>` : `<div class="quality-change-empty">${icon("checkCircle", 16)} 当前内容与 Revision ${h(currentRevision)} 完全一致</div>`}
      </section>
      ${revisionHistory.length ? `<details class="revision-history-panel"><summary>查看历史版本备注 · ${revisionHistory.length} 个 Revision</summary><ol>${historyRows}</ol></details>` : ""}
    </div>`;
  }

  function renderLocalDraftHistory(entries) {
    if (!entries.length) return "";
    const rows = entries.map((entry) => {
      const complete = entry.completed === entry.total;
      const exported = Boolean(entry.draft.result_exported);
      return `<li class="local-history-row">
        <div class="local-history-main"><strong>${h(entry.task.caseId)}</strong><span>${h(entry.task.batchId)} · ${h(entry.task.taskBundleId)}</span></div>
        <div class="local-history-progress"><strong>${entry.completed}/${entry.total}</strong><span>${complete ? (exported ? "已完成并导出" : "已完成 · 尚未确认导出") : "进行中"}</span></div>
        <time datetime="${h(entry.updatedAt)}">${h(formatTimestamp(entry.updatedAt))}</time>
        <button type="button" class="button secondary compact" data-action="resume-draft-key" data-key="${h(entry.key)}">恢复记录</button>
      </li>`;
    }).join("");
    return `<section class="local-history-card" aria-label="本机 Case 历史记录">
      <div class="local-history-heading"><div>${icon("refresh", 18)}<span><strong>本机 Case 历史</strong><small>可以恢复尚未复制 JSON 就离开的 Case；仅保存在当前浏览器。</small></span></div><span>${entries.length} 条</span></div>
      <ul class="local-history-list">${rows}</ul>
      <p>${icon("shield", 13)} 历史记录只包含脱敏工单与评分。恢复后仍需在结果页复制或下载 JSON，清理浏览器数据后无法找回。</p>
    </section>`;
  }

  function renderImport() {
    const draftHistory = listDraftHistory();
    const qualityMode = state.importMode === "quality";
    root.innerHTML = `<div class="review-shell import-shell">
      ${renderTopbar("")}
      <main class="review-import">
        <section class="import-hero">
          <span class="eyebrow">FLEXIBLE 2–6 MODELS · ANNOTATE · QUALITY REVIEW</span>
          <h1>${qualityMode ? "载入结果，完成质检验收" : "一行工单，完成一组盲评"}</h1>
          <p>${qualityMode ? "直接粘贴新版自包含结果 JSON，自动恢复 2–6 个匿名音频、历史评分和时间记录。" : "先选择本批次的模型数量，再粘贴 CSV 或从 Excel 直接复制工单行。系统按所选数量读取匿名音频，并生成 n 项 MOS 与 C(n,2) 项随机 ELO 对战。"}</p>
          <div class="import-task-summary" aria-label="每个 Case 包含 n 项 MOS 与 C(n,2) 项 ELO，共 3 至 21 个子任务">
            <span class="task-summary-item"><b>n</b><span><strong>MOS</strong><small>每个候选 1 项</small></span></span>
            <i aria-hidden="true">+</i>
            <span class="task-summary-item"><b>C(n,2)</b><span><strong>ELO</strong><small>两两随机对战</small></span></span>
            <i aria-hidden="true">=</i>
            <span class="task-summary-item task-summary-total"><b>3–21</b><span><strong>子任务</strong><small>按模型数自动计算</small></span></span>
          </div>
        </section>
        ${renderLocalDraftHistory(draftHistory)}
        <section class="import-card">
          <div class="mode-switch" role="tablist" aria-label="工作模式">
            <button class="mode-option ${qualityMode ? "" : "is-active"}" data-action="set-import-mode" data-mode="annotate" role="tab" aria-selected="${!qualityMode}"><strong>标注模式</strong><span>选择 2–6 个模型并粘贴工单</span></button>
            <button class="mode-option ${qualityMode ? "is-active" : ""}" data-action="set-import-mode" data-mode="quality" role="tab" aria-selected="${qualityMode}"><strong>质检验收模式</strong><span>直接粘贴自包含结果 JSON</span></button>
          </div>
          ${qualityMode ? "" : `<div class="model-count-setting"><div><strong>本批次模型数量</strong><span>选择一次后会保存在当前浏览器，后续默认保持不变。</span></div><div class="model-count-options" role="radiogroup" aria-label="模型数量">${Array.from({ length: MAX_MODEL_COUNT - MIN_MODEL_COUNT + 1 }, (_, offset) => MIN_MODEL_COUNT + offset).map((count) => `<button type="button" data-action="set-model-count" data-count="${count}" role="radio" aria-checked="${state.selectedModelCount === count}" class="${state.selectedModelCount === count ? "is-selected" : ""}">${count} 个模型</button>`).join("")}</div></div>`}
          <div class="card-heading">
            <div><span class="step-number">01</span><h2>${qualityMode ? "粘贴评测结果 JSON" : "粘贴 Excel 工单行"}</h2></div>
            <span class="column-badge">${qualityMode ? "自包含 JSON" : `${state.selectedModelCount} 模型 · 前 ${7 + state.selectedModelCount * 2} 列必需`}</span>
          </div>
          <label class="sr-only" for="work-order-input">${qualityMode ? "结果 JSON" : "CSV 或 Excel 工单行"}</label>
          <textarea id="work-order-input" class="paste-area" rows="9" placeholder="${qualityMode ? "粘贴包含 work_order、mos、elo_matches 与时间信息的完整结果 JSON。" : "在 Excel 中复制一行工单后粘贴到这里；右侧评审员、分配或备注等附加列不会影响解析。"}">${h(state.pasteText)}</textarea>
          ${renderErrors()}
          <div class="import-actions">
            <div class="demo-actions">
              ${qualityMode ? `<button class="button ghost" data-action="demo-quality">${icon("eye", 16)} 加载质检 JSON 示例</button>` : `<button class="button ghost" data-action="demo-empty">${icon("file", 16)} 加载演示空行</button><button class="button ghost" data-action="demo-history">${icon("eye", 16)} 加载完整历史行</button>`}
            </div>
            <button class="button primary" data-action="parse-input">${qualityMode ? "解析并进入质检" : "解析并进入标注"} ${icon("arrowRight", 16)}</button>
          </div>
        </section>
        <section class="import-footnote">
          ${icon("info", 16)}
          <span>${qualityMode ? "新版结果 JSON 自带脱敏后的音频 ID 与 URL，不包含管理员模型 Mapping；旧版纯评分 JSON 需改用完整工单载入。" : `当前按 ${state.selectedModelCount} 模型读取必要字段。annotation_result_json 可省略；其右侧增加的评审员、分配或备注列会被忽略，不影响进入标注。`}</span>
        </section>
      </main>
    </div>`;
  }

  function renderProgressBand() {
    const p = progress();
    const task = state.task;
    const segments = Array.from({ length: task.totalSubtaskCount }, (_, index) => {
      const complete = index < task.modelCount
        ? mosComplete(state.task.candidates[index].id)
        : eloMatchComplete(state.task.eloMatches[index - task.modelCount].match_id);
      const locked = index >= task.modelCount && p.mos < task.modelCount;
      const classes = ["progress-segment", complete ? "is-done" : "", index === state.currentIndex ? "is-current" : "", locked ? "is-locked" : ""].filter(Boolean).join(" ");
      const stageClass = index < task.modelCount ? "progress-segment--mos" : "progress-segment--elo";
      return `<span class="${classes} ${stageClass}" title="${index < task.modelCount ? `MOS ${index + 1}` : `ELO ${index - task.modelCount + 1}`}"></span>`;
    }).join("");
    return `<section class="progress-band">
      <div class="progress-summary"><strong>${p.total}<em>/${task.totalSubtaskCount}</em></strong><span>总进度</span></div>
      <div class="progress-detail"><div><span>MOS</span><b>${p.mos}/${task.modelCount}</b></div><div class="progress-track" style="--task-count:${task.totalSubtaskCount}">${segments}</div><div><span>ELO</span><b>${p.elo}/${task.eloMatchCount}</b></div></div>
    </section>`;
  }

  function renderTaskRail() {
    const p = progress();
    const eloStage = state.currentIndex >= state.task.modelCount;
    const renderItem = (index, title, subtitle, complete, locked) => {
      const classes = ["task-nav-item", state.currentIndex === index ? "is-active" : "", complete ? "is-complete" : "", locked ? "is-locked" : "", taskChanged(index) ? "is-changed" : ""].filter(Boolean).join(" ");
      return `<button type="button" class="${classes}" data-action="go-task" data-index="${index}" ${state.currentIndex === index ? 'aria-current="step"' : ""} ${locked ? "disabled" : ""}>
        <span class="task-index">${complete ? icon("check", 14) : locked ? icon("lock", 13) : String(index + 1).padStart(2, "0")}</span>
        <span class="task-label"><strong>${h(title)}</strong><small class="mono">${h(subtitle)}</small></span>
        ${taskChanged(index) ? `<span class="change-dot" title="已修改"></span>` : ""}
      </button>`;
    };
    const mosItems = state.task.candidates.map((candidate, index) => renderItem(
      index, `候选 ${String(candidate.slot).padStart(2, "0")}`, eloStage ? "身份已隐藏" : candidate.id, mosComplete(candidate.id), false
    )).join("");
    const eloItems = state.task.eloMatches.map((match, index) => renderItem(
      index + state.task.modelCount, `ELO 对战 ${String(index + 1).padStart(2, "0")}`, match.match_id,
      eloMatchComplete(match.match_id), p.mos < state.task.modelCount
    )).join("");
    return `<aside class="task-rail">
      <div class="rail-group rail-group--mos"><div class="rail-group-title"><span>MOS 评分</span><b>${p.mos}/${state.task.modelCount}</b></div>${mosItems}</div>
      <div class="rail-divider"></div>
      <div class="rail-group rail-group--elo"><div class="rail-group-title"><span>ELO 对战</span><b>${p.elo}/${state.task.eloMatchCount}</b></div>${eloItems}</div>
      <div class="rail-note">${icon("lock", 14)} 完成 ${state.task.modelCount} 项 MOS 后解锁 ELO</div>
    </aside>`;
  }

  function renderAudioCard(candidate, label, compact, hideIdentity = false) {
    const identity = hideIdentity
      ? `<div class="identity-veil">${icon("shield", 15)}<span><small>身份已隐藏</small><strong>仅以 A / B 完成本场判断</strong></span></div>`
      : `<div><small>匿名音频 ID</small><strong class="mono">${h(candidate.id)}</strong></div>
        <button class="icon-button" data-action="copy-id" data-id="${h(candidate.id)}" title="复制匿名 ID">${icon("copy", 15)}</button>`;
    return `<article class="audio-card ${compact ? "is-compact" : ""} ${hideIdentity ? "is-identity-hidden" : ""}">
      <div class="audio-identity">
        <span class="candidate-marker">${h(label)}</span>
        ${identity}
      </div>
      <audio class="audio-player" controls preload="metadata" data-position-memory="${hideIdentity ? "none" : "task"}" src="${h(candidate.url)}" aria-label="${h(label)}音频"></audio>
    </article>`;
  }

  function renderScoreScale(candidateId, dimension, answer) {
    return `<div class="score-scale" role="group" aria-label="${h(dimension.label)}评分">
      ${[1, 2, 3, 4, 5].map((score) => `<button class="score-button ${answer.scores[dimension.key] === score ? "is-selected" : ""}" data-action="set-score" data-id="${h(candidateId)}" data-dimension="${h(dimension.key)}" data-score="${score}" aria-pressed="${answer.scores[dimension.key] === score}" title="${score} · ${SCORE_CAPTIONS[score]}"><b>${score}</b><span>${SCORE_CAPTIONS[score]}</span></button>`).join("")}
    </div>`;
  }

  function renderNote(candidateId, dimensionKey, value, label, required) {
    return `<label class="dimension-note-field"><span>${h(label)}${required ? " · 必填" : ""}</span><textarea rows="2" data-role="mos-note" data-id="${h(candidateId)}" data-dimension="${h(dimensionKey)}" placeholder="请输入简要说明">${h(value || "")}</textarea></label>`;
  }

  function renderIssueChips(candidateId, dimension, answer) {
    const selected = answer.low_score_issues[dimension.key] || [];
    const options = LOW_SCORE_OPTIONS[dimension.key] || ["其他"];
    return `<div class="issue-panel"><div class="issue-heading"><div><strong>低分问题</strong><small>必填 · 可多选</small></div><span>评分 ≤ 3</span></div><div class="issue-chips">${options.map((option) => `<button type="button" class="issue-chip ${selected.includes(option) ? "is-selected" : ""}" data-action="toggle-issue" data-id="${h(candidateId)}" data-dimension="${h(dimension.key)}" data-issue="${h(option)}" aria-pressed="${selected.includes(option)}">${selected.includes(option) ? icon("check", 11) : ""}<span>${h(option)}</span></button>`).join("")}</div>${selected.includes("其他") ? renderNote(candidateId, dimension.key, answer.notes[dimension.key], "“其他”问题补充", true) : ""}</div>`;
  }

  function renderDimension(candidateId, dimension, answer, config) {
    const score = answer.scores[dimension.key];
    const low = Number.isInteger(score) && score <= 3;
    return `<div class="dimension-block ${config.overall ? "is-overall" : ""}" data-dimension="${h(dimension.key)}"><div class="dimension-row"><div class="dimension-copy"><strong>${h(dimension.label)}</strong></div>${renderScoreScale(candidateId, dimension, answer)}</div>${config.subdimension && low ? renderIssueChips(candidateId, dimension, answer) : ""}${config.overall && low ? renderNote(candidateId, dimension.key, answer.notes[dimension.key], "整体维度低分备注", true) : ""}</div>`;
  }

  function renderInstructionDeductions(candidateId, answer) {
    const instructionScore = answer.scores[INSTRUCTION_DIMENSION.key];
    if (!Number.isInteger(instructionScore) || instructionScore >= 5) return "";
    return `<div class="issue-panel instruction-issues"><div class="issue-heading"><div><strong>指令扣分项</strong><small>必填 · 可多选</small></div><span>评分低于 5</span></div><div class="issue-chips">${INSTRUCTION_DEDUCTION_OPTIONS.map((option) => `<button type="button" class="issue-chip ${answer.instruction_deductions.includes(option) ? "is-selected" : ""}" data-action="toggle-deduction" data-id="${h(candidateId)}" data-issue="${h(option)}" aria-pressed="${answer.instruction_deductions.includes(option)}">${answer.instruction_deductions.includes(option) ? icon("check", 11) : ""}<span>${h(option)}</span></button>`).join("")}</div><label class="dimension-note-field"><span>扣分原因备注 · 必填</span><textarea rows="2" data-role="instruction-note" data-id="${h(candidateId)}" placeholder="说明具体未遵循之处">${h(answer.instruction_note || "")}</textarea></label></div>`;
  }

  function renderStickyContext(audioContent) {
    return `<section class="sticky-evaluation-context">
      ${audioContent}
      <div class="sticky-prompt-strip">
        <article class="sticky-info-card"><span>CASE / TAG</span><strong class="mono">${h(state.task.caseId)}</strong><p>${h(state.task.tag || "未提供 Tag")}</p></article>
        <article class="sticky-info-card sticky-lyrics-card"><span>LYRICS</span><p>${h(state.task.lyrics || "未提供歌词")}</p></article>
      </div>
    </section>`;
  }

  function renderMosTask(index) {
    const candidate = state.task.candidates[index];
    const answer = state.mos[candidate.id];
    const groups = MOS_GROUPS.map((group) => `<section class="mos-group tone-${h(group.tone || "default")}"><div class="mos-group-title"><span>${h(group.label)}</span><small>${group.subdimensions.length} 个子维度 + 1 个整体分</small></div>${group.subdimensions.map((dimension) => renderDimension(candidate.id, dimension, answer, { subdimension: true, groupKey: group.key })).join("")}${renderDimension(candidate.id, group.overall, answer, { overall: true })}</section>`).join("");
    return `<section class="task-stage">
      <div class="stage-heading"><div><span class="stage-kicker">MOS · ${index + 1}/${state.task.modelCount}</span></div><span class="stage-state ${mosComplete(candidate.id) ? "is-complete" : ""}">${mosComplete(candidate.id) ? `${icon("check", 14)} 已完成` : `${mosMissingCount(candidate.id)} 项待补`}</span></div>
      ${renderStickyContext(renderAudioCard(candidate, `候选 ${String(candidate.slot).padStart(2, "0")}`, false, false))}
      <section class="rating-panel layered-rating"><div class="panel-heading"><strong>整体维度与子维度</strong><span>1 很差 · 3 合格 · 5 优秀</span></div>${groups}
        <section class="mos-group tone-purple"><div class="mos-group-title"><span>指令遵循</span><small>未遵循项勾选</small></div>${renderDimension(candidate.id, INSTRUCTION_DIMENSION, answer, {})}${renderInstructionDeductions(candidate.id, answer)}</section>
        <section class="mos-group tone-red"><div class="mos-group-title"><span>总体</span><small>所有分数均须备注</small></div>${renderDimension(candidate.id, TOTAL_DIMENSION, answer, {})}${renderNote(candidate.id, TOTAL_DIMENSION.key, answer.notes[TOTAL_DIMENSION.key], "总评备注", true)}</section>
      </section>
    </section>`;
  }

  function renderEloTask(matchIndex) {
    const match = state.task.eloMatches[matchIndex];
    const left = state.task.candidates[match.left_slot - 1];
    const right = state.task.candidates[match.right_slot - 1];
    const answer = state.eloMatches[match.match_id];
    return `<section class="task-stage">
      <div class="stage-heading"><div><span class="stage-kicker">ELO MATCH · ${matchIndex + 1}/${state.task.eloMatchCount}</span></div><span class="stage-state ${eloMatchComplete(match.match_id) ? "is-complete" : ""}">${eloMatchComplete(match.match_id) ? `${icon("check", 14)} 已完成` : `${eloMissingCount(match.match_id)} 个维度待判断`}</span></div>
      ${renderStickyContext(`<div class="comparison-grid">${renderAudioCard(left, "候选 A", true, true)}<div class="versus-mark">VS</div>${renderAudioCard(right, "候选 B", true, true)}</div>`)}
      <section class="rating-panel elo-rating">
        <div class="panel-heading"><div><strong>分维度 ELO 判断</strong><small>候选身份保持隐藏；每个维度均可选择平局。</small></div><span class="mono">${h(match.match_id)}</span></div>
        <div class="elo-dimension-list">${ELO_DIMENSIONS.map((dimension) => { const outcome = answer.dimension_results[dimension.key]; return `<div class="elo-dimension-row" data-dimension="${h(dimension.key)}"><strong>${h(dimension.label)}</strong><div class="elo-outcomes" role="group" aria-label="${h(dimension.label)}胜平负"><button class="${outcome === "left" ? "is-selected" : ""}" data-action="set-elo-outcome" data-match="${h(match.match_id)}" data-dimension="${h(dimension.key)}" data-outcome="left" aria-pressed="${outcome === "left"}">A 胜</button><button class="${outcome === "draw" ? "is-selected is-draw" : ""}" data-action="set-elo-outcome" data-match="${h(match.match_id)}" data-dimension="${h(dimension.key)}" data-outcome="draw" aria-pressed="${outcome === "draw"}">平局</button><button class="${outcome === "right" ? "is-selected" : ""}" data-action="set-elo-outcome" data-match="${h(match.match_id)}" data-dimension="${h(dimension.key)}" data-outcome="right" aria-pressed="${outcome === "right"}">B 胜</button></div></div>`; }).join("")}</div>
        <label class="dimension-note-field elo-note"><span>本场共用备注 · 选填</span><textarea rows="2" data-role="elo-note" data-match="${h(match.match_id)}" placeholder="可补充四个维度的共同判断依据">${h(answer.note || "")}</textarea></label>
      </section>
    </section>`;
  }

  function currentComplete() {
    if (state.currentIndex < state.task.modelCount) return mosComplete(state.task.candidates[state.currentIndex].id);
    const match = state.task.eloMatches[state.currentIndex - state.task.modelCount];
    return eloMatchComplete(match.match_id);
  }

  function renderValidationGuide() {
    const items = state.validationOpen ? currentMissingItems() : [];
    if (!items.length) return '<section class="missing-guide" data-validation-guide hidden></section>';
    const preview = items.slice(0, 4).map((item) => h(item.label)).join("；");
    const remaining = items.length > 4 ? `；另有 ${items.length - 4} 项` : "";
    return `<section class="missing-guide" data-validation-guide role="alert" aria-live="assertive">
      <span class="missing-guide-icon">${icon("warning", 18)}</span>
      <div class="missing-guide-copy"><strong>还有 ${items.length} 项必填内容未完成</strong><p>${preview}${remaining}</p></div>
      <button type="button" class="button compact" data-action="jump-missing">定位第一处 ${icon("arrowRight", 14)}</button>
    </section>`;
  }

  function renderActionBar() {
    const p = progress();
    const isLast = state.currentIndex === state.task.totalSubtaskCount - 1;
    const qualityMode = state.workMode === "quality" || state.loadedHistory;
    const rightActions = qualityMode
      ? `<div class="action-bar-actions"><button type="button" class="button secondary" data-action="next" ${isLast ? "disabled" : ""}>下一项 ${icon("arrowRight", 16)}</button><button type="button" class="button primary" data-action="show-result" ${p.total === state.task.totalSubtaskCount ? "" : "disabled"}>${icon("download", 16)} 导出结果</button></div>`
      : p.total === state.task.totalSubtaskCount
        ? `<button type="button" class="button primary" data-action="show-result">查看并导出结果 ${icon("arrowRight", 16)}</button>`
        : `<button type="button" class="button primary" data-action="next">${isLast ? "完成当前项" : "保存并下一项"} ${icon("arrowRight", 16)}</button>`;
    return `<footer class="action-bar">
      <button type="button" class="button secondary" data-action="previous" ${state.currentIndex === 0 ? "disabled" : ""}>${icon("arrowLeft", 16)} 上一项</button>
      <span class="autosave-state">${icon("checkCircle", 14)} 已自动保存到本机</span>
      ${rightActions}
    </footer>`;
  }

  function renderWorkspace() {
    const task = state.task;
    const history = state.sourceAnnotation || {};
    const taskSurface = state.currentIndex < task.modelCount ? renderMosTask(state.currentIndex) : renderEloTask(state.currentIndex - task.modelCount);
    root.innerHTML = `<div class="review-shell">
      ${renderTopbar(`${renderAutoPlayToggle()}<button class="button ghost compact" data-action="change-order">${icon("paste", 15)} 更换工单</button>`)}
      <main class="review-workspace">
        <section class="workspace-header">
          <div class="case-header"><div><span class="eyebrow">${h(task.taskBundleId)}</span><h1>${h(task.caseId)}</h1></div><div class="case-meta"><span>${task.modelCount} 模型 · ${task.totalSubtaskCount} 子任务</span><span>${h(task.batchId)}</span><span class="mono">FP ${h(task.fingerprint)}</span></div></div>
          ${state.loadedHistory ? renderQualityAudit(history) : ""}
          ${state.restoredDraft ? `<div class="history-banner draft-mode">${icon("refresh", 18)}<div><strong>已恢复本地草稿</strong><span>继续上次未完成的位置；最终仍需复制结果回工单。</span></div></div>` : ""}
          ${renderProgressBand()}
        </section>
        <div class="review-layout">${renderTaskRail()}<div class="task-main">${taskSurface}${renderValidationGuide()}${renderActionBar()}</div></div>
      </main>
    </div>`;
  }

  function renderResult() {
    const result = state.exportResult || createAnnotation();
    state.exportResult = result;
    const compact = JSON.stringify(result);
    const qualityMode = state.workMode === "quality" || state.loadedHistory;
    root.innerHTML = `<div class="review-shell">
      ${renderTopbar(`<button class="button ghost compact" data-action="back-task">${icon("arrowLeft", 15)} 返回检查</button>`)}
      <main class="result-page">
        <section class="result-hero"><span class="success-mark">${icon("check", 30)}</span><div><span class="eyebrow">${state.task.totalSubtaskCount} / ${state.task.totalSubtaskCount} COMPLETED</span><h1>这组评测已完成</h1><p>${h(state.task.caseId)} · 所有 MOS 与 ELO 对战结果已通过完整性校验。</p></div></section>
        <div class="result-layout">
          <section class="completion-card">
            <div class="card-heading"><h2>完成检查</h2><span class="badge success">可导出</span></div>
            <ul class="completion-list">
              <li>${icon("checkCircle", 18)}<span><strong>${state.task.modelCount} / ${state.task.modelCount} MOS</strong><small>${state.task.modelCount} 个匿名音频均完成整体维度、子维度与必填反馈</small></span></li>
              <li>${icon("checkCircle", 18)}<span><strong>${state.task.eloMatchCount} / ${state.task.eloMatchCount} ELO 对战</strong><small>${state.task.eloMatchCount} 组对战均完成四维胜／平／负判断</small></span></li>
              <li>${icon("shield", 18)}<span><strong>自包含脱敏任务</strong><small>包含匿名 ID 与音频 URL，但不写入真实模型来源 Mapping</small></span></li>
              <li>${icon("file", 18)}<span><strong class="mono">FP ${h(state.task.fingerprint)}</strong><small>用于回填时检测错行</small></span></li>
            </ul>
            ${state.loadedHistory ? `<div class="revision-summary"><span>检查修订</span><strong>Revision ${result.result_revision}</strong><small>${h(result.revision_remark || (changedCount() ? `本次修改 ${changedCount()} 处` : "本次未修改原答案"))}</small></div>` : ""}
          </section>
          <section class="json-card">
            <div class="card-heading"><div><h2>自包含结果 JSON</h2><span>${compact.length.toLocaleString()} characters</span></div><span class="mono">${h(result.schema_version || RESULT_SCHEMA)}</span></div>
            <pre class="json-preview"><code>${h(JSON.stringify(result, null, 2))}</code></pre>
            <div class="result-actions">
              <button class="button primary" data-action="copy-json">${icon("copy", 16)} 复制结果 JSON</button>
              <button class="button secondary" data-action="copy-row">${icon("table", 16)} 复制完整工单行</button>
              <button class="button secondary" data-action="download-row-csv">${icon("file-spreadsheet", 16)} 下载结果 CSV</button>
              <button class="button ghost" data-action="download-json">${icon("download", 16)} 下载 JSON</button>
            </div>
            <p class="result-tip">此 JSON 已包含 Case、Tag、Lyrics、匿名音频 ID + URL 与 ELO 顺序信息，可直接交给质检人员载入；也可写回 Excel 最后一列。</p>
          </section>
        </div>
        <section class="result-continuation">
          <div><span class="eyebrow">NEXT CASE</span><strong>继续处理下一条 Case</strong><small>${qualityMode ? "返回质检主页，粘贴下一条自包含结果 JSON。" : "返回标注主页，粘贴下一条动态列脱敏工单。"}</small><small class="result-export-state ${state.resultExported ? "is-exported" : ""}" data-result-export-state>${state.resultExported ? `${icon("checkCircle", 13)} 已复制或下载；可以继续下一条 Case` : `${icon("warning", 13)} 尚未复制或下载结果；离开前会再次提醒，本机历史仍可恢复`}</small></div>
          <button type="button" class="button secondary" data-action="new-case">导入新 Case ${icon("arrowRight", 16)}</button>
        </section>
      </main>
    </div>`;
  }

  function render() {
    rememberAllAudioPlayback();
    const nextSubtaskKey = currentSubtaskKey();
    const enteredNewSubtask = Boolean(nextSubtaskKey && nextSubtaskKey !== lastRenderedSubtaskKey);
    const currentRail = typeof root.querySelector === "function" ? root.querySelector(".task-rail") : null;
    if (currentRail) state.railScrollTop = currentRail.scrollTop;
    if (state.screen === "import") renderImport();
    else if (state.screen === "result") renderResult();
    else renderWorkspace();
    if (state.screen === "task" && typeof root.querySelector === "function") {
      const nextRail = root.querySelector(".task-rail");
      if (nextRail) {
        nextRail.scrollTop = state.railScrollTop;
        const active = nextRail.querySelector(".task-nav-item.is-active");
        if (active) {
          const top = active.offsetTop;
          const bottom = top + active.offsetHeight;
          if (top < nextRail.scrollTop) nextRail.scrollTop = top - 8;
          else if (bottom > nextRail.scrollTop + nextRail.clientHeight) nextRail.scrollTop = bottom - nextRail.clientHeight + 8;
          state.railScrollTop = nextRail.scrollTop;
        }
      }
      initializeAudioPlayers();
      lastRenderedSubtaskKey = nextSubtaskKey;
      if (enteredNewSubtask) autoPlayCurrentTask();
    }
  }

  function replaceHtml(element, html) {
    if (!element) return null;
    const template = document.createElement("template");
    template.innerHTML = String(html).trim();
    const replacement = template.content.firstElementChild;
    if (!replacement) return null;
    element.replaceWith(replacement);
    return replacement;
  }

  function dimensionRenderConfig(dimensionKey) {
    for (const group of MOS_GROUPS) {
      const subdimension = (group.subdimensions || []).find((dimension) => dimension.key === dimensionKey);
      if (subdimension) return { dimension: subdimension, config: { subdimension: true, groupKey: group.key } };
      if (group.overall && group.overall.key === dimensionKey) return { dimension: group.overall, config: { overall: true } };
    }
    const dimension = DIMENSIONS.find((item) => item.key === dimensionKey);
    return dimension ? { dimension, config: {} } : null;
  }

  function refreshInstructionPanel(group, candidateId, answer) {
    if (!group) return;
    const existing = group.querySelector(".instruction-issues");
    const markup = renderInstructionDeductions(candidateId, answer);
    if (existing && markup) replaceHtml(existing, markup);
    else if (existing) existing.remove();
    else if (markup) group.insertAdjacentHTML("beforeend", markup);
  }

  function refreshCurrentStageState() {
    const element = root.querySelector(".stage-state");
    if (!element || !state.task) return;
    if (state.currentIndex < state.task.modelCount) {
      const candidate = state.task.candidates[state.currentIndex];
      const complete = mosComplete(candidate.id);
      element.classList.toggle("is-complete", complete);
      element.innerHTML = complete ? `${icon("check", 14)} 已完成` : `${mosMissingCount(candidate.id)} 项待补`;
      return;
    }
    const match = state.task.eloMatches[state.currentIndex - state.task.modelCount];
    const complete = eloMatchComplete(match.match_id);
    element.classList.toggle("is-complete", complete);
    element.innerHTML = complete ? `${icon("check", 14)} 已完成` : `${eloMissingCount(match.match_id)} 个维度待判断`;
  }

  function clearMissingHighlights() {
    root.querySelectorAll(".is-required-missing").forEach((element) => {
      element.classList.remove("is-required-missing");
      element.removeAttribute("aria-invalid");
    });
  }

  function refreshValidationGuide() {
    const items = state.validationOpen ? currentMissingItems() : [];
    if (!items.length) state.validationOpen = false;
    replaceHtml(root.querySelector("[data-validation-guide]"), renderValidationGuide());
  }

  function jumpToFirstMissing() {
    const item = currentMissingItems()[0];
    if (!item) {
      state.validationOpen = false;
      refreshValidationGuide();
      return;
    }
    clearMissingHighlights();
    const target = root.querySelector(item.selector);
    if (!target) return;
    target.classList.add("is-required-missing");
    target.setAttribute("aria-invalid", "true");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusTarget = target.matches("button,textarea,input,select")
      ? target
      : target.querySelector("button,textarea,input,select");
    if (focusTarget) window.setTimeout(() => focusTarget.focus({ preventScroll: true }), 260);
  }

  function refreshWorkspaceStatus() {
    if (state.screen !== "task") return;
    const rail = root.querySelector(".task-rail");
    const railScrollTop = rail ? rail.scrollTop : state.railScrollTop;
    replaceHtml(root.querySelector(".progress-band"), renderProgressBand());
    const nextRail = replaceHtml(rail, renderTaskRail());
    if (nextRail) {
      nextRail.scrollTop = railScrollTop;
      state.railScrollTop = railScrollTop;
    }
    replaceHtml(root.querySelector(".action-bar"), renderActionBar());
    refreshCurrentStageState();
    refreshValidationGuide();
    refreshQualityAuditRegion();
  }

  function refreshQualityAuditRegion() {
    if (!state.loadedHistory) return;
    replaceHtml(root.querySelector(".quality-audit-region"), renderQualityAudit(state.sourceAnnotation || {}));
  }

  function refreshMosDimension(block, candidateId, dimensionKey) {
    const definition = dimensionRenderConfig(dimensionKey);
    const answer = state.mos[candidateId];
    if (!block || !definition || !answer) return;
    const group = block.closest(".mos-group");
    replaceHtml(block, renderDimension(candidateId, definition.dimension, answer, definition.config));
    if (dimensionKey === INSTRUCTION_DIMENSION.key) refreshInstructionPanel(group, candidateId, answer);
    refreshWorkspaceStatus();
  }

  function refreshIssuePanel(panel, candidateId, dimensionKey) {
    const definition = dimensionRenderConfig(dimensionKey);
    const answer = state.mos[candidateId];
    if (panel && definition && answer) replaceHtml(panel, renderIssueChips(candidateId, definition.dimension, answer));
    refreshWorkspaceStatus();
  }

  function refreshEloOutcomeButtons(group, selectedOutcome) {
    if (!group) return;
    group.querySelectorAll("button[data-outcome]").forEach((button) => {
      const selected = button.dataset.outcome === selectedOutcome;
      button.classList.toggle("is-selected", selected);
      button.classList.toggle("is-draw", selected && selectedOutcome === "draw");
      button.setAttribute("aria-pressed", String(selected));
    });
    refreshWorkspaceStatus();
  }

  function goNext() {
    if (!currentComplete()) {
      const items = currentMissingItems();
      state.validationOpen = true;
      refreshValidationGuide();
      const preview = items.slice(0, 2).map((item) => item.label).join("；");
      toast(`还有 ${items.length} 项未完成${preview ? `：${preview}${items.length > 2 ? "……" : ""}` : ""}`, "error");
      jumpToFirstMissing();
      return;
    }
    state.validationOpen = false;
    clearMissingHighlights();
    const p = progress();
    if (state.currentIndex === state.task.modelCount - 1 && p.mos < state.task.modelCount) {
      toast(`请先完成全部 ${state.task.modelCount} 项 MOS`, "error");
      return;
    }
    if (state.currentIndex < state.task.totalSubtaskCount - 1) state.currentIndex += 1;
    flushDraftSave();
    render();
  }

  function showResult() {
    const p = progress();
    if (p.total !== state.task.totalSubtaskCount) {
      toast(`还有 ${state.task.totalSubtaskCount - p.total} 个子任务未完成`, "error");
      return;
    }
    if (!state.exportResult) state.exportResult = createAnnotation();
    state.screen = "result";
    flushDraftSave();
    render();
  }

  function adoptExportedRevision() {
    if (!state.loadedHistory || !state.exportResult) return;
    state.sourceAnnotation = clone(state.exportResult);
    state.baseline = annotationToAnswers(state.exportResult, state.task);
    state.task.cells[state.task.resultIndex] = JSON.stringify(state.exportResult);
    state.exportResult = null;
    saveDraft();
  }

  function startNewCase() {
    if (state.exportResult && !state.resultExported
      && !window.confirm("这条 Case 的结果尚未复制或下载。评分已保存在本机历史中，仍要继续导入新 Case 吗？")) return;
    flushDraftSave();
    const nextMode = state.workMode === "quality" || state.loadedHistory ? "quality" : "annotate";
    state.screen = "import";
    state.importMode = nextMode;
    state.workMode = nextMode;
    state.pasteText = "";
    state.errors = [];
    state.task = null;
    state.mos = {};
    state.eloMatches = {};
    state.currentIndex = 0;
    state.startedAt = null;
    state.baseline = null;
    state.loadedHistory = false;
    state.exportResult = null;
    state.resultExported = false;
    state.restoredDraft = false;
    state.sourceAnnotation = null;
    state.railScrollTop = 0;
    state.validationOpen = false;
    playbackMemory.clear();
    lastRenderedSubtaskKey = "";
    if (draftSaveTimer != null) {
      window.clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }
    render();
  }

  root.addEventListener("input", (event) => {
    if (event.target.id === "work-order-input") state.pasteText = event.target.value;
    if (event.target.dataset.role === "mos-note") {
      state.mos[event.target.dataset.id].notes[event.target.dataset.dimension] = event.target.value;
      invalidateExportResult();
      scheduleDraftSave();
      clearMissingHighlights();
      refreshWorkspaceStatus();
    }
    if (event.target.dataset.role === "instruction-note") {
      state.mos[event.target.dataset.id].instruction_note = event.target.value;
      invalidateExportResult();
      scheduleDraftSave();
      clearMissingHighlights();
      refreshWorkspaceStatus();
    }
    if (event.target.dataset.role === "elo-note") {
      state.eloMatches[event.target.dataset.match].note = event.target.value;
      invalidateExportResult();
      scheduleDraftSave();
      refreshQualityAuditRegion();
    }
  });

  root.addEventListener("play", (event) => {
    if (!event.target || event.target.tagName !== "AUDIO") return;
    root.querySelectorAll("audio").forEach((audio) => {
      if (audio !== event.target && !audio.paused) {
        audio.pause();
        rememberAudioPlayback(audio);
      }
    });
    rememberAudioPlayback(event.target);
  }, true);

  ["pause", "timeupdate", "seeked", "volumechange"].forEach((eventName) => {
    root.addEventListener(eventName, (event) => {
      if (event.target && event.target.tagName === "AUDIO") rememberAudioPlayback(event.target);
    }, true);
  });

  root.addEventListener("ended", (event) => {
    if (event.target && event.target.tagName === "AUDIO") rememberAudioPlayback(event.target, { reset: true });
  }, true);

  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;

    if (action === "demo-empty") return loadDemo(false);
    if (action === "demo-history") return loadDemo(true);
    if (action === "demo-quality") return loadQualityDemo();
    if (action === "resume-draft") return resumeLastDraft();
    if (action === "resume-draft-key") return resumeDraftByKey(target.dataset.key);
    if (action === "toggle-autoplay") {
      state.autoPlayFirstAudio = !state.autoPlayFirstAudio;
      writeAutoPlayPreference(state.autoPlayFirstAudio);
      replaceHtml(target, renderAutoPlayToggle());
      if (state.autoPlayFirstAudio) autoPlayCurrentTask();
      toast(state.autoPlayFirstAudio ? "已开启：进入新子任务时自动播放第一个音频" : "已关闭子任务自动播放", "success");
      return;
    }
    if (action === "set-import-mode") {
      state.importMode = target.dataset.mode === "quality" ? "quality" : "annotate";
      state.pasteText = "";
      state.errors = [];
      return render();
    }
    if (action === "set-model-count") {
      const count = Number(target.dataset.count);
      if (!isSupportedModelCount(count)) return;
      state.selectedModelCount = count;
      writeModelCountPreference(count);
      state.errors = [];
      render();
      toast(`已固定为 ${count} 模型工单；下次打开仍保持该选择`, "success");
      return;
    }
    if (action === "parse-input") {
      const parsed = state.importMode === "quality" ? parseResultJson(state.pasteText) : parseWorkOrder(state.pasteText, state.selectedModelCount);
      state.errors = parsed.errors || [];
      if (state.errors.length) return render();
      // A manually pasted row is authoritative. Local answers are restored only
      // through the explicit "恢复草稿" action on the import screen.
      return loadTask(parsed.task, parsed.annotation, { workMode: state.importMode, skipDraft: true });
    }
    if (action === "change-order") {
      if (state.task && progress().total > 0 && !window.confirm("当前进度已自动保存在本机。确定返回并粘贴另一条工单吗？")) return;
      state.screen = "import";
      state.importMode = state.workMode === "quality" ? "quality" : "annotate";
      state.errors = [];
      state.pasteText = "";
      return render();
    }
    if (action === "copy-id") {
      return U.copyText(target.dataset.id).then(() => toast("匿名 ID 已复制", "success")).catch(() => toast("复制失败，请手动选择", "error"));
    }
    if (action === "set-score") {
      clearMissingHighlights();
      const score = Number(target.dataset.score);
      const answer = state.mos[target.dataset.id];
      answer.scores[target.dataset.dimension] = score;
      invalidateExportResult();
      scheduleDraftSave();
      return refreshMosDimension(target.closest(".dimension-block"), target.dataset.id, target.dataset.dimension);
    }
    if (action === "toggle-issue") {
      clearMissingHighlights();
      const answer = state.mos[target.dataset.id];
      const selected = answer.low_score_issues[target.dataset.dimension] || [];
      answer.low_score_issues[target.dataset.dimension] = selected.includes(target.dataset.issue)
        ? selected.filter((item) => item !== target.dataset.issue)
        : selected.concat(target.dataset.issue);
      invalidateExportResult();
      scheduleDraftSave();
      return refreshIssuePanel(target.closest(".issue-panel"), target.dataset.id, target.dataset.dimension);
    }
    if (action === "toggle-deduction") {
      clearMissingHighlights();
      const answer = state.mos[target.dataset.id];
      answer.instruction_deductions = answer.instruction_deductions.includes(target.dataset.issue)
        ? answer.instruction_deductions.filter((item) => item !== target.dataset.issue)
        : answer.instruction_deductions.concat(target.dataset.issue);
      invalidateExportResult();
      scheduleDraftSave();
      const panel = target.closest(".instruction-issues");
      if (panel) replaceHtml(panel, renderInstructionDeductions(target.dataset.id, answer));
      refreshWorkspaceStatus();
      return;
    }
    if (action === "set-elo-outcome") {
      if (!["left", "draw", "right"].includes(target.dataset.outcome) || !ELO_DIMENSIONS.some((dimension) => dimension.key === target.dataset.dimension)) {
        return toast("无法识别这一维度的 ELO 结果", "error");
      }
      clearMissingHighlights();
      state.eloMatches[target.dataset.match].dimension_results[target.dataset.dimension] = target.dataset.outcome;
      invalidateExportResult();
      scheduleDraftSave();
      return refreshEloOutcomeButtons(target.closest(".elo-outcomes"), target.dataset.outcome);
    }
    if (action === "go-task") {
      const index = Number(target.dataset.index);
      if (index >= state.task.modelCount && progress().mos < state.task.modelCount) return toast("完成全部 MOS 后才能进入 ELO 对战", "error");
      state.validationOpen = false;
      state.currentIndex = index;
      flushDraftSave();
      return render();
    }
    if (action === "previous") {
      state.validationOpen = false;
      state.currentIndex = Math.max(0, state.currentIndex - 1);
      flushDraftSave();
      return render();
    }
    if (action === "jump-missing") return jumpToFirstMissing();
    if (action === "next") return goNext();
    if (action === "show-result") return showResult();
    if (action === "new-case") return startNewCase();
    if (action === "back-task") {
      adoptExportedRevision();
      state.screen = "task";
      return render();
    }
    if (action === "copy-json") {
      return U.copyText(JSON.stringify(state.exportResult)).then(() => {
        markResultExported();
        toast("结果 JSON 已复制", "success");
      }).catch(() => toast("复制失败，请从预览区手动复制", "error"));
    }
    if (action === "copy-row") {
      const cells = state.task.cells.slice(0, state.task.resultIndex).concat(JSON.stringify(state.exportResult), state.task.trailingCells || []);
      return U.copyText(U.serializeTSVRow(cells)).then(() => {
        markResultExported();
        toast(`结果行已复制${(state.task.trailingCells || []).length ? "，右侧附加信息已保留" : ""}`, "success");
      }).catch(() => toast("复制失败，请改用结果 JSON", "error"));
    }
    if (action === "download-row-csv") {
      const cells = state.task.cells.slice(0, state.task.resultIndex).concat(JSON.stringify(state.exportResult), state.task.trailingCells || []);
      U.downloadText(
        `${U.fileSafe(state.task.caseId)}-completed-work-order.csv`,
        `\uFEFF${U.serializeCSVRow(cells)}`,
        "text/csv;charset=utf-8"
      );
      markResultExported();
      return toast("结果 CSV 已下载", "success");
    }
    if (action === "download-json") {
      const filename = `${U.fileSafe(state.task.caseId)}-anonymous-review.json`;
      U.downloadText(filename, JSON.stringify(state.exportResult, null, 2), "application/json;charset=utf-8");
      markResultExported();
      return toast("JSON 文件已下载", "success");
    }
  });

  render();
})();
