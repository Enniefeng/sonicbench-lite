(function (global) {
  "use strict";
  const D = global.SB_SHARED_DATA || (typeof require === "function" ? require("./shared-data.js") : null);
  if (!D) throw new Error("SB_SHARED_DATA is required");
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const text = (value) => String(value == null ? "" : value).trim();

  function decode(value, label) {
    let current = value;
    for (let index = 0; index < 3 && typeof current === "string"; index += 1) {
      if (!current.trim()) throw new Error(`请粘贴${label}`);
      try { current = JSON.parse(current); } catch (error) { throw new Error(`${label}不是有效 JSON：${error.message}`); }
    }
    return current;
  }
  function unwrapResult(value) {
    const current = decode(value, "结果 JSON");
    if (Array.isArray(current)) {
      if (current.length !== 1) throw new Error("验收查看端一次只载入一个 Case，请只保留一条结果");
      return unwrapResult(current[0]);
    }
    if (!current || typeof current !== "object") throw new Error("结果 JSON 必须是对象");
    if (Array.isArray(current.mos)) return clone(current);
    for (const key of ["annotation_result_json", "result", "annotation", "item"]) {
      if (current[key] != null) return unwrapResult(current[key]);
    }
    throw new Error("没有找到包含 mos 的单 Case 结果");
  }
  function parseMapping(value) {
    const mapping = decode(value, "管理员 Mapping");
    if (!mapping || typeof mapping !== "object" || !Array.isArray(mapping.entries) || !mapping.entries.length) throw new Error("管理员 Mapping 缺少 entries");
    return clone(mapping);
  }
  function entryIdentity(entry) { return text(entry.source_model_key || entry.source_column || "未知模型"); }
  function modelOrder(entry, mapping) {
    const columns = Array.isArray(mapping.source_model_columns) ? mapping.source_model_columns.map(text) : [];
    const column = text(entry.source_column), key = text(entry.source_model_key);
    let index = columns.findIndex((item) => item === column || item.replace(/_url$/i, "") === key);
    if (index >= 0) return index + 1;
    const matched = `${key} ${column}`.match(/model[_\s-]?(\d+)/i);
    return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER;
  }
  function resolveEntry(mapping, result, blindId) {
    const batchId = text(result.batch_id || result.work_order && result.work_order.batch_id);
    const caseId = text(result.case_id || result.work_order && result.work_order.case_id);
    const exact = mapping.entries.filter((entry) => text(entry.blind_id) === blindId && (!batchId || text(entry.batch_id) === batchId) && (!caseId || text(entry.case_id) === caseId));
    const candidates = exact.length ? exact : mapping.entries.filter((entry) => text(entry.blind_id) === blindId);
    if (candidates.length !== 1) throw new Error(`${blindId || "未知匿名 ID"} 无法在 Mapping 中唯一还原模型来源`);
    return candidates[0];
  }
  function modelView(entry, mapping) {
    const order = modelOrder(entry, mapping), key = entryIdentity(entry);
    return { order, label: Number.isFinite(order) && order < Number.MAX_SAFE_INTEGER ? `Model ${order}` : key, key, source_column: text(entry.source_column) };
  }
  function normalizeOutcome(value, match) {
    if (["left", "right", "draw"].includes(value)) return value;
    if (value === "tie") return "draw";
    if (match && match.winner_blind_id === match.left_blind_id) return "left";
    if (match && match.winner_blind_id === match.right_blind_id) return "right";
    return "";
  }
  function buildView(mappingValue, resultValue) {
    const mapping = parseMapping(mappingValue), result = unwrapResult(resultValue);
    if (!Array.isArray(result.mos) || !result.mos.length) throw new Error("结果缺少 MOS 子任务");
    const byBlind = new Map();
    const mos = result.mos.map((item, index) => {
      const blindId = text(item.blind_id), entry = resolveEntry(mapping, result, blindId), model = modelView(entry, mapping);
      if (byBlind.has(blindId)) throw new Error(`MOS 匿名 ID 重复：${blindId}`);
      byBlind.set(blindId, model);
      return { subtask_id: text(item.subtask_id || `MOS-${String(index + 1).padStart(2, "0")}`), model, scores: clone(item.scores || {}), low_score_issues: clone(item.low_score_issues || {}), notes: clone(item.notes || {}), instruction_deductions: clone(item.instruction_deductions || []), instruction_note: text(item.instruction_note) };
    }).sort((left, right) => left.model.order - right.model.order || left.subtask_id.localeCompare(right.subtask_id));
    const elo = (Array.isArray(result.elo_matches) ? result.elo_matches : []).map((match, index) => {
      const leftId = text(match.left_blind_id), rightId = text(match.right_blind_id);
      const left = byBlind.get(leftId) || modelView(resolveEntry(mapping, result, leftId), mapping);
      const right = byBlind.get(rightId) || modelView(resolveEntry(mapping, result, rightId), mapping);
      const dimensionResults = {};
      D.ELO_DIMENSIONS.forEach((dimension) => { dimensionResults[dimension.key] = normalizeOutcome(match.dimension_results && match.dimension_results[dimension.key], dimension.key === "overall" ? match : null); });
      return { subtask_id: text(match.subtask_id || `ELO-${String(index + 1).padStart(2, "0")}`), left, right, dimension_results: dimensionResults, note: text(match.note) };
    });
    return { mos_dimensions: clone(D.MOS_DIMENSIONS), elo_dimensions: clone(D.ELO_DIMENSIONS), mos, elo };
  }
  const api = { unwrapResult, parseMapping, buildView };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.SonicBenchAcceptanceViewer = api;
})(typeof window !== "undefined" ? window : globalThis);
