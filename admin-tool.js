(function () {
  "use strict";

  const U = window.SB_UTILS;
  const DATA = window.SB_ADMIN_DATA;
  const SHARED = window.SB_SHARED_DATA;
  const UI = window.SB_UI;
  const root = document.getElementById("admin-app");

  if (!root || !U || !DATA || !SHARED || !UI) return;

  const MIN_MODEL_COUNT = SHARED.MIN_MODEL_COUNT || 2;
  const MAX_MODEL_COUNT = SHARED.MAX_MODEL_COUNT || 6;
  const WORK_ORDER_SCHEMA = SHARED.WORK_ORDER_SCHEMA || "sonicbench-work-order/flexible-model/1.0";
  const RAW_HEADERS = typeof SHARED.rawInputHeaders === "function"
    ? SHARED.rawInputHeaders(MAX_MODEL_COUNT)
    : ["case_id", "tag", "lyrics", "model_1_url", "model_2_url", "model_3_url", "model_4_url", "model_5_url", "model_6_url"];
  const URL_RISK_WORDS = [
    "model",
    "vendor",
    "provider",
    "checkpoint",
    "musicgen",
    "suno",
    "udio",
    "seed",
    "version"
  ];

  const state = {
    rawText: "",
    inspection: null,
    modelCount: 0,
    batchId: "",
    generatedAt: "",
    generatedRows: [],
    generatedLines: [],
    workOrderTsv: "",
    workOrderCsv: "",
    mapping: null,
    generatedSourceHash: ""
  };

  function h(value) {
    return UI.escapeHtml(String(value == null ? "" : value));
  }

  function icon(name, size) {
    return UI.icon(name, size || 18);
  }

  function notify(message, tone) {
    UI.toast(message, tone || "default");
  }

  function encodeSingleLineCell(value) {
    return U.protectSpreadsheetText(U.encodeFlatText(value));
  }

  function workOrderHeaders(modelCount) {
    if (typeof SHARED.workOrderHeaders === "function") return SHARED.workOrderHeaders(modelCount);
    const headers = ["schema_version", "batch_id", "task_bundle_id", "case_id", "tag", "lyrics"];
    for (let index = 1; index <= modelCount; index += 1) headers.push(`candidate_${index}_blind_id`, `candidate_${index}_url`);
    return headers.concat("elo_order_key", "annotation_result_json");
  }

  function eloMatchCount(modelCount) {
    return modelCount * (modelCount - 1) / 2;
  }

  function totalSubtaskCount(modelCount) {
    return modelCount + eloMatchCount(modelCount);
  }

  function serializeStrictRow(values, headers) {
    if (values.length !== headers.length) {
      throw new Error(`工单列数错误：应为 ${headers.length} 列，实际为 ${values.length} 列`);
    }
    return U.serializeTSVRow(values.map(encodeSingleLineCell));
  }

  function serializeStrictCsvRow(values, headers) {
    if (values.length !== headers.length) {
      throw new Error(`工单列数错误：应为 ${headers.length} 列，实际为 ${values.length} 列`);
    }
    return U.serializeCSVRow(values.map(encodeSingleLineCell));
  }

  function canonicalUrl(value) {
    try {
      return new URL(String(value || "").trim()).href;
    } catch (error) {
      return String(value || "").trim();
    }
  }

  function normalizeToken(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
  }

  function isHeaderRow(row) {
    const normalized = (row || []).map((value) => normalizeToken(value));
    const firstMatches = normalized[0] === "caseid" || normalized[0] === "id";
    const secondMatches = ["tag", "tags", "prompt"].includes(normalized[1]);
    const thirdMatches = ["lyrics", "lyric"].includes(normalized[2]);
    return firstMatches && secondMatches && thirdMatches;
  }

  function sourceLabelFromHeader(value, index) {
    const label = String(value || "").trim();
    return label || `model_${index + 1}`;
  }

  function effectiveModelCount(row) {
    const values = Array.isArray(row) ? row : [];
    let last = values.length - 1;
    while (last >= 3 && !String(values[last] || "").trim()) last -= 1;
    return Math.max(0, last - 2);
  }

  function urlRiskReasons(url, sourceHeaders) {
    let decoded = String(url || "").toLowerCase();
    try {
      decoded = decodeURIComponent(decoded);
    } catch (error) {
      // Keep the original URL when malformed percent escapes exist.
    }
    const compact = normalizeToken(decoded);
    const reasons = [];

    URL_RISK_WORDS.forEach((word) => {
      if (decoded.includes(word)) reasons.push(`URL 含“${word}”`);
    });

    (sourceHeaders || []).forEach((header) => {
      const token = normalizeToken(String(header || "").replace(/(?:audio|output)?_?url$/i, ""));
      if (token.length >= 5 && compact.includes(token)) reasons.push("URL 含原模型列标识");
    });

    return Array.from(new Set(reasons));
  }

  function inspectRaw(text) {
    const parsed = U.parseDelimitedDetailed(text);
    const parsedRows = parsed.rows;
    const errors = [];
    const warnings = [];

    if (String(text || "").includes("\uFFFD")) {
      return {
        records: [],
        sourceHeaders: RAW_HEADERS.slice(3),
        modelCount: 0,
        hasHeader: false,
        delimiter: parsed.delimiter,
        errors: [{ line: 0, field: "input", message: "CSV 可能不是 UTF-8 编码，请在 Excel 中重新另存为 CSV UTF-8" }],
        warnings
      };
    }

    if (parsed.error) {
      return {
        records: [],
        sourceHeaders: RAW_HEADERS.slice(3),
        modelCount: 0,
        hasHeader: false,
        delimiter: parsed.delimiter,
        errors: [{ line: 0, field: "input", message: parsed.error }],
        warnings
      };
    }

    if (!parsedRows.length) {
      return {
        records: [],
        sourceHeaders: RAW_HEADERS.slice(3),
        modelCount: 0,
        hasHeader: false,
        errors: [{ line: 0, field: "input", message: "请粘贴至少一行原始数据" }],
        delimiter: parsed.delimiter,
        warnings
      };
    }

    const hasHeader = isHeaderRow(parsedRows[0]);
    const header = hasHeader ? parsedRows[0] : RAW_HEADERS;
    const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;
    const modelCount = dataRows.reduce((maximum, row) => Math.max(maximum, effectiveModelCount(row)), 0);
    const sourceHeaders = Array.from({ length: Math.max(modelCount, MIN_MODEL_COUNT) }, (_, index) => sourceLabelFromHeader(header[index + 3], index));
    const firstSeen = new Map();
    const records = [];

    if (modelCount < MIN_MODEL_COUNT || modelCount > MAX_MODEL_COUNT) {
      errors.push({
        line: 0,
        field: "model_url",
        message: `每个 Case 需要 ${MIN_MODEL_COUNT}–${MAX_MODEL_COUNT} 个连续的模型 URL；当前推断为 ${modelCount || 0} 个`
      });
    }

    dataRows.forEach((row, dataIndex) => {
      const line = dataIndex + (hasHeader ? 2 : 1);
      if (row.length < 3 + Math.min(Math.max(modelCount, MIN_MODEL_COUNT), MAX_MODEL_COUNT) || row.length > 3 + MAX_MODEL_COUNT) {
        errors.push({
          line,
          field: "row",
          message: `需要 3 列 Case 信息 + ${MIN_MODEL_COUNT}–${MAX_MODEL_COUNT} 列 URL，当前解析到 ${row.length} 列；含逗号的内容请使用双引号包裹`
        });
      }

      const caseId = String(row[0] || "").trim();
      const tag = String(row[1] || "");
      const lyrics = String(row[2] || "");
      const urls = Array.from({ length: Math.min(Math.max(modelCount, MIN_MODEL_COUNT), MAX_MODEL_COUNT) }, (_, index) => String(row[index + 3] || "").trim());

      if (!caseId) {
        errors.push({ line, field: "case_id", message: "Case ID 不能为空" });
      } else if (firstSeen.has(caseId)) {
        errors.push({
          line,
          field: "case_id",
          message: `Case ID 与第 ${firstSeen.get(caseId)} 行重复：${caseId}`
        });
      } else {
        firstSeen.set(caseId, line);
      }

      urls.forEach((url, index) => {
        if (!url) {
          errors.push({ line, field: `model_${index + 1}_url`, message: `模型 ${index + 1} URL 不能为空` });
        } else if (!U.isHttpUrl(url) || /[\t\r\n]/.test(url)) {
          errors.push({
            line,
            field: `model_${index + 1}_url`,
            message: `模型 ${index + 1} 必须是有效的 http(s) URL`
          });
        }
      });

      const canonicalUrls = urls.map(canonicalUrl);
      const seenUrls = new Map();
      canonicalUrls.forEach((url, index) => {
        if (!urls[index]) return;
        if (seenUrls.has(url)) {
          errors.push({
            line,
            field: `model_${index + 1}_url`,
            message: `与模型 ${seenUrls.get(url) + 1} 使用了相同 URL，无法进行有效盲评`
          });
        } else {
          seenUrls.set(url, index);
        }
      });

      urls.forEach((url, index) => {
        if (!U.isHttpUrl(url)) return;
        const reasons = urlRiskReasons(url, sourceHeaders);
        if (reasons.length) {
          warnings.push({
            line,
            caseId: caseId || `第 ${line} 行`,
            source: sourceHeaders[index],
            host: U.getUrlHost(url),
            reasons
          });
        }
      });

      records.push({ caseId, tag, lyrics, urls, line });
    });

    if (!dataRows.length) {
      errors.push({ line: 0, field: "input", message: "表头之后没有可处理的数据行" });
    }

    return { records, sourceHeaders: sourceHeaders.slice(0, modelCount), modelCount, hasHeader, delimiter: parsed.delimiter, errors, warnings };
  }

  function makeTaskBundleId(usedTaskTokens) {
    return U.uniqueBlindId(usedTaskTokens).replace(/^R-/, "TASK-");
  }

  function makeEloOrderKey(usedKeys) {
    let key = "";
    do {
      key = `K-${U.randomToken(4)}-${U.randomToken(4)}-${U.randomToken(4)}-${U.randomToken(4)}`;
    } while (usedKeys.has(key));
    usedKeys.add(key);
    return key;
  }

  function generateWorkOrder() {
    const sourceHash = U.hashString(state.rawText);
    if (state.mapping && state.generatedSourceHash === sourceHash) {
      notify("当前输入已生成并冻结 Mapping，请直接下载交付文件", "default");
      return;
    }
    const inspection = inspectRaw(state.rawText);
    state.inspection = inspection;
    if (inspection.errors.length) {
      state.generatedRows = [];
      state.generatedLines = [];
      state.workOrderTsv = "";
      state.workOrderCsv = "";
      state.mapping = null;
      state.generatedSourceHash = "";
      render();
      notify(`发现 ${inspection.errors.length} 个问题，请修正后重试`, "error");
      return;
    }

    const batchId = U.makeBatchId();
    const generatedAt = U.nowISO();
    const usedBlindIds = new Set();
    const usedTaskTokens = new Set();
    const usedEloOrderKeys = new Set();
    const generatedRows = [];
    const generatedLines = [];
    const generatedCsvLines = [];
    const mappingEntries = [];
    const modelCount = inspection.modelCount;
    const headers = workOrderHeaders(modelCount);

    inspection.records.forEach((record) => {
      const taskBundleId = makeTaskBundleId(usedTaskTokens);
      const eloOrderKey = makeEloOrderKey(usedEloOrderKeys);
      const shuffledSources = U.secureShuffle(
        record.urls.map((url, sourceIndex) => ({
          url,
          sourceIndex,
          sourceColumn: inspection.sourceHeaders[sourceIndex]
        }))
      );

      const candidates = shuffledSources.map((source, candidateIndex) => {
        const candidate = {
          blindId: U.uniqueBlindId(usedBlindIds),
          url: source.url,
          candidateSlot: candidateIndex + 1,
          sourceIndex: source.sourceIndex,
          sourceColumn: source.sourceColumn
        };
        mappingEntries.push({
          mapping_version: SHARED.MAPPING_SCHEMA || "sonicbench-mapping/flexible-model/1.0",
          batch_id: batchId,
          task_bundle_id: taskBundleId,
          case_id: record.caseId,
          blind_id: candidate.blindId,
          candidate_slot: candidate.candidateSlot,
          source_model_key: String(candidate.sourceColumn).replace(/(?:audio|output)?_?url$/i, ""),
          source_column: candidate.sourceColumn,
          source_url: candidate.url,
          created_at: generatedAt
        });
        return candidate;
      });

      const values = [
        WORK_ORDER_SCHEMA,
        batchId,
        taskBundleId,
        record.caseId,
        record.tag,
        record.lyrics
      ];
      candidates.forEach((candidate) => values.push(candidate.blindId, candidate.url));
      values.push(eloOrderKey, "");

      const line = serializeStrictRow(values, headers);
      const csvLine = serializeStrictCsvRow(values, headers);
      generatedLines.push(line);
      generatedCsvLines.push(csvLine);
      generatedRows.push({
        taskBundleId,
        caseId: record.caseId,
        tag: record.tag,
        lyrics: record.lyrics,
        eloOrderKey,
        candidates,
        line,
        csvLine
      });
    });

    const headerLine = serializeStrictRow(headers, headers);
    const csvHeaderLine = serializeStrictCsvRow(headers, headers);
    state.modelCount = modelCount;
    state.batchId = batchId;
    state.generatedAt = generatedAt;
    state.generatedRows = generatedRows;
    state.generatedLines = generatedLines;
    state.workOrderTsv = [headerLine].concat(generatedLines).join("\n");
    state.workOrderCsv = [csvHeaderLine].concat(generatedCsvLines).join("\r\n");
    state.mapping = {
      mapping_version: SHARED.MAPPING_SCHEMA || "sonicbench-mapping/flexible-model/1.0",
      batch_id: batchId,
      generated_at: generatedAt,
      model_count: modelCount,
      source_model_columns: inspection.sourceHeaders,
      work_order_schema: WORK_ORDER_SCHEMA,
      randomization: {
        scope: "per_case",
        candidate_slots: modelCount,
        blind_id_reuse_across_cases: false,
        elo_order_key_unique_per_case: true,
        elo_order: "derived_from_elo_order_key",
        elo_match_left_right: "derived_from_elo_order_key",
        derived_subtasks: {
          mos_slots: Array.from({ length: modelCount }, (_, index) => index + 1),
          elo_match_combination_set: Array.from({ length: modelCount }, (_, left) =>
            Array.from({ length: modelCount - left - 1 }, (_, offset) => `${left + 1}v${left + offset + 2}`)
          ).flat()
        }
      },
      entries: mappingEntries
    };
    state.generatedSourceHash = sourceHash;

    render();
    notify(`已生成 ${generatedRows.length} 个脱敏任务包`, "success");
  }

  function statusPill(tone, text) {
    return `<span class="status-pill status-${h(tone)}">${text}</span>`;
  }

  function renderErrors() {
    const inspection = state.inspection;
    if (!inspection || !inspection.errors.length) return "";
    return `
      <section class="notice-card notice-error" aria-labelledby="validation-title">
        <div class="notice-icon">${icon("circle-alert", 20)}</div>
        <div class="notice-content">
          <div class="notice-heading-row">
            <h3 id="validation-title">需要修正 ${inspection.errors.length} 个问题</h3>
            ${statusPill("error", "未生成")}
          </div>
          <ul class="issue-list">
            ${inspection.errors.slice(0, 12).map((item) => `
              <li>
                <span class="issue-location">${item.line ? `第 ${item.line} 行` : "输入区"}${item.field ? ` · ${h(item.field)}` : ""}</span>
                <span>${h(item.message)}</span>
              </li>
            `).join("")}
          </ul>
          ${inspection.errors.length > 12 ? `<p class="muted-copy">另有 ${inspection.errors.length - 12} 个问题未展开。</p>` : ""}
        </div>
      </section>
    `;
  }

  function renderWarnings() {
    const warnings = (state.inspection && state.inspection.warnings) || [];
    if (!warnings.length) return "";
    return `
      <section class="notice-card notice-warning" aria-labelledby="url-risk-title">
        <div class="notice-icon">${icon("triangle-alert", 20)}</div>
        <div class="notice-content">
          <div class="notice-heading-row">
            <h3 id="url-risk-title">检测到 ${warnings.length} 个 URL 脱敏风险</h3>
            ${statusPill("warning", "需人工确认")}
          </div>
          <p>随机候选顺序不会改写 URL。路径、域名或文件名中的模型名仍可能暴露来源，建议上线前替换为无语义代理 URL。</p>
          <div class="risk-list">
            ${warnings.slice(0, 5).map((item) => `
              <div class="risk-row">
                <strong>${h(item.caseId)}</strong>
                <span>${h(item.host)}</span>
                <span>${h(item.reasons.join("；"))}</span>
              </div>
            `).join("")}
          </div>
          ${warnings.length > 5 ? `<p class="muted-copy">另有 ${warnings.length - 5} 个风险 URL 未展开。</p>` : ""}
        </div>
      </section>
    `;
  }

  function renderInputPreview() {
    const inspection = state.inspection;
    if (!inspection || !inspection.records.length) {
      return `<div class="empty-mini">粘贴原始数据后，这里会显示解析结果。</div>`;
    }
    return `
      <div class="preview-table-wrap">
        <table class="preview-table">
          <thead><tr><th>Case ID</th><th>Tag</th><th>Lyrics</th><th>结果 URL</th></tr></thead>
          <tbody>
            ${inspection.records.slice(0, 4).map((record) => `
              <tr>
                <td><strong>${h(record.caseId || "—")}</strong></td>
                <td>${h(U.truncate(record.tag, 34) || "—")}</td>
                <td>${h(U.truncate(record.lyrics, 34) || "—")}</td>
                <td><span class="mono-chip">${record.urls.filter(Boolean).length} / ${inspection.modelCount || "—"}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderGeneratedPreview() {
    if (!state.generatedRows.length) {
      return `
        <div class="output-empty">
          <div class="empty-orbit">${icon("shuffle", 25)}</div>
          <h3>等待生成脱敏工单</h3>
          <p>系统会按导入数据自动识别 2–6 个模型；每个 Case 独立随机候选位置并生成批次内唯一 Blind ID。</p>
        </div>
      `;
    }

    return `
      <div class="generated-summary">
        <div>
          <span class="eyebrow">当前批次</span>
          <strong class="batch-id">${h(state.batchId)}</strong>
        </div>
        <div class="summary-metrics">
          <span><strong>${state.generatedRows.length}</strong> Case</span>
          <span><strong>${state.generatedRows.length * state.modelCount}</strong> Blind ID</span>
          <span><strong>${totalSubtaskCount(state.modelCount)}</strong> 子任务 / Case</span>
        </div>
      </div>
      <div class="candidate-preview-list">
        ${state.generatedRows.slice(0, 4).map((row) => `
          <article class="candidate-preview-card">
            <div class="candidate-preview-head">
              <div>
                <span class="eyebrow">${h(row.taskBundleId)}</span>
                <h3>${h(row.caseId)}</h3>
              </div>
              ${statusPill("success", "已脱敏")}
            </div>
            <div class="candidate-grid">
              ${row.candidates.map((candidate) => `
                <div class="candidate-cell">
                  <span>候选 ${candidate.candidateSlot}</span>
                  <strong>${h(candidate.blindId)}</strong>
                  <small>${h(U.getUrlHost(candidate.url))}</small>
                </div>
              `).join("")}
            </div>
            <div class="elo-key-strip">${icon("shuffle", 14)} <span>ELO 顺序 Token</span><code>已隐式固化</code></div>
          </article>
        `).join("")}
      </div>
      ${state.generatedRows.length > 4 ? `<p class="muted-copy preview-footnote">预览前 4 个任务包，共 ${state.generatedRows.length} 个。</p>` : ""}
    `;
  }

  function render() {
    const inspection = state.inspection || inspectRaw(state.rawText);
    state.inspection = inspection;
    const validCount = inspection.records.length;
    const hasOutput = state.generatedRows.length > 0;
    const mappingCount = state.mapping ? state.mapping.entries.length : 0;

    root.innerHTML = `
      <div class="admin-shell">
        <header class="admin-topbar">
          <a class="brand-lockup" href="admin.html" aria-label="SonicBench Lite 管理工具">
            <span class="brand-mark">${icon("audio-waveform", 22)}</span>
            <span><strong>SonicBench</strong><small>Evaluation Lite</small></span>
          </a>
          <div class="topbar-context">
            <span class="context-dot"></span>
            <span>本地脱敏工作台</span>
            ${statusPill("private", `${icon("shield-check", 14)} 数据仅停留在浏览器`)}
          </div>
          <div class="topbar-actions"><a class="button button-ghost" href="aggregation.html">${icon("table", 16)} 结果还原与计算</a><a class="button button-ghost" href="index.html">${icon("headphones", 16)} 评测入口</a></div>
        </header>

        <main class="admin-main">
          <section class="admin-hero">
            <div class="hero-copy">
            <span class="eyebrow accent">ADMIN TOOL · FLEXIBLE 2–6 MODELS</span>
              <h1>把原始模型结果，变成可交付的盲评工单</h1>
              <p>导入 2–6 个模型结果，系统自动识别数量并逐 Case 随机候选位置。Mapping 只保留在当前内存，由管理员单独下载。</p>
            </div>
            <div class="hero-flow" aria-label="处理流程">
              <div class="flow-step active"><span>1</span><strong>原始表格</strong><small>5–9 列导入</small></div>
              <i>${icon("arrow-right", 16)}</i>
              <div class="flow-step"><span>2</span><strong>逐行脱敏</strong><small>随机 Mapping</small></div>
              <i>${icon("arrow-right", 16)}</i>
              <div class="flow-step"><span>3</span><strong>双文件导出</strong><small>工单 + Mapping</small></div>
            </div>
          </section>

          <section class="admin-workspace">
            <div class="workspace-column input-column">
              <article class="panel-card input-panel">
                <div class="panel-heading">
                  <div>
                    <span class="step-kicker">01 · 输入与校验</span>
                    <h2>原始结果表</h2>
                    <p>推荐上传 CSV；也支持从 Excel 复制粘贴。前 3 列固定，后接 2–6 个连续的模型 URL。</p>
                  </div>
                  <div class="panel-actions">
                    <a class="button button-ghost" href="templates/SonicBench-flexible-2-6-model-admin-import-template.xlsx" download>
                      ${icon("file-spreadsheet", 17)} Excel 模板
                    </a>
                    <label class="button button-ghost file-button">
                      ${icon("file-up", 17)} 上传 CSV
                      <input id="raw-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" hidden>
                    </label>
                    <label class="sample-model-control" for="sample-model-count"><span>样例模型数</span><select id="sample-model-count" aria-label="样例模型数">${Array.from({ length: MAX_MODEL_COUNT - MIN_MODEL_COUNT + 1 }, (_, offset) => { const count = MIN_MODEL_COUNT + offset; return `<option value="${count}" ${count === MAX_MODEL_COUNT ? "selected" : ""}>${count} 个模型</option>`; }).join("")}</select></label>
                    <button class="button button-ghost" id="load-sample" type="button">${icon("flask-conical", 17)} 加载样例</button>
                  </div>
                </div>

                <div class="schema-strip" aria-label="输入列定义">
                  <span>case_id</span><span>tag</span><span>lyrics</span><span class="schema-multi">2–6 × model_url</span>
                </div>

                <label class="field-label" for="raw-input">粘贴 Excel 行或 CSV 内容</label>
                <textarea id="raw-input" class="raw-textarea mono-text" spellcheck="false" placeholder="case_id,tag,lyrics,model_1_url,model_2_url,...,model_6_url">${h(state.rawText)}</textarea>

                <div class="input-meta">
                  <span id="parse-count">${validCount} 个数据行</span>
                  <span id="parse-format">${state.rawText.trim() ? `${inspection.delimiter === "," ? "CSV" : "Excel / TSV"} · ${inspection.hasHeader ? "已识别表头" : "未识别表头，将按固定列序解析"}` : "等待输入"}</span>
                </div>

                <div class="input-preview" id="input-preview">${renderInputPreview()}</div>

                <button class="button button-primary button-generate" id="generate-order" type="button" ${!state.rawText.trim() || hasOutput ? "disabled" : ""}>
                  ${hasOutput ? `${icon("lock", 18)} 当前 Mapping 已冻结` : `${icon("shuffle", 18)} 校验并生成脱敏工单`}
                </button>
              </article>

              <div id="validation-region">${renderErrors()}${renderWarnings()}</div>
            </div>

            <div class="workspace-column output-column">
              <article class="panel-card output-panel">
                <div class="panel-heading">
                  <div>
                    <span class="step-kicker">02 · 输出与交付</span>
                    <h2>脱敏工单</h2>
                    <p>${hasOutput ? `${workOrderHeaders(state.modelCount).length} 列动态工单：` : "动态列数："}每个 Case 派生 n 个 MOS 与 C(n,2) 个完整 ELO 对战；顺序和左右位独立随机。</p>
                  </div>
                  <span id="output-status">${hasOutput ? statusPill("success", `${icon("check", 14)} 可交付`) : statusPill("neutral", "尚未生成")}</span>
                </div>

                <div class="task-formula">
                  <div><strong>${hasOutput ? state.modelCount : "n"}</strong><span>MOS<br>每个候选一项</span></div>
                  <span class="formula-plus">+</span>
                  <div><strong>${hasOutput ? eloMatchCount(state.modelCount) : "C(n,2)"}</strong><span>ELO 对战<br>组合全集 · 顺序与左右位随机</span></div>
                  <span class="formula-equals">=</span>
                  <div class="formula-total"><strong>${hasOutput ? totalSubtaskCount(state.modelCount) : "动态"}</strong><span>子任务 / Case</span></div>
                </div>

                <div class="generated-preview">${renderGeneratedPreview()}</div>

                <div class="export-grid">
                  <button class="export-card" id="copy-work-order" type="button" ${hasOutput ? "" : "disabled"}>
                    <span class="export-icon violet">${icon("copy", 19)}</span>
                    <span><strong>复制完整工单</strong><small>${hasOutput ? `含 ${workOrderHeaders(state.modelCount).length} 列表头` : "动态列数"}，可粘贴到 Excel</small></span>
                    ${icon("chevron-right", 17)}
                  </button>
                  <button class="export-card" id="download-work-order" type="button" ${hasOutput ? "" : "disabled"}>
                    <span class="export-icon blue">${icon("file-spreadsheet", 19)}</span>
                    <span><strong>下载 CSV 工单</strong><small>UTF-8 编码，${state.generatedRows.length || 0} 个 Case</small></span>
                    ${icon("download", 17)}
                  </button>
                  <button class="export-card" id="copy-first-row" type="button" ${hasOutput ? "" : "disabled"}>
                    <span class="export-icon teal">${icon("clipboard", 19)}</span>
                    <span><strong>复制首条任务行</strong><small>直接粘贴到评测任务卡</small></span>
                    ${icon("chevron-right", 17)}
                  </button>
                </div>
              </article>

              <article class="mapping-vault ${hasOutput ? "vault-ready" : ""}">
                <div class="vault-icon">${icon("lock-keyhole", 22)}</div>
                <div class="vault-copy">
                  <div class="vault-title-row">
                    <h2>管理员 Mapping</h2>
                    ${hasOutput ? statusPill("private", "仅内存") : ""}
                  </div>
                  <p>保存真实模型、URL、Blind ID 与候选位置的映射。页面刷新后不可恢复，请生成后立即下载并限制访问。</p>
                  <div class="vault-meta">
                    <span>${mappingCount} 条映射</span>
                    <span>不写入 localStorage</span>
                    <span>不进入标注工单</span>
                  </div>
                </div>
                <button class="button button-dark" id="download-mapping" type="button" ${hasOutput ? "" : "disabled"}>
                  ${icon("download", 17)} 下载 Mapping JSON
                </button>
              </article>
            </div>
          </section>
        </main>
      </div>
    `;

    bindEvents();
  }

  function updateInputInspection() {
    state.inspection = inspectRaw(state.rawText);
    const count = document.getElementById("parse-count");
    const format = document.getElementById("parse-format");
    const preview = document.getElementById("input-preview");
    const validation = document.getElementById("validation-region");
    const generate = document.getElementById("generate-order");
    if (count) count.textContent = `${state.inspection.records.length} 个数据行`;
    if (format) {
      format.textContent = state.rawText.trim()
        ? `${state.inspection.delimiter === "," ? "CSV" : "Excel / TSV"} · ${state.inspection.hasHeader ? "已识别表头" : "未识别表头，将按固定列序解析"}`
        : "等待输入";
    }
    if (preview) preview.innerHTML = renderInputPreview();
    if (validation) validation.innerHTML = `${renderErrors()}${renderWarnings()}`;
    if (generate) {
      generate.disabled = !state.rawText.trim() || Boolean(state.mapping);
      if (!state.mapping) generate.innerHTML = `${icon("shuffle", 18)} 校验并生成脱敏工单`;
    }
    if (!state.mapping) invalidateOutputView();
  }

  function invalidateOutputView() {
    const preview = document.querySelector(".generated-preview");
    if (preview) preview.innerHTML = renderGeneratedPreview();
    ["copy-work-order", "download-work-order", "copy-first-row", "download-mapping"].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.disabled = true;
    });
    const vault = document.querySelector(".mapping-vault");
    if (vault) vault.classList.remove("vault-ready");
    const outputStatus = document.getElementById("output-status");
    if (outputStatus) outputStatus.innerHTML = statusPill("neutral", "输入已变更，请重新生成");
    const vaultStatus = document.querySelector(".vault-title-row .status-pill");
    if (vaultStatus) vaultStatus.remove();
    const vaultMeta = document.querySelector(".vault-meta");
    if (vaultMeta) {
      vaultMeta.innerHTML = "<span>0 条映射</span><span>不写入 localStorage</span><span>不进入标注工单</span>";
    }
  }

  function loadRawText(value, message) {
    state.rawText = String(value || "");
    state.generatedRows = [];
    state.generatedLines = [];
    state.workOrderTsv = "";
    state.workOrderCsv = "";
    state.mapping = null;
    state.generatedSourceHash = "";
    render();
    const input = document.getElementById("raw-input");
    if (input) input.focus();
    if (message) notify(message, "success");
  }

  function bindEvents() {
    const rawInput = document.getElementById("raw-input");
    const fileInput = document.getElementById("raw-file");
    const loadSample = document.getElementById("load-sample");
    const sampleModelCount = document.getElementById("sample-model-count");
    const generate = document.getElementById("generate-order");
    const copyAll = document.getElementById("copy-work-order");
    const downloadOrder = document.getElementById("download-work-order");
    const copyFirst = document.getElementById("copy-first-row");
    const downloadMapping = document.getElementById("download-mapping");

    if (rawInput) {
      rawInput.addEventListener("input", (event) => {
        state.rawText = event.target.value;
        state.generatedRows = [];
        state.generatedLines = [];
        state.workOrderTsv = "";
        state.workOrderCsv = "";
        state.mapping = null;
        state.generatedSourceHash = "";
        updateInputInspection();
      });
    }

    if (fileInput) {
      fileInput.addEventListener("change", async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        try {
          loadRawText(await file.text(), `已载入 ${file.name}`);
        } catch (error) {
          notify("文件读取失败，请改用复制粘贴", "error");
        }
      });
    }

    if (loadSample) {
      loadSample.addEventListener("click", () => {
        const requested = Math.min(MAX_MODEL_COUNT, Math.max(MIN_MODEL_COUNT, Number(sampleModelCount && sampleModelCount.value) || MAX_MODEL_COUNT));
        const sampleRows = (DATA.RAW_SAMPLE_ROWS || DATA.RAW_SAMPLE_TSV).map((row) => row.slice(0, 3 + requested));
        loadRawText(U.serializeCSV(sampleRows), `已加载 ${sampleRows.length - 1} 条、${requested} 模型 CSV 演示数据`);
      });
    }

    if (generate) generate.addEventListener("click", generateWorkOrder);

    if (copyAll) {
      copyAll.addEventListener("click", () => {
        if (!state.workOrderTsv) return;
        U.copyText(state.workOrderTsv)
          .then(() => notify("完整工单已复制，可直接粘贴到 Excel", "success"))
          .catch(() => notify("复制失败，请下载 CSV 文件", "error"));
      });
    }

    if (downloadOrder) {
      downloadOrder.addEventListener("click", () => {
        if (!state.workOrderCsv) return;
        U.downloadText(
          `${U.fileSafe(state.batchId)}-work-order.csv`,
          `\uFEFF${state.workOrderCsv}`,
          "text/csv;charset=utf-8"
        );
        notify("脱敏工单已下载", "success");
      });
    }

    if (copyFirst) {
      copyFirst.addEventListener("click", () => {
        if (!state.generatedLines.length) return;
        U.copyText(state.generatedLines[0])
          .then(() => notify("首条任务行已复制，去评测任务卡粘贴即可", "success"))
          .catch(() => notify("复制失败，请重试", "error"));
      });
    }

    if (downloadMapping) {
      downloadMapping.addEventListener("click", () => {
        if (!state.mapping) return;
        U.downloadText(
          `${U.fileSafe(state.batchId)}-ADMIN-MAPPING.json`,
          JSON.stringify(state.mapping, null, 2),
          "application/json;charset=utf-8"
        );
        notify("管理员 Mapping 已下载，请存放在受控目录", "success");
      });
    }
  }

  render();
})();
