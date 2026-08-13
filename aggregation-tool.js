(function () {
  "use strict";

  const root = document.getElementById("aggregate-app");
  const U = window.SB_UTILS;
  const D = window.SB_SHARED_DATA;
  const UI = window.SB_UI;
  if (!root || !U || !D || !UI) return;

  const DIMENSIONS = Array.isArray(D.MOS_DIMENSIONS) ? D.MOS_DIMENSIONS : [];
  const ELO_DIMENSIONS = Array.isArray(D.ELO_DIMENSIONS) ? D.ELO_DIMENSIONS : [];
  const K_FACTOR = 32;
  const INITIAL_RATING = 1500;
  const state = { mappingText: "", resultText: "", report: null, errors: [] };

  function h(value) { return UI.escapeHtml(value); }
  function icon(name, size) { return UI.icon(name, size); }
  function notify(message, tone) { UI.toast(message, tone || "info"); }
  function mappingKey(batchId, caseId, blindId) { return `${batchId}::${caseId}::${blindId}`; }
  function sourceKey(entry) { return String(entry.source_model_key || entry.source_column || "unknown_model").trim(); }

  function parseMapping(text) {
    const parsed = U.safeJsonParse(String(text || "").trim());
    if (parsed.error || !parsed.value || typeof parsed.value !== "object") throw new Error("Mapping JSON 不是有效对象");
    const mapping = parsed.value;
    if (!Array.isArray(mapping.entries) || !mapping.entries.length) throw new Error("Mapping JSON 缺少 entries");
    if (!String(mapping.mapping_version || "").includes("sonicbench-mapping")) throw new Error("Mapping schema 不受支持");
    const index = new Map();
    const sources = new Map();
    mapping.entries.forEach((entry, indexNumber) => {
      ["batch_id", "case_id", "blind_id"].forEach((field) => {
        if (!entry[field]) throw new Error(`Mapping 第 ${indexNumber + 1} 条缺少 ${field}`);
      });
      const key = mappingKey(entry.batch_id, entry.case_id, entry.blind_id);
      if (index.has(key)) throw new Error(`Mapping 存在重复 Blind ID：${entry.blind_id}`);
      const model = sourceKey(entry);
      index.set(key, { ...entry, source_model_key: model });
      if (!sources.has(model)) sources.set(model, { source_model_key: model, cases: new Set() });
      sources.get(model).cases.add(entry.case_id);
    });
    return { mapping, index, sources };
  }

  function collectJsonObjects(value, output) {
    if (Array.isArray(value)) return value.forEach((item) => collectJsonObjects(item, output));
    if (!value || typeof value !== "object") return;
    if (value.schema_version && Array.isArray(value.mos) && Array.isArray(value.elo_matches)) {
      output.push(value);
      return;
    }
    ["results", "annotations", "items"].forEach((key) => {
      if (Array.isArray(value[key])) value[key].forEach((item) => collectJsonObjects(item, output));
    });
  }

  function parseResults(text) {
    const source = String(text || "").trim();
    if (!source) throw new Error("请导入评测结果");
    const annotations = [];
    const whole = U.safeJsonParse(source);
    if (!whole.error) collectJsonObjects(whole.value, annotations);
    if (!annotations.length) {
      U.parseDelimitedDetailed(source).rows.forEach((row) => row.forEach((cell) => {
        const parsed = U.safeJsonParse(String(cell || "").trim());
        if (!parsed.error) collectJsonObjects(parsed.value, annotations);
      }));
    }
    if (!annotations.length) {
      source.split(/\r?\n/).forEach((line) => {
        const parsed = U.safeJsonParse(line.trim());
        if (!parsed.error) collectJsonObjects(parsed.value, annotations);
      });
    }
    if (!annotations.length) throw new Error("没有找到完整的 annotation result JSON");
    return annotations;
  }

  function validateAndResolve(annotations, mappingBundle) {
    const seenTasks = new Set();
    return annotations.map((annotation, annotationIndex) => {
      const batchId = String(annotation.batch_id || "");
      const caseId = String(annotation.case_id || "");
      const taskId = String(annotation.task_bundle_id || "");
      if (!batchId || !caseId || !taskId) throw new Error(`结果 ${annotationIndex + 1} 缺少批次、任务或 Case ID`);
      if (mappingBundle.mapping.batch_id && batchId !== mappingBundle.mapping.batch_id) throw new Error(`结果 ${annotationIndex + 1} 与 Mapping 批次不一致`);
      if (annotation.status !== "complete") throw new Error(`结果 ${annotationIndex + 1} 尚未完成`);
      if (seenTasks.has(taskId)) throw new Error(`结果包含重复任务：${taskId}`);
      seenTasks.add(taskId);
      const candidates = new Map();
      const listed = annotation.work_order && Array.isArray(annotation.work_order.candidates) ? annotation.work_order.candidates : [];
      (listed.length ? listed : annotation.mos).forEach((candidate) => {
        const blindId = candidate.blind_id || candidate.id;
        const entry = mappingBundle.index.get(mappingKey(batchId, caseId, blindId));
        if (!entry) throw new Error(`Case ${caseId} 的 ${blindId} 无法在 Mapping 中还原`);
        candidates.set(blindId, entry);
      });
      if (candidates.size !== Number(annotation.model_count || candidates.size)) throw new Error(`Case ${caseId} 的候选数量与结果声明不一致`);
      return { annotation, batchId, caseId, taskId, candidates };
    });
  }

  function mean(values) {
    const valid = values.filter((value) => Number.isFinite(value));
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  }

  function calculateMos(resolved) {
    const byModel = new Map();
    const rows = [];
    resolved.forEach((item) => item.annotation.mos.forEach((mos) => {
      const source = item.candidates.get(mos.blind_id);
      if (!source) throw new Error(`MOS 的 ${mos.blind_id} 无法在 Mapping 中还原`);
      const model = source.source_model_key;
      if (!byModel.has(model)) byModel.set(model, { source_model_key: model, cases: new Set(), scores: {} });
      const summary = byModel.get(model);
      summary.cases.add(item.caseId);
      const row = { batch_id: item.batchId, case_id: item.caseId, task_bundle_id: item.taskId, source_model_key: model, source_column: source.source_column || "", source_url: source.source_url || "", blind_id: mos.blind_id };
      DIMENSIONS.forEach((dimension) => {
        const value = Number(mos.scores && mos.scores[dimension.key]);
        if (!Number.isFinite(value)) throw new Error(`Case ${item.caseId} 的 ${model} 缺少 MOS：${dimension.label}`);
        if (!summary.scores[dimension.key]) summary.scores[dimension.key] = [];
        summary.scores[dimension.key].push(value);
        row[dimension.key] = value;
      });
      rows.push(row);
    }));
    const summary = Array.from(byModel.values()).map((item) => {
      const output = { source_model_key: item.source_model_key, case_count: item.cases.size };
      DIMENSIONS.forEach((dimension) => { output[dimension.key] = mean(item.scores[dimension.key] || []); });
      return output;
    });
    return { rows, summary };
  }

  function outcomeScore(value, side) {
    if (value === "draw") return 0.5;
    if (value === side) return 1;
    if (value === (side === "left" ? "right" : "left")) return 0;
    return null;
  }

  function calculateElo(resolved) {
    const ratings = {};
    const records = [];
    ELO_DIMENSIONS.forEach((dimension) => { ratings[dimension.key] = new Map(); });
    resolved.forEach((item) => item.annotation.elo_matches.forEach((match) => {
      const left = item.candidates.get(match.left_blind_id);
      const right = item.candidates.get(match.right_blind_id);
      if (!left || !right) throw new Error(`Case ${item.caseId} 的 ELO 候选无法在 Mapping 中还原`);
      if (left.source_model_key === right.source_model_key) throw new Error(`Case ${item.caseId} 的 ELO 对战映射到同一模型`);
      ELO_DIMENSIONS.forEach((dimension) => {
        const result = match.dimension_results && match.dimension_results[dimension.key];
        const leftScore = outcomeScore(result, "left");
        if (leftScore == null) throw new Error(`Case ${item.caseId} 缺少 ELO：${dimension.label}`);
        const table = ratings[dimension.key];
        const leftModel = left.source_model_key;
        const rightModel = right.source_model_key;
        const beforeLeft = table.has(leftModel) ? table.get(leftModel) : INITIAL_RATING;
        const beforeRight = table.has(rightModel) ? table.get(rightModel) : INITIAL_RATING;
        const expectedLeft = 1 / (1 + Math.pow(10, (beforeRight - beforeLeft) / 400));
        const delta = K_FACTOR * (leftScore - expectedLeft);
        table.set(leftModel, beforeLeft + delta);
        table.set(rightModel, beforeRight - delta);
        records.push({ batch_id: item.batchId, case_id: item.caseId, task_bundle_id: item.taskId, subtask_id: match.subtask_id, dimension: dimension.key, left_source_model_key: leftModel, right_source_model_key: rightModel, result, left_rating_before: beforeLeft, right_rating_before: beforeRight, left_rating_after: beforeLeft + delta, right_rating_after: beforeRight - delta });
      });
    }));
    const models = new Set();
    Object.values(ratings).forEach((table) => table.forEach((value, key) => models.add(key)));
    const summary = Array.from(models).map((model) => {
      const output = { source_model_key: model };
      ELO_DIMENSIONS.forEach((dimension) => { output[dimension.key] = ratings[dimension.key].get(model) || INITIAL_RATING; });
      return output;
    });
    return { records, summary };
  }

  function calculate() {
    state.errors = [];
    try {
      const mappingBundle = parseMapping(state.mappingText);
      const resolved = validateAndResolve(parseResults(state.resultText), mappingBundle);
      const mos = calculateMos(resolved);
      const elo = calculateElo(resolved);
      state.report = {
        schema_version: "sonicbench-aggregate-report/1.0",
        generated_at: U.nowISO(),
        batch_id: mappingBundle.mapping.batch_id || resolved[0].batchId,
        model_count: mappingBundle.mapping.model_count || mappingBundle.sources.size,
        case_count: new Set(resolved.map((item) => item.caseId)).size,
        annotation_count: resolved.length,
        elo_config: { initial_rating: INITIAL_RATING, k_factor: K_FACTOR, update_order: "input_annotation_order_then_subtask_order", draw_score: 0.5 },
        model_source_notice: "Contains restored model identity and source URL. Administrator-only export.",
        mos_summary: mos.summary,
        elo_summary: elo.summary,
        restored_mos_records: mos.rows,
        restored_elo_records: elo.records
      };
      render();
      notify(`已还原 ${state.report.case_count} 个 Case，并完成 MOS / ELO 计算`, "success");
    } catch (error) {
      state.report = null;
      state.errors = [error.message || String(error)];
      render();
      notify("计算失败，请检查输入文件", "error");
    }
  }

  function mosSummaryCsv(report) {
    const headers = ["source_model_key", "case_count"].concat(DIMENSIONS.map((dimension) => dimension.key));
    const rows = report.mos_summary.map((item) => headers.map((header) => typeof item[header] === "number" ? item[header].toFixed(4) : (item[header] == null ? "" : item[header])));
    return U.serializeCSV([headers].concat(rows));
  }

  function eloSummaryCsv(report) {
    const headers = ["source_model_key"].concat(ELO_DIMENSIONS.map((dimension) => `${dimension.key}_elo`));
    const rows = report.elo_summary.map((item) => [item.source_model_key].concat(ELO_DIMENSIONS.map((dimension) => item[dimension.key].toFixed(2))));
    return U.serializeCSV([headers].concat(rows));
  }

  function resultCards() {
    if (!state.report) return `<section class="aggregate-empty panel-card">${icon("table", 30)}<h2>等待管理员导入两类文件</h2><p>Mapping 负责将 Blind ID 还原为模型来源；结果文件负责提供 MOS 与 ELO 判断。两个文件只在浏览器内存中处理。</p></section>`;
    const report = state.report;
    const mosRows = report.mos_summary.map((item) => `<tr><td><strong>${h(item.source_model_key)}</strong></td><td>${item.case_count}</td><td>${item.musicality_overall.toFixed(2)}</td><td>${item.acoustics_overall.toFixed(2)}</td><td>${item.vocals_overall.toFixed(2)}</td><td>${item.instruction_following.toFixed(2)}</td><td>${item.overall.toFixed(2)}</td></tr>`).join("");
    const eloRows = report.elo_summary.slice().sort((a, b) => b.overall - a.overall).map((item, index) => `<tr><td class="mono">${index + 1}</td><td><strong>${h(item.source_model_key)}</strong></td><td>${item.musicality.toFixed(1)}</td><td>${item.acoustics.toFixed(1)}</td><td>${item.vocals.toFixed(1)}</td><td><strong>${item.overall.toFixed(1)}</strong></td></tr>`).join("");
    return `<section class="aggregate-result-stack">
      <div class="aggregate-metrics"><article><strong>${report.model_count}</strong><span>模型</span></article><article><strong>${report.case_count}</strong><span>Case</span></article><article><strong>${report.annotation_count}</strong><span>有效结果</span></article><article><strong>${report.restored_elo_records.length}</strong><span>维度级 ELO 判断</span></article></div>
      <article class="panel-card aggregate-table-card"><div class="card-heading"><div><h2>MOS 均分</h2><span>按真实模型来源聚合，保留 15 个评分维度</span></div><button type="button" class="button secondary" data-action="download-mos">${icon("download", 16)} 导出 MOS CSV</button></div><div class="table-scroll"><table class="aggregate-table"><thead><tr><th>模型</th><th>Case</th><th>音乐性</th><th>音质</th><th>Vocals</th><th>指令遵循</th><th>总评</th></tr></thead><tbody>${mosRows}</tbody></table></div></article>
      <article class="panel-card aggregate-table-card"><div class="card-heading"><div><h2>ELO 排名</h2><span>初始分 ${INITIAL_RATING} · K=${K_FACTOR} · 平局 0.5；按导入顺序更新</span></div><button type="button" class="button secondary" data-action="download-elo">${icon("download", 16)} 导出 ELO CSV</button></div><div class="table-scroll"><table class="aggregate-table"><thead><tr><th>#</th><th>模型</th><th>音乐性</th><th>音质</th><th>Vocals</th><th>总体</th></tr></thead><tbody>${eloRows}</tbody></table></div></article>
      <article class="mapping-vault aggregate-vault"><div class="vault-icon">${icon("lock", 22)}</div><div><h2>管理员敏感结果包</h2><p>包含真实模型身份、源 URL、明细评分与完整 ELO 更新轨迹。不要发送给评测员或质检员。</p></div><button type="button" class="button button-dark" data-action="download-report">${icon("download", 16)} 下载完整 JSON</button></article>
    </section>`;
  }

  function render() {
    root.innerHTML = `<header class="admin-topbar"><a class="brand-lockup" href="admin.html"><span class="brand-mark">${icon("audio-waveform", 22)}</span><span><strong>SonicBench</strong><small>Evaluation Lite</small></span></a><div class="topbar-context"><span class="context-dot"></span><span>管理员结果工作台</span><span class="status-pill status-private">${icon("shield", 14)} 敏感数据</span></div><nav class="topbar-actions"><a class="button button-ghost" href="admin.html">${icon("shuffle", 16)} 生成工单</a><a class="button button-ghost" href="index.html">${icon("headphones", 16)} 评测入口</a></nav></header>
      <main class="admin-main aggregate-main"><section class="admin-hero aggregate-hero"><div class="hero-copy"><span class="eyebrow accent">ADMIN ONLY · DE-BLIND · SCORE</span><h1>把匿名结果，还原成可决策的模型指标</h1><p>导入管理员 Mapping 与评测结果，严格按批次、Case、Blind ID 对齐。输出真实模型维度的 MOS 均分、ELO 排名和可审计明细。</p></div><div class="aggregate-flow" aria-label="结果回算流程"><span>Mapping</span>${icon("arrowRight", 17)}<span>结果 JSON / CSV</span>${icon("arrowRight", 17)}<strong>MOS + ELO</strong></div></section>
      <section class="aggregate-input-grid"><article class="panel-card aggregate-input-card"><div class="panel-heading"><div><span class="step-kicker">01 / SOURCE IDENTITY</span><h2>管理员 Mapping JSON</h2><p>使用生成脱敏工单时下载的同批次 Mapping。</p></div></div><textarea id="mapping-input" class="raw-textarea" rows="10" spellcheck="false" placeholder="粘贴 sonicbench-mapping/... JSON"></textarea><label class="button button-ghost file-button">${icon("upload", 16)} 选择 Mapping JSON<input id="mapping-file" type="file" accept=".json,application/json" hidden></label></article>
      <article class="panel-card aggregate-input-card"><div class="panel-heading"><div><span class="step-kicker">02 / REVIEW OUTPUT</span><h2>评测结果</h2><p>支持单个/数组结果 JSON、JSONL，或包含结果末列的 CSV。</p></div></div><textarea id="result-input" class="raw-textarea" rows="10" spellcheck="false" placeholder="粘贴自包含结果 JSON、JSON 数组、JSONL 或结果 CSV"></textarea><label class="button button-ghost file-button">${icon("upload", 16)} 选择结果文件<input id="result-file" type="file" accept=".json,.jsonl,.csv,.txt,application/json,text/csv" hidden></label></article></section>
      ${state.errors.length ? `<section class="error-summary">${icon("warning", 18)}<div><strong>无法计算</strong><ul>${state.errors.map((error) => `<li>${h(error)}</li>`).join("")}</ul></div></section>` : ""}
      <div class="aggregate-primary-action"><span>所有数据只在当前页面内存处理，不上传服务器。</span><button type="button" class="button button-primary" data-action="calculate" ${state.mappingText.trim() && state.resultText.trim() ? "" : "disabled"}>${icon("table", 17)} 还原并计算结果</button></div>${resultCards()}</main>`;
    const mappingInput = document.getElementById("mapping-input");
    const resultInput = document.getElementById("result-input");
    if (mappingInput) mappingInput.value = state.mappingText;
    if (resultInput) resultInput.value = state.resultText;
  }

  function loadFile(file, kind) {
    const reader = new FileReader();
    reader.onload = () => {
      if (kind === "mapping") state.mappingText = String(reader.result || "");
      else state.resultText = String(reader.result || "");
      state.report = null;
      state.errors = [];
      render();
      notify(`${file.name} 已载入`, "success");
    };
    reader.readAsText(file, "utf-8");
  }

  root.addEventListener("input", (event) => {
    if (event.target.id === "mapping-input") state.mappingText = event.target.value;
    if (event.target.id === "result-input") state.resultText = event.target.value;
    const button = root.querySelector('[data-action="calculate"]');
    if (button) button.disabled = !(state.mappingText.trim() && state.resultText.trim());
  });
  root.addEventListener("change", (event) => {
    if (event.target.id === "mapping-file" && event.target.files[0]) loadFile(event.target.files[0], "mapping");
    if (event.target.id === "result-file" && event.target.files[0]) loadFile(event.target.files[0], "result");
  });
  root.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-action]");
    if (!trigger) return;
    const action = trigger.dataset.action;
    if (action === "calculate") calculate();
    if (!state.report) return;
    const prefix = U.fileSafe(state.report.batch_id || "sonicbench");
    if (action === "download-mos") U.downloadText(`${prefix}-mos-summary.csv`, mosSummaryCsv(state.report), "text/csv;charset=utf-8");
    if (action === "download-elo") U.downloadText(`${prefix}-elo-summary.csv`, eloSummaryCsv(state.report), "text/csv;charset=utf-8");
    if (action === "download-report") U.downloadText(`${prefix}-restored-aggregate-report.json`, JSON.stringify(state.report, null, 2), "application/json;charset=utf-8");
  });

  window.SB_AGGREGATION_TEST = { parseMapping, parseResults, validateAndResolve, calculateMos, calculateElo, mosSummaryCsv, eloSummaryCsv };
  render();
})();
