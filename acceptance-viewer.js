(function () {
  "use strict";
  const Core = window.SonicBenchAcceptanceViewer, D = window.SB_SHARED_DATA;
  const $ = (id) => document.getElementById(id), h = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const el = { inputPanel: $("input-panel"), mapping: $("mapping-input"), mappingFile: $("mapping-file"), mappingStatus: $("mapping-status"), result: $("result-input"), resultFile: $("result-file"), load: $("load-result"), clear: $("clear-view"), next: $("next-result"), error: $("input-error"), view: $("result-view"), summary: $("result-summary"), mosCount: $("mos-count"), mosList: $("mos-list"), eloCount: $("elo-count"), eloList: $("elo-list") };
  const STORAGE_KEY = "sonicbench_acceptance_mapping_v1";
  function readFile(input, target, after) { const file = input.files && input.files[0]; if (!file) return; file.text().then((value) => { target.value = value; if (after) after(value); }).catch((error) => showError(`无法读取 ${file.name}：${error.message}`)); }
  function showError(value) { el.error.hidden = !value; el.error.textContent = value || ""; }
  function list(value) { return Array.isArray(value) && value.length ? value.join("、") : "—"; }
  function note(value) { return String(value || "").trim() || "—"; }
  function score(value) { const number = Number(value); return Number.isFinite(number) ? number : "—"; }
  function outcome(value) { return ({ left: "左胜", right: "右胜", draw: "平" })[value] || "—"; }
  function model(model) { return `<strong>${h(model.label)}</strong><small>${h(model.key)}${model.source_column && model.source_column !== model.key ? ` · ${h(model.source_column)}` : ""}</small>`; }
  function render(view) {
    el.inputPanel.hidden = true; el.view.hidden = false; el.summary.textContent = `${view.mos.length} 个 MOS 子任务 · ${view.elo.length} 场 ELO 对战`; el.mosCount.textContent = `${view.mos.length} 个模型`; el.eloCount.textContent = `${view.elo.length} 场`;
    el.mosList.innerHTML = view.mos.map((item) => `<article class="mos-card"><div class="model-heading"><span>${h(item.subtask_id)}</span><div>${model(item.model)}</div></div><div class="score-table"><div class="score-head"><span>维度</span><span>评分</span><span>低分问题 / 备注</span></div>${view.mos_dimensions.map((dimension) => { const issueText = list(item.low_score_issues[dimension.key]); const noteText = note(item.notes[dimension.key]); const extra = dimension.key === "instruction_following" ? `<div><b>未遵循项</b>${h(list(item.instruction_deductions))}</div><div><b>原因备注</b>${h(note(item.instruction_note))}</div>` : `<div><b>低分问题</b>${h(issueText)}</div><div><b>备注</b>${h(noteText)}</div>`; return `<div class="score-row"><strong>${h(dimension.label)}</strong><em>${h(score(item.scores[dimension.key]))}</em><div class="feedback">${extra}</div></div>`; }).join("")}</div></article>`).join("");
    el.eloList.innerHTML = view.elo.length ? view.elo.map((item) => `<tr><td><strong>${h(item.subtask_id)}</strong></td><td>${model(item.left)}</td><td>${model(item.right)}</td>${view.elo_dimensions.map((dimension) => `<td><span class="outcome ${h(item.dimension_results[dimension.key])}">${h(outcome(item.dimension_results[dimension.key]))}</span></td>`).join("")}<td class="elo-note">${h(note(item.note))}</td></tr>`).join("") : `<tr><td colspan="8">这条结果没有 ELO 对战数据。</td></tr>`;
    el.view.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function load() { showError(""); try { const view = Core.buildView(el.mapping.value, el.result.value); localStorage.setItem(STORAGE_KEY, el.mapping.value); el.mappingStatus.textContent = "Mapping 已载入并缓存到本机"; render(view); } catch (error) { el.view.hidden = true; showError(error.message || String(error)); } }
  el.mappingFile.addEventListener("change", () => readFile(el.mappingFile, el.mapping, (value) => { try { Core.parseMapping(value); localStorage.setItem(STORAGE_KEY, value); el.mappingStatus.textContent = "Mapping 已载入并缓存到本机"; showError(""); } catch (error) { showError(error.message); } }));
  function resetResult() { el.result.value = ""; el.view.hidden = true; el.inputPanel.hidden = false; showError(""); el.result.focus(); }
  el.resultFile.addEventListener("change", () => readFile(el.resultFile, el.result)); el.load.addEventListener("click", load); el.clear.addEventListener("click", resetResult); el.next.addEventListener("click", resetResult);
  const cached = localStorage.getItem(STORAGE_KEY); if (cached) { el.mapping.value = cached; el.mappingStatus.textContent = "已读取本机缓存的 Mapping"; }
})();
