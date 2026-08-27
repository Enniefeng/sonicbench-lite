(function () {
  const D = window.SB_SHARED_DATA || {};
  const U = window.SB_UTILS || {};
  const UI = window.SB_UI || {};
  const root = document.getElementById("comparison-app");
  if (!root) return;
  const audioDock = document.getElementById("comparison-audio-dock");

  const dimensions = Array.isArray(D.MOS_DIMENSIONS) ? D.MOS_DIMENSIONS : [];
  const eloDimensions = Array.isArray(D.ELO_DIMENSIONS) ? D.ELO_DIMENSIONS : [];
  const groups = Array.isArray(D.MOS_GROUPS) ? D.MOS_GROUPS : [];
  const h = UI.escapeHtml || ((value) => String(value == null ? "" : value));
  const icon = UI.icon || (() => "");
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const RESULT_CELL_CHAR_LIMIT = Number(D.RESULT_CELL_CHAR_LIMIT) || 50000;
  const state = { screen: "import", referenceText: "", candidateText: "", reference: null, original: null, editable: null, tolerance: 2, errors: [], warnings: [], selectedBlindId: "", filter: "all", expanded: new Set(), initial: null };

  function toast(message, type) { if (UI.toast) UI.toast(message, type); }
  function groupFor(key) {
    for (const group of groups) {
      if (group.subdimensions.concat(group.overall).some((item) => item.key === key)) return group.label;
    }
    if (key === "instruction_following") return "指令遵循";
    return "总体";
  }
  function scoreOf(mos, key) { const value = Number(mos && mos.scores && mos.scores[key]); return Number.isFinite(value) ? value : null; }
  function mosMap(annotation) { return new Map((annotation.mos || []).map((item) => [item.blind_id, item])); }
  function eloMap(annotation) { return new Map((annotation.elo_matches || []).map((item) => [item.subtask_id, item])); }
  function candidates(annotation) {
    const list = annotation && annotation.work_order && Array.isArray(annotation.work_order.candidates) ? annotation.work_order.candidates : [];
    if (list.length) return list.map((item, index) => ({ blind_id: item.blind_id || item.id, url: item.url || "", slot: item.slot || index + 1 }));
    return (annotation.mos || []).map((item, index) => ({ blind_id: item.blind_id, url: "", slot: index + 1 }));
  }
  function renderAudioPanel(candidateList) {
    const items = candidateList.map((candidate, index) => {
      const rawUrl = U.normalizeHttpUrl ? U.normalizeHttpUrl(candidate.url) : String(candidate.url || "").trim();
      const playable = U.isHttpUrl ? U.isHttpUrl(rawUrl) : /^https?:\/\//i.test(rawUrl);
      return `<article class="comparison-audio-item"><div class="comparison-audio-meta"><span>候选 ${String(index + 1).padStart(2, "0")}</span><strong>${h(candidate.blind_id)}</strong></div>${playable ? `<audio class="comparison-audio-player" controls preload="metadata" src="${h(rawUrl)}" aria-label="候选 ${index + 1} 音频"></audio>` : `<div class="comparison-audio-unavailable">未找到有效的 HTTP(S) 音频 URL</div>`}</article>`;
    }).join("");
    return `<section class="comparison-card comparison-audio-section" data-export-exclude="true"><div class="section-title"><div><h2>Case 音频试听</h2><p>试听当前 Case 的匿名候选音频；开始播放另一条时，上一条会自动暂停并保留位置。</p></div><span class="export-exclusion-note">${icon("eye", 13)} 不进入对比长图</span></div><div class="comparison-audio-grid">${items}</div></section>`;
  }
  function candidateSignature(candidateList) {
    return JSON.stringify(candidateList.map((candidate) => [candidate.blind_id, U.normalizeHttpUrl ? U.normalizeHttpUrl(candidate.url) : String(candidate.url || "").trim()]));
  }
  function parkAudioDock(reset) {
    if (!audioDock) return;
    if (audioDock.parentNode !== document.body) document.body.insertBefore(audioDock, root);
    if (!reset) return;
    audioDock.querySelectorAll("audio").forEach((audio) => audio.pause());
    audioDock.innerHTML = "";
    audioDock.hidden = true;
    delete audioDock.dataset.signature;
  }
  function mountAudioDock(candidateList) {
    if (!audioDock) return false;
    const signature = candidateSignature(candidateList);
    if (audioDock.dataset.signature !== signature) {
      audioDock.innerHTML = renderAudioPanel(candidateList);
      audioDock.dataset.signature = signature;
    }
    audioDock.hidden = false;
    const anchor = root.querySelector("[data-audio-dock-anchor]");
    if (anchor) anchor.replaceWith(audioDock);
    return true;
  }
  function parseJson(text, label) {
    const parsed = U.safeJsonParse ? U.safeJsonParse(text) : (() => { try { return { value: JSON.parse(text), error: null }; } catch (error) { return { value: null, error }; } })();
    if (parsed.error || !parsed.value || typeof parsed.value !== "object") return { error: `${label}不是有效 JSON` };
    (parsed.value.mos || []).forEach((item) => { item.instruction_deductions = D.normalizeInstructionDeductions ? D.normalizeInstructionDeductions(item.instruction_deductions) : (item.instruction_deductions || []); });
    return { value: parsed.value };
  }
  function validateAnnotation(value, label) {
    const errors = [];
    if (!Array.isArray(value.mos) || !value.mos.length) errors.push(`${label}缺少 MOS 结果`);
    if (!Array.isArray(value.elo_matches)) errors.push(`${label}缺少 ELO 结果`);
    if (!value.work_order || !Array.isArray(value.work_order.candidates)) errors.push(`${label}必须是包含 work_order 的自包含结果 JSON`);
    const seenCandidates = new Set();
    candidates(value).forEach((candidate, index) => {
      if (!candidate.blind_id) errors.push(`${label}候选 ${index + 1} 缺少匿名音频 ID`);
      else if (seenCandidates.has(candidate.blind_id)) errors.push(`${label}匿名音频 ID ${candidate.blind_id} 重复`);
      seenCandidates.add(candidate.blind_id);
      if (!(U.isHttpUrl ? U.isHttpUrl(candidate.url) : /^https?:\/\//i.test(String(candidate.url || "").trim()))) errors.push(`${label} ${candidate.blind_id || `候选 ${index + 1}`} 的音频 URL 无效`);
    });
    (value.mos || []).forEach((item) => dimensions.forEach((dimension) => {
      const score = scoreOf(item, dimension.key);
      if (!Number.isInteger(score) || score < 1 || score > 5) errors.push(`${label} ${item.subtask_id || item.blind_id} 的${dimension.label}评分无效`);
    }));
    return errors;
  }
  function validatePair(reference, candidate) {
    const errors = validateAnnotation(reference, "参考答案").concat(validateAnnotation(candidate, "标注结果"));
    ["batch_id", "task_bundle_id", "case_id"].forEach((key) => {
      if (String(reference[key] || "") !== String(candidate[key] || "")) errors.push(`${key} 不一致，不能对比不同工单`);
    });
    const referenceIdentity = U.taskIdentityFingerprint ? U.taskIdentityFingerprint(reference) : "";
    const candidateIdentity = U.taskIdentityFingerprint ? U.taskIdentityFingerprint(candidate) : "";
    if (referenceIdentity && candidateIdentity && referenceIdentity !== candidateIdentity) errors.push("任务身份不一致，不能对比不同 Case 或候选音频");
    if ((reference.model_count != null || candidate.model_count != null) && Number(reference.model_count) !== Number(candidate.model_count)) errors.push("model_count 不一致，不能对比不同数量的候选音频");
    const refCandidates = new Map(candidates(reference).map((item) => [item.blind_id, item]));
    const candidateCandidates = new Map(candidates(candidate).map((item) => [item.blind_id, item]));
    refCandidates.forEach((refItem, blindId) => {
      const candidateItem = candidateCandidates.get(blindId);
      if (!candidateItem) return;
      const refUrl = U.normalizeHttpUrl ? U.normalizeHttpUrl(refItem.url) : String(refItem.url || "").trim();
      const candidateUrl = U.normalizeHttpUrl ? U.normalizeHttpUrl(candidateItem.url) : String(candidateItem.url || "").trim();
      if (refUrl !== candidateUrl) errors.push(`${blindId} 的音频 URL 不一致`);
    });
    const refMos = mosMap(reference); const candMos = mosMap(candidate);
    if (refMos.size !== candMos.size) errors.push("候选音频数量不一致");
    refMos.forEach((value, key) => { if (!candMos.has(key)) errors.push(`标注结果缺少匿名音频 ${key}`); });
    refMos.forEach((value, key) => { const target=candMos.get(key); if(target && value.subtask_id!==target.subtask_id) errors.push(`${key} 的 MOS 子任务 ID 不一致`); });
    const refElo = eloMap(reference); const candElo = eloMap(candidate);
    if (refElo.size !== candElo.size) errors.push("ELO 对战数量不一致");
    refElo.forEach((match, key) => {
      const target = candElo.get(key);
      if (!target) errors.push(`标注结果缺少 ${key}`);
      else if (match.left_blind_id !== target.left_blind_id || match.right_blind_id !== target.right_blind_id) errors.push(`${key} 的左右音频不一致`);
    });
    return Array.from(new Set(errors));
  }
  function optionalContextWarnings(reference, candidate) {
    const warnings = [];
    ["tag", "caption", "lyrics", "sp", "spp"].forEach((key) => {
      const refValue = String(reference.work_order && reference.work_order[key] || "").trim();
      const candidateValue = String(candidate.work_order && candidate.work_order[key] || "").trim();
      if (refValue && candidateValue && refValue !== candidateValue) warnings.push(`Case 的 ${key} 内容不同；继续对比但不自动覆盖`);
      else if (!refValue && !candidateValue && (key === "tag" || key === "lyrics")) warnings.push(`两份结果均未提供 ${key}，仍可继续对比`);
      else if (!refValue || !candidateValue) warnings.push(`${key} 仅一侧提供，导出时将自动补齐`);
    });
    return warnings;
  }
  function mergeOptionalContext(primary, fallback) {
    const output = clone(primary);
    output.work_order = output.work_order && typeof output.work_order === "object" ? output.work_order : {};
    const source = fallback && fallback.work_order || {};
    ["tag", "caption", "lyrics", "sp", "spp"].forEach((key) => {
      if (!String(output.work_order[key] || "").trim() && String(source[key] || "").trim()) output.work_order[key] = source[key];
    });
    if (!("tag" in output.work_order)) output.work_order.tag = "";
    if (!("lyrics" in output.work_order)) output.work_order.lyrics = "";
    if (U.taskIdentityFingerprint) output.task_identity_fingerprint = U.taskIdentityFingerprint(output);
    return output;
  }
  function compare(reference, candidate, tolerance) {
    const refMos = mosMap(reference); const candMos = mosMap(candidate); const mosRows = [];
    refMos.forEach((refItem, blindId) => {
      const candidateItem = candMos.get(blindId);
      if (!candidateItem) return;
      dimensions.forEach((dimension) => {
        const referenceScore = scoreOf(refItem, dimension.key); const candidateScore = scoreOf(candidateItem, dimension.key);
        const delta = candidateScore - referenceScore; const absoluteDelta = Math.abs(delta);
        mosRows.push({ blindId, subtaskId: candidateItem.subtask_id, dimension, referenceScore, candidateScore, delta, absoluteDelta, status: absoluteDelta === 0 ? "exact" : absoluteDelta <= tolerance ? "acceptable" : "outlier", referenceItem: refItem, candidateItem });
      });
    });
    const refElo = eloMap(reference); const candElo = eloMap(candidate); const eloRows = [];
    refElo.forEach((refMatch, matchId) => {
      const candidateMatch = candElo.get(matchId); if (!candidateMatch) return;
      eloDimensions.forEach((dimension) => {
        const referenceOutcome = refMatch.dimension_results && refMatch.dimension_results[dimension.key];
        const candidateOutcome = candidateMatch.dimension_results && candidateMatch.dimension_results[dimension.key];
        eloRows.push({ matchId, dimension, referenceOutcome, candidateOutcome, same: referenceOutcome === candidateOutcome, refMatch, candidateMatch });
      });
    });
    return { mosRows, eloRows, metrics: { total: mosRows.length, exact: mosRows.filter((row) => row.status === "exact").length, acceptable: mosRows.filter((row) => row.status === "acceptable").length, outliers: mosRows.filter((row) => row.status === "outlier").length, eloSame: eloRows.filter((row) => row.same).length, eloTotal: eloRows.length } };
  }
  function valueEqual(a, b) { return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b); }
  function appendChange(list, meta, before, after) { if (!valueEqual(before, after)) list.push(Object.assign({}, meta, { before: clone(before), after: clone(after) })); }
  function collectChanges(original, edited) {
    const changes = []; const beforeMos = mosMap(original); const afterMos = mosMap(edited);
    afterMos.forEach((after, blindId) => {
      const before = beforeMos.get(blindId) || {};
      dimensions.forEach((dimension) => appendChange(changes, { scope: "mos", subtask_id: after.subtask_id, blind_id: blindId, dimension_key: dimension.key, dimension_label: dimension.label, field_path: `scores.${dimension.key}`, field_label: `${dimension.label}评分` }, scoreOf(before, dimension.key), scoreOf(after, dimension.key)));
      appendChange(changes, { scope: "mos", subtask_id: after.subtask_id, blind_id: blindId, field_path: "low_score_issues", field_label: "低分问题" }, before.low_score_issues || {}, after.low_score_issues || {});
      appendChange(changes, { scope: "mos", subtask_id: after.subtask_id, blind_id: blindId, field_path: "notes", field_label: "MOS 备注" }, before.notes || {}, after.notes || {});
      appendChange(changes, { scope: "mos", subtask_id: after.subtask_id, blind_id: blindId, field_path: "instruction_deductions", field_label: "指令扣分项" }, before.instruction_deductions || [], after.instruction_deductions || []);
      appendChange(changes, { scope: "mos", subtask_id: after.subtask_id, blind_id: blindId, field_path: "instruction_note", field_label: "指令扣分原因" }, before.instruction_note || "", after.instruction_note || "");
    });
    const beforeElo = eloMap(original); eloMap(edited).forEach((after, matchId) => {
      const before = beforeElo.get(matchId) || {};
      eloDimensions.forEach((dimension) => appendChange(changes, { scope: "elo", subtask_id: matchId, dimension_key: dimension.key, dimension_label: dimension.label, field_path: `dimension_results.${dimension.key}`, field_label: `${dimension.label}结果` }, before.dimension_results && before.dimension_results[dimension.key], after.dimension_results && after.dimension_results[dimension.key]));
      appendChange(changes, { scope: "elo", subtask_id: matchId, field_path: "note", field_label: "本场共用备注" }, before.note || "", after.note || "");
    });
    return changes;
  }
  function buildCorrectedResult() {
    const changes = collectChanges(state.original, state.editable);
    if (!changes.length) return mergeOptionalContext(state.original, state.reference);
    const output = mergeOptionalContext(state.editable, state.reference); const now = U.nowISO ? U.nowISO() : new Date().toISOString();
    const previousRevision = Number(state.original.result_revision) || 1; const revision = previousRevision + 1;
    const history = Array.isArray(state.original.revision_history) ? clone(state.original.revision_history) : [];
    if (!history.length) history.push({ revision: previousRevision, updated_at: state.original.updated_at || state.original.completed_at || null, remark: state.original.revision_remark || "历史版本（无字段级明细）", changes: [] });
    const names = changes.slice(0, 5).map((item) => `${item.subtask_id} · ${item.field_label}`);
    const remark = `管理员参考答案复核修订：${names.join("；")}${changes.length > names.length ? `；另有 ${changes.length - names.length} 处修改` : ""}`;
    history.push({ revision, updated_at: now, remark, changes: clone(changes) });
    const current = compare(state.reference, output, state.tolerance);
    output.result_revision = revision; output.updated_at = now; output.revision_remark = remark; output.revision_history = history;
    output.admin_quality_review = { reviewed_at: now, reference_result_revision: Number(state.reference.result_revision) || null, reference_work_order_fingerprint: state.reference.work_order_fingerprint, mos_tolerance: state.tolerance, mos_outlier_count_before: state.initial.metrics.outliers, mos_outlier_count_after: current.metrics.outliers, elo_difference_count_before: state.initial.metrics.eloTotal - state.initial.metrics.eloSame, elo_difference_count_after: current.metrics.eloTotal - current.metrics.eloSame, policy_note: "MOS 按容差辅助判断；ELO 差异仅供人工复核，不自动判退。" };
    return output;
  }
  function buildRefinedResult() {
    if (typeof D.finalSnapshotResult !== "function") throw new Error("缺少精简结果生成能力");
    return D.finalSnapshotResult(buildCorrectedResult());
  }
  function buildResultExportBundle() {
    const fullResult = buildCorrectedResult();
    const refinedResult = D.finalSnapshotResult(fullResult);
    const fullText = JSON.stringify(fullResult);
    const refinedText = JSON.stringify(refinedResult);
    const preferFull = fullText.length <= RESULT_CELL_CHAR_LIMIT;
    return { fullResult, refinedResult, fullText, refinedText, preferFull, preferredResult: preferFull ? fullResult : refinedResult, preferredText: preferFull ? fullText : refinedText };
  }
  function exportTimestamp() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }
  function buildReport() {
    const current = compare(state.reference, state.editable, state.tolerance); const changes = collectChanges(state.original, state.editable);
    return { schema_version: "sonicbench-admin-comparison/1.0", generated_at: U.nowISO ? U.nowISO() : new Date().toISOString(), batch_id: state.editable.batch_id, task_bundle_id: state.editable.task_bundle_id, case_id: state.editable.case_id, work_order_fingerprint: state.editable.work_order_fingerprint, mos_tolerance: state.tolerance, recommendation: current.metrics.outliers ? "manual_review" : "pass_suggested", metrics: current.metrics, mos_outliers: current.mosRows.filter((row) => row.status === "outlier").map((row) => ({ blind_id: row.blindId, subtask_id: row.subtaskId, dimension_key: row.dimension.key, dimension_label: row.dimension.label, reference_score: row.referenceScore, annotator_score: row.candidateScore, delta: row.delta })), elo_differences: current.eloRows.filter((row) => !row.same).map((row) => ({ subtask_id: row.matchId, dimension_key: row.dimension.key, dimension_label: row.dimension.label, reference_outcome: row.referenceOutcome, annotator_outcome: row.candidateOutcome })), admin_edits: changes };
  }
  function ellipsisText(ctx, value, maxWidth) {
    const text=String(value==null?"":value); if(ctx.measureText(text).width<=maxWidth)return text;
    let output=text; while(output.length>1&&ctx.measureText(`${output}…`).width>maxWidth)output=output.slice(0,-1);
    return `${output}…`;
  }
  function downloadBlob(filename, blob) {
    const url=URL.createObjectURL(blob); const anchor=document.createElement("a"); anchor.href=url; anchor.download=filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function downloadComparisonImage() {
    const result=compare(state.reference,state.editable,state.tolerance); const candidateList=candidates(state.editable);
    const mosRowHeight=54; const eloRowHeight=40; const matchIds=Array.from(new Set(result.eloRows.map((row)=>row.matchId)));
    const logicalWidth=1600; const logicalHeight=330+candidateList.length*42+result.mosRows.length*mosRowHeight+90+result.eloRows.length*eloRowHeight+matchIds.length*42+130;
    const scale=Math.min(1.5,Math.max(1,window.devicePixelRatio||1)); const canvas=document.createElement("canvas"); canvas.width=Math.round(logicalWidth*scale); canvas.height=Math.round(logicalHeight*scale);
    const ctx=canvas.getContext("2d"); if(!ctx) return Promise.reject(new Error("当前浏览器无法生成图片")); ctx.scale(scale,scale);
    const colors={ink:"#211b2d",muted:"#756e80",line:"#e5e0ea",violet:"#7054dc",violetSoft:"#f3efff",green:"#177455",greenSoft:"#eef9f4",red:"#a23d43",redSoft:"#fff1f2",blue:"#326a9c",blueSoft:"#eef4fb",white:"#ffffff",panel:"#f8f7fa"};
    ctx.fillStyle="#f7f5fb";ctx.fillRect(0,0,logicalWidth,logicalHeight); let y=34;
    ctx.fillStyle=colors.ink;ctx.font="800 34px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";ctx.fillText("SonicBench 验收对比报告",40,y+34);y+=58;
    ctx.font="600 15px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";ctx.fillStyle=colors.muted;ctx.fillText(`${state.editable.case_id} · ${state.editable.task_bundle_id} · MOS 容差 ±${state.tolerance} · ${new Date().toLocaleString("zh-CN")}`,40,y+18);y+=44;
    const metricItems=[["MOS 对比项",result.metrics.total],["完全一致",result.metrics.exact],["容差内差异",result.metrics.acceptable],["超出容差",result.metrics.outliers],["ELO 一致",`${result.metrics.eloSame}/${result.metrics.eloTotal}`]];
    metricItems.forEach((item,index)=>{const x=40+index*304;ctx.fillStyle=index===3&&result.metrics.outliers?colors.redSoft:colors.white;ctx.strokeStyle=index===3&&result.metrics.outliers?"#efc4c7":colors.line;ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(x,y,284,76,12);ctx.fill();ctx.stroke();ctx.fillStyle=colors.muted;ctx.font="600 13px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";ctx.fillText(item[0],x+16,y+24);ctx.fillStyle=colors.ink;ctx.font="800 25px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";ctx.fillText(String(item[1]),x+16,y+58);});y+=100;
    ctx.fillStyle=result.metrics.outliers?colors.redSoft:colors.greenSoft;ctx.beginPath();ctx.roundRect(40,y,1520,46,10);ctx.fill();ctx.fillStyle=result.metrics.outliers?colors.red:colors.green;ctx.font="750 15px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";ctx.fillText(result.metrics.outliers?`有 ${result.metrics.outliers} 个 MOS 项需要结合问题标签与备注人工复核`:"未发现超出 MOS 容差的评分，建议通过",58,y+29);y+=72;
    ctx.fillStyle=colors.ink;ctx.font="800 22px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";ctx.fillText("MOS 分层对比",40,y+24);y+=40;
    const drawTableHeader=(labels,widths)=>{ctx.fillStyle="#ede9f3";ctx.fillRect(40,y,1520,34);ctx.fillStyle=colors.muted;ctx.font="750 12px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";let x=52;labels.forEach((label,index)=>{ctx.fillText(label,x,y+22);x+=widths[index];});y+=34;};
    candidateList.forEach((candidate,index)=>{ctx.fillStyle=colors.violetSoft;ctx.fillRect(40,y,1520,36);ctx.fillStyle=colors.violet;ctx.font="800 14px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";ctx.fillText(`候选 ${String(index+1).padStart(2,"0")} · ${candidate.blind_id}`,52,y+24);y+=36;drawTableHeader(["维度","分类","参考分","标注分","差值","辅助判断","问题与备注"],[250,230,120,120,110,150,540]);
      result.mosRows.filter((row)=>row.blindId===candidate.blind_id).forEach((row)=>{ctx.fillStyle=colors.white;ctx.fillRect(40,y,1520,mosRowHeight);ctx.strokeStyle=colors.line;ctx.beginPath();ctx.moveTo(40,y+mosRowHeight);ctx.lineTo(1560,y+mosRowHeight);ctx.stroke();const ref=evidence(row.referenceItem,row.dimension);const cand=evidence(row.candidateItem,row.dimension);const values=[row.dimension.label,groupFor(row.dimension.key),row.referenceScore,row.candidateScore,row.delta>0?`+${row.delta}`:row.delta,row.status==="exact"?"一致":row.status==="acceptable"?"容差内":"需复核"];const widths=[250,230,120,120,110,150];let x=52;ctx.font="650 13px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";values.forEach((value,column)=>{ctx.fillStyle=column===5?(row.status==="outlier"?colors.red:row.status==="acceptable"?colors.violet:colors.green):colors.ink;ctx.fillText(ellipsisText(ctx,value,widths[column]-18),x,y+22);x+=widths[column];});ctx.fillStyle=colors.muted;ctx.font="500 11px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";ctx.fillText(ellipsisText(ctx,`参：${ref.issues.join("、")||"无问题项"}${ref.note?`；${ref.note}`:""}`,520),x,y+19);ctx.fillText(ellipsisText(ctx,`标：${cand.issues.join("、")||"无问题项"}${cand.note?`；${cand.note}`:""}`,520),x,y+39);y+=mosRowHeight;});y+=18;});
    y+=10;ctx.fillStyle=colors.ink;ctx.font="800 22px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";ctx.fillText("ELO 结果对比（差异仅作提示）",40,y+24);y+=40;drawTableHeader(["对战","维度","参考答案","标注结果","提示"],[240,330,250,250,450]);
    result.eloRows.forEach((row,index)=>{ctx.fillStyle=colors.white;ctx.fillRect(40,y,1520,eloRowHeight);ctx.strokeStyle=colors.line;ctx.beginPath();ctx.moveTo(40,y+eloRowHeight);ctx.lineTo(1560,y+eloRowHeight);ctx.stroke();const values=[row.matchId,row.dimension.label,outcomeLabel(row.referenceOutcome),outcomeLabel(row.candidateOutcome),row.same?"一致":"差异 · 仅提示"];const widths=[240,330,250,250,450];let x=52;ctx.font="650 13px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";values.forEach((value,column)=>{ctx.fillStyle=column===4?(row.same?colors.green:colors.blue):colors.ink;ctx.fillText(ellipsisText(ctx,value,widths[column]-18),x,y+25);x+=widths[column];});y+=eloRowHeight;const next=result.eloRows[index+1];if(!next||next.matchId!==row.matchId){ctx.fillStyle=colors.panel;ctx.fillRect(40,y,1520,42);ctx.fillStyle=colors.muted;ctx.font="500 11px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";ctx.fillText(ellipsisText(ctx,`本场备注｜参考：${row.refMatch.note||"无"}　标注：${row.candidateMatch.note||"无"}`,1490),52,y+26);y+=42;}});
    y+=28;ctx.fillStyle=colors.muted;ctx.font="500 11px -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";ctx.fillText("说明：MOS 容差为验收辅助规则；ELO 差异不会自动判退。图片不包含真实模型 Mapping。",40,y+20);
    return new Promise((resolve,reject)=>canvas.toBlob((blob)=>{if(!blob)return reject(new Error("图片生成失败"));downloadBlob(`comparison-${U.fileSafe(state.editable.case_id)}.png`,blob);resolve();},"image/png"));
  }
  function outcomeLabel(value) { return value === "left" ? "A 胜" : value === "right" ? "B 胜" : value === "draw" ? "平局" : "未填写"; }
  function evidence(item, dimension) {
    if (dimension.key === "instruction_following") return { issues: item.instruction_deductions || [], note: item.instruction_note || "" };
    return { issues: item.low_score_issues && item.low_score_issues[dimension.key] || [], note: item.notes && item.notes[dimension.key] || "" };
  }
  function header() {
    return `<header class="admin-topbar"><a class="brand-lockup" href="admin-console.html"><span class="brand-mark">${icon("shield",22)}</span><span><strong>SonicBench</strong><small>Admin Center</small></span></a><div class="topbar-context"><span class="context-dot"></span><span>管理员专用 · 请受控分发</span></div><nav class="topbar-actions"><a class="button button-ghost" href="admin.html">${icon("shuffle",15)} 工单生成</a><a class="button button-ghost" href="aggregation.html">${icon("table",15)} 结果回算</a></nav></header>`;
  }
  function suiteNav() { return `<nav class="admin-suite-nav" aria-label="管理员工具"><a class="suite-link is-current" href="admin-console.html">${icon("eye",14)} 参考答案对比</a><a class="suite-link" href="admin.html">${icon("shuffle",14)} 脱敏工单生成</a><a class="suite-link" href="aggregation.html">${icon("table",14)} Mapping 与指标回算</a><a class="suite-link" href="index.html" target="_blank">${icon("external",14)} 打开评测端</a></nav>`; }
  function renderImport() {
    parkAudioDock(true);
    root.innerHTML = `<div class="comparison-shell">${header()}<main class="comparison-main"><section class="comparison-hero"><div><p class="comparison-eyebrow">Quality acceptance workspace</p><h1>结果对比与修订</h1><p>将同一工单的参考答案 JSON 与标注员结果 JSON 并排校验。MOS 使用可配置容差辅助验收；ELO 差异只作提示，并结合备注人工判断。</p></div>${suiteNav()}</section><section class="comparison-card comparison-import"><div class="import-head"><div><h2>导入两份自包含结果 JSON</h2><p>系统会校验 Case、指纹、匿名音频及 ELO 对战是否完全对应。</p></div><button class="button button-ghost" data-action="load-demo">${icon("eye",15)} 加载演示数据</button></div><div class="json-grid"><div class="json-field"><label>参考答案 JSON <span>${state.referenceText.trim() ? "已保留 · 验收基准" : "验收基准"}</span></label><textarea data-role="reference" spellcheck="false" placeholder="粘贴参考答案的完整自包含 JSON">${h(state.referenceText)}</textarea></div><div class="json-field"><label>标注员 JSON <span>待验收与可修订结果</span></label><textarea data-role="candidate" spellcheck="false" placeholder="粘贴标注员提交的完整自包含 JSON">${h(state.candidateText)}</textarea></div></div>${state.errors.length ? `<div class="comparison-alert"><strong>暂时无法开始对比</strong><ul>${state.errors.map((error) => `<li>${h(error)}</li>`).join("")}</ul></div>` : ""}<div class="import-actions"><label class="tolerance-control">MOS 可接受偏差<select data-role="tolerance"><option value="1" ${state.tolerance===1?"selected":""}>±1 分</option><option value="2" ${state.tolerance===2?"selected":""}>±2 分</option></select></label><div class="button-row"><button class="button button-primary" data-action="analyze">开始对比 ${icon("arrowRight",15)}</button></div></div><p class="admin-note">批量验收时可在对比结果页点击“继续对比下一份”：系统会保留参考答案，只清空标注员结果。访问隔离说明：本页面设置 noindex；若需要真正的权限隔离，请部署在带登录鉴权的私有站点或受控网络中。</p></section></main></div>`;
  }
  function renderMosRows(result) {
    let rows = result.mosRows.filter((row) => row.blindId === state.selectedBlindId);
    if (state.filter === "outlier") rows = rows.filter((row) => row.status === "outlier");
    if (state.filter === "different") rows = rows.filter((row) => row.status !== "exact");
    if (!rows.length) return `<tr><td colspan="6">当前筛选条件下没有记录。</td></tr>`;
    return rows.map((row) => {
      const key = `${row.blindId}:${row.dimension.key}`; const open = state.expanded.has(key); const ref = evidence(row.referenceItem,row.dimension); const cand = evidence(row.candidateItem,row.dimension);
      const supportsIssues = Boolean(D.LOW_SCORE_OPTIONS && D.LOW_SCORE_OPTIONS[row.dimension.key]) || row.dimension.key === "instruction_following";
      const issueOptions = row.dimension.key === "instruction_following" ? (D.INSTRUCTION_DEDUCTION_OPTIONS || []) : (D.LOW_SCORE_OPTIONS[row.dimension.key] || []);
      const issueEditor = supportsIssues ? `<label class="evidence-label">问题/扣分项 · 与评测端选项一致</label><div class="issue-chips comparison-issue-chips">${issueOptions.map((option) => `<button type="button" class="issue-chip ${cand.issues.includes(option) ? "is-selected" : ""}" data-action="toggle-comparison-issue" data-blind="${h(row.blindId)}" data-dimension="${h(row.dimension.key)}" data-issue="${h(option)}" aria-pressed="${cand.issues.includes(option)}">${cand.issues.includes(option) ? icon("check", 11) : ""}<span>${h(option)}</span></button>`).join("")}</div>` : "";
      return `<tr><td class="dimension-name"><strong>${h(row.dimension.label)}</strong><span>${h(groupFor(row.dimension.key))}</span></td><td><span class="score-reference">${row.referenceScore}</span></td><td><select class="compact-select" data-role="mos-score" data-blind="${h(row.blindId)}" data-dimension="${h(row.dimension.key)}">${[1,2,3,4,5].map((value)=>`<option value="${value}" ${value===row.candidateScore?"selected":""}>${value}</option>`).join("")}</select></td><td><span class="delta ${row.delta<0?"negative":row.delta>0?"positive":""}">${row.delta>0?"+":""}${row.delta}</span></td><td><span class="judgement ${row.status}">${row.status==="exact"?"一致":row.status==="acceptable"?"容差内":"需复核"}</span></td><td><button class="button button-ghost compact" data-action="toggle-evidence" data-key="${h(key)}">${icon("eye",13)} 依据与备注</button></td></tr><tr class="evidence-row" ${open?"":"hidden"}><td colspan="6"><div class="evidence-grid"><div class="evidence-panel"><h4>参考答案依据</h4>${supportsIssues?`<p><strong>问题/扣分项：</strong>${h(ref.issues.join("、")||"无")}</p>`:""}<p><strong>备注：</strong>${h(ref.note||"无")}</p></div><div class="evidence-panel"><h4>标注结果（可修订）</h4>${issueEditor}<label class="evidence-label">备注</label><textarea data-role="mos-note" data-blind="${h(row.blindId)}" data-dimension="${h(row.dimension.key)}">${h(cand.note)}</textarea></div></div></td></tr>`;
    }).join("");
  }
  function renderEloRows(result) {
    return result.eloRows.map((row,index) => {
      const last=index===result.eloRows.length-1||result.eloRows[index+1].matchId!==row.matchId;
      const noteRow=last?`<tr class="evidence-row"><td colspan="5"><div class="evidence-grid"><div class="evidence-panel"><h4>参考答案本场备注</h4><p>${h(row.refMatch.note||"无")}</p></div><div class="evidence-panel"><h4>标注结果本场备注（可修订）</h4><textarea class="elo-note-field" data-role="elo-note" data-match="${h(row.matchId)}" placeholder="补充本场共同判断依据">${h(row.candidateMatch.note||"")}</textarea></div></div></td></tr>`:"";
      return `<tr><td><strong>${h(row.matchId)}</strong></td><td>${h(row.dimension.label)}</td><td><span class="score-reference">${h(outcomeLabel(row.referenceOutcome))}</span></td><td><select class="compact-select" data-role="elo-outcome" data-match="${h(row.matchId)}" data-dimension="${h(row.dimension.key)}">${["left","draw","right"].map((value)=>`<option value="${value}" ${value===row.candidateOutcome?"selected":""}>${outcomeLabel(value)}</option>`).join("")}</select></td><td><span class="judgement ${row.same?"exact":"info"}">${row.same?"一致":"差异 · 仅提示"}</span></td></tr>${noteRow}`;
    }).join("");
  }
  function renderCompare() {
    const result = compare(state.reference,state.editable,state.tolerance); const metrics = result.metrics; const edits = collectChanges(state.original,state.editable);
    const candidateList = candidates(state.editable); if (!state.selectedBlindId && candidateList.length) state.selectedBlindId = candidateList[0].blind_id;
    const exportBundle = buildResultExportBundle(); const refinedLength = exportBundle.refinedText.length; const refinedWithinLimit = refinedLength <= RESULT_CELL_CHAR_LIMIT;
    parkAudioDock(false);
    root.innerHTML = `<div class="comparison-shell">${header()}<main class="comparison-main"><section class="comparison-hero"><div><p class="comparison-eyebrow">${h(state.editable.case_id)} · ${h(state.editable.task_bundle_id)}</p><h1>验收辅助判断</h1><p>MOS 超出 ±${state.tolerance} 分时进入人工复核；备注和低分问题在每一行展开查看。ELO 差异不会自动导致不通过。</p></div>${suiteNav()}</section><div class="compare-toolbar"><div class="button-row"><button class="button button-ghost" data-action="back-import">${icon("arrowLeft",15)} 更换结果</button><label class="tolerance-control">MOS 容差<select data-role="tolerance"><option value="1" ${state.tolerance===1?"selected":""}>±1 分</option><option value="2" ${state.tolerance===2?"selected":""}>±2 分</option></select></label></div><span class="edit-count" data-edit-count>管理员已修改 ${edits.length} 个字段</span></div><div class="summary-grid"><div class="summary-card"><span>MOS 对比项</span><strong>${metrics.total}</strong></div><div class="summary-card is-good"><span>完全一致</span><strong>${metrics.exact}</strong></div><div class="summary-card"><span>容差内差异</span><strong>${metrics.acceptable}</strong></div><div class="summary-card ${metrics.outliers?"is-danger":"is-good"}"><span>超出容差</span><strong>${metrics.outliers}</strong></div><div class="summary-card"><span>ELO 一致</span><strong>${metrics.eloSame}/${metrics.eloTotal}</strong></div></div><div class="recommendation ${metrics.outliers?"needs-review":""}">${icon(metrics.outliers?"warning":"checkCircle",18)} ${metrics.outliers?`有 ${metrics.outliers} 个 MOS 项需结合备注人工复核`:`未发现超出 MOS 容差的评分，建议通过`}</div><section class="comparison-card comparison-section"><div class="section-title"><div><h2>MOS 分层对比</h2><p>参考分固定；标注分、问题标签和备注均可直接修订。</p></div><div class="filter-tabs"><button data-filter="all" class="${state.filter==="all"?"is-active":""}">全部</button><button data-filter="different" class="${state.filter==="different"?"is-active":""}">有差异</button><button data-filter="outlier" class="${state.filter==="outlier"?"is-active":""}">仅需复核</button></div></div><div class="candidate-tabs">${candidateList.map((item,index)=>`<button data-candidate="${h(item.blind_id)}" class="${item.blind_id===state.selectedBlindId?"is-active":""}">候选 ${String(index+1).padStart(2,"0")}</button>`).join("")}</div><div class="comparison-table-wrap" style="margin-top:12px"><table class="comparison-table"><thead><tr><th>维度</th><th>参考分</th><th>标注分</th><th>差值</th><th>辅助判断</th><th>证据</th></tr></thead><tbody>${renderMosRows(result)}</tbody></table></div></section><section class="comparison-card comparison-section"><div class="section-title"><div><h2>ELO 结果对比</h2><p>胜/平/负差异只作信息提示，不参与自动判退；可直接修订标注结果。</p></div></div><div class="comparison-table-wrap"><table class="comparison-table"><thead><tr><th>对战</th><th>维度</th><th>参考答案</th><th>标注结果</th><th>提示</th></tr></thead><tbody>${renderEloRows(result)}</tbody></table></div></section><section class="comparison-export-summary"><div><strong>修改结果保存</strong><span>精简结果 JSON（无修改历史）保留 Revision 编号；完整审计 JSON 保留全部修改过程。</span></div><div class="cell-limit-status ${refinedWithinLimit?"is-within":"is-over"}">${icon(refinedWithinLimit?"checkCircle":"warning",15)}<strong>${refinedWithinLimit?`未超过 5 万：当前 ${refinedLength.toLocaleString()} 字符`:`已超过 5 万：当前 ${refinedLength.toLocaleString()} 字符`}</strong></div></section><div class="result-actions"><div><strong>${metrics.outliers?"建议人工复核":"建议通过"}</strong><div class="edit-count">修订将写入新的 Revision，原完成时间保留。</div></div><div class="button-row"><button class="button button-ghost" data-action="copy-report">${icon("copy",14)} 复制结构化报告 JSON</button><button class="button button-ghost" data-action="download-image">${icon("download",14)} 下载对比长图 PNG</button><button class="button button-primary" data-action="copy-refined-result">${icon("copy",14)} 复制精简结果 JSON</button><button class="button button-primary" data-action="download-refined-result">${icon("download",14)} 下载精简结果 JSON</button><button class="button button-primary" data-action="download-full-result">${icon("download",14)} 下载完整审计 JSON</button><button class="button button-primary" data-action="next-comparison">继续对比下一份 ${icon("arrowRight",14)}</button></div></div></main></div>`;
    if (state.warnings.length) {
      const hero = root.querySelector(".comparison-hero");
      if (hero) hero.insertAdjacentHTML("afterend", `<div class="comparison-alert"><strong>Case 上下文兼容提醒</strong><ul>${state.warnings.map((warning) => `<li>${h(warning)}</li>`).join("")}</ul></div>`);
    }
    const exportStart = root.innerHTML.indexOf('<section class="comparison-export-summary">');
    const exportEnd = root.innerHTML.indexOf('</main></div>', exportStart);
    if (exportStart >= 0 && exportEnd >= 0) {
      const preferredWithinLimit = exportBundle.preferredText.length <= RESULT_CELL_CHAR_LIMIT;
      const preferredLabel = exportBundle.preferFull ? "完整审计 JSON" : "精简结果 JSON";
      const alternateLabel = exportBundle.preferFull ? "精简结果 JSON" : "完整审计 JSON";
      const statusText = exportBundle.preferFull
        ? `完整审计 JSON 未超过 5 万：当前 ${exportBundle.fullText.length.toLocaleString()} 字符，优先保留全部修改历史。`
        : preferredWithinLimit
          ? `完整审计 JSON 为 ${exportBundle.fullText.length.toLocaleString()} 字符，已超过 5 万；推荐精简结果 ${exportBundle.refinedText.length.toLocaleString()} 字符。`
          : `完整与精简结果均超过 5 万：精简结果当前 ${exportBundle.refinedText.length.toLocaleString()} 字符。`;
      const exportMarkup = `<section class="comparison-export-summary"><div><strong>推荐保存：${preferredLabel}</strong><span>完整审计 ${exportBundle.fullText.length.toLocaleString()} 字符 · 精简结果 ${exportBundle.refinedText.length.toLocaleString()} 字符</span></div><div class="cell-limit-status ${preferredWithinLimit?"is-within":"is-over"}">${icon(preferredWithinLimit?"checkCircle":"warning",15)}<strong>${statusText}</strong></div></section><div class="result-actions"><div><strong>${metrics.outliers?"建议人工复核":"建议通过"}</strong><div class="edit-count">修订将写入新的 Revision，原完成时间保留。</div></div><div class="button-row"><button class="button button-ghost" data-action="copy-report">${icon("copy",14)} 复制结构化报告 JSON</button><button class="button button-ghost" data-action="download-image">${icon("download",14)} 下载对比长图 PNG</button><button class="button button-primary" data-action="copy-preferred-result">${icon("copy",14)} 复制${preferredLabel}（推荐）</button><button class="button button-primary" data-action="download-preferred-result">${icon("download",14)} 下载${preferredLabel}（推荐）</button><button class="button button-ghost" data-action="download-alternate-result">${icon("download",14)} 下载${alternateLabel}</button><button class="button button-primary" data-action="next-comparison">继续对比下一份 ${icon("arrowRight",14)}</button></div></div>`;
      root.innerHTML = root.innerHTML.slice(0, exportStart) + exportMarkup + root.innerHTML.slice(exportEnd);
    }
    const mosSectionMarker = '<section class="comparison-card comparison-section"><div class="section-title"><div><h2>MOS 分层对比</h2>';
    const audioPlaceholder = '<div data-audio-dock-anchor></div>';
    root.innerHTML = root.innerHTML.replace(mosSectionMarker, `${audioDock ? audioPlaceholder : renderAudioPanel(candidateList)}${mosSectionMarker}`);
    mountAudioDock(candidateList);
  }
  function render() { state.screen === "compare" ? renderCompare() : renderImport(); }
  function prepareNextComparison() {
    state.screen = "import";
    state.candidateText = "";
    state.original = null;
    state.editable = null;
    state.initial = null;
    state.selectedBlindId = "";
    state.filter = "all";
    state.expanded.clear();
    state.errors = [];
    state.warnings = [];
    render();
    window.setTimeout(() => { const field = root.querySelector('[data-role="candidate"]'); if (field && field.focus) field.focus(); }, 0);
  }
  function setNestedText(target, role) {
    const item = mosMap(state.editable).get(target.dataset.blind); if (!item) return;
    const key = target.dataset.dimension; const values = target.value.split(/\n|、/).map((value)=>value.trim()).filter(Boolean);
    if (role === "mos-issues") {
      if (key === "instruction_following") item.instruction_deductions = values;
      else { item.low_score_issues = item.low_score_issues || {}; item.low_score_issues[key] = values; }
    } else if (key === "instruction_following") item.instruction_note = target.value;
    else { item.notes = item.notes || {}; item.notes[key] = target.value; }
  }
  function makeDemo() {
    const ids=["R-DEMO-A001","R-DEMO-B002"]; const work={tag:"演示：温暖流行",lyrics:"[Verse]\nDemo lyrics",candidates:ids.map((blind_id,index)=>({slot:index+1,blind_id,url:`https://example.com/demo-${index+1}.mp3`})),elo_order_key:"K-DEMO-ADMIN-COMPARE"};
    const base={schema_version:D.REVIEW_SCHEMA,work_order_fingerprint:"demo-admin-compare",batch_id:"BATCH-DEMO",task_bundle_id:"TASK-DEMO-COMPARE",case_id:"CASE-DEMO-01",model_count:2,work_order:work,mos:ids.map((blind_id,index)=>({subtask_id:`MOS-0${index+1}`,blind_id,scores:Object.fromEntries(dimensions.map((dimension)=>[dimension.key,4])),low_score_issues:{},notes:{overall:"参考答案整体表现稳定。"},instruction_deductions:[],instruction_note:""})),elo_matches:[{subtask_id:"ELO-01",left_blind_id:ids[0],right_blind_id:ids[1],dimension_results:Object.fromEntries(eloDimensions.map((dimension)=>[dimension.key,"left"])),note:"参考答案更偏好 A。"}],status:"complete",completed_at:"2026-08-17T08:00:00.000Z",updated_at:"2026-08-17T08:00:00.000Z",result_revision:1,revision_remark:"初始评测完成",revision_history:[{revision:1,updated_at:"2026-08-17T08:00:00.000Z",remark:"初始评测完成",changes:[]}]};
    const candidate=clone(base); candidate.mos[0].scores.melody=3; candidate.mos[0].low_score_issues.melody=["旋律听感生硬/不顺/杂乱"]; candidate.mos[0].notes.melody="局部乐句略显生硬。"; candidate.mos[1].scores.audio_quality=1; candidate.mos[1].low_score_issues.audio_quality=["整体偏糊，清晰度难辨"]; candidate.mos[1].notes.audio_quality="高频和人声细节较难分辨。"; candidate.elo_matches[0].dimension_results.acoustics="right"; candidate.elo_matches[0].dimension_results.overall="draw"; candidate.elo_matches[0].note="两侧各有优势。";
    state.referenceText=JSON.stringify(base,null,2); state.candidateText=JSON.stringify(candidate,null,2); state.errors=[]; render();
  }
  root.addEventListener("input", (event) => {
    const target=event.target; const role=target.dataset.role;
    if(role==="reference") state.referenceText=target.value; else if(role==="candidate") state.candidateText=target.value; else if(role==="mos-issues"||role==="mos-note") { setNestedText(target,role); const node=root.querySelector("[data-edit-count]"); if(node) node.textContent=`管理员已修改 ${collectChanges(state.original,state.editable).length} 个字段`; } else if(role==="elo-note") { const item=eloMap(state.editable).get(target.dataset.match); if(item)item.note=target.value; const node=root.querySelector("[data-edit-count]"); if(node)node.textContent=`管理员已修改 ${collectChanges(state.original,state.editable).length} 个字段`; }
  });
  root.addEventListener("change", (event) => {
    const target=event.target; const role=target.dataset.role;
    if(role==="tolerance") { state.tolerance=Number(target.value); if(state.screen==="compare") render(); }
    if(role==="mos-score") { const item=mosMap(state.editable).get(target.dataset.blind); if(item){item.scores[target.dataset.dimension]=Number(target.value);render();} }
    if(role==="elo-outcome") { const item=eloMap(state.editable).get(target.dataset.match); if(item){item.dimension_results=item.dimension_results||{};item.dimension_results[target.dataset.dimension]=target.value;render();} }
  });
  root.addEventListener("play", (event) => {
    const active = event.target;
    if (!active || !active.classList || !active.classList.contains("comparison-audio-player")) return;
    root.querySelectorAll(".comparison-audio-player").forEach((audio) => { if (audio !== active) audio.pause(); });
  }, true);
  root.addEventListener("click", async (event) => {
    const target=event.target.closest("button,[data-candidate],[data-filter]"); if(!target)return;
    const action=target.dataset.action;
    if(action==="load-demo") return makeDemo();
    if(action==="analyze") { const ref=parseJson(state.referenceText,"参考答案"); const cand=parseJson(state.candidateText,"标注结果"); state.errors=[];state.warnings=[]; if(ref.error)state.errors.push(ref.error); if(cand.error)state.errors.push(cand.error); if(!state.errors){state.errors=validatePair(ref.value,cand.value);state.warnings=optionalContextWarnings(ref.value,cand.value);} if(state.errors.length)return render(); state.reference=mergeOptionalContext(ref.value,cand.value);state.original=mergeOptionalContext(cand.value,ref.value);state.editable=clone(state.original);state.initial=compare(state.reference,state.original,state.tolerance);state.selectedBlindId=candidates(state.editable)[0].blind_id;state.screen="compare";return render(); }
    if(action==="back-import") { state.screen="import";state.errors=[];return render(); }
    if(action==="next-comparison") return prepareNextComparison();
    if(action==="toggle-evidence") { state.expanded.has(target.dataset.key)?state.expanded.delete(target.dataset.key):state.expanded.add(target.dataset.key);return render(); }
    if(action==="toggle-comparison-issue") { const item=mosMap(state.editable).get(target.dataset.blind); if(!item)return; const key=target.dataset.dimension; const current=key==="instruction_following"?(item.instruction_deductions||[]):((item.low_score_issues&&item.low_score_issues[key])||[]); const next=current.includes(target.dataset.issue)?current.filter((value)=>value!==target.dataset.issue):current.concat(target.dataset.issue); if(key==="instruction_following")item.instruction_deductions=next;else{item.low_score_issues=item.low_score_issues||{};item.low_score_issues[key]=next;} return render(); }
    if(target.dataset.candidate){state.selectedBlindId=target.dataset.candidate;return render();}
    if(target.dataset.filter){state.filter=target.dataset.filter;return render();}
    if(action==="copy-preferred-result") { try { const bundle=buildResultExportBundle(); await U.copyText(bundle.preferredText); const label=bundle.preferFull?"完整审计 JSON":"精简结果 JSON"; toast(`${label} 已复制（${bundle.preferredText.length} 字符${bundle.preferredText.length<=RESULT_CELL_CHAR_LIMIT?"，未超过 5 万":"，已超过 5 万"}）`,bundle.preferredText.length<=RESULT_CELL_CHAR_LIMIT?"success":"error"); } catch(error) { toast("复制失败，请重试","error"); } return; }
    if(action==="download-preferred-result"||action==="download-alternate-result") { const bundle=buildResultExportBundle(); const preferred=action==="download-preferred-result"; const useFull=preferred?bundle.preferFull:!bundle.preferFull; const result=useFull?bundle.fullResult:bundle.refinedResult; const suffix=useFull?"":"-refined"; U.downloadText(`${U.fileSafe(state.editable.case_id)}_${exportTimestamp()}${suffix}.json`,JSON.stringify(result,null,2),"application/json;charset=utf-8"); return toast(`${useFull?"完整审计":"精简结果"} JSON 已下载`,"success"); }
    const resultActions={"copy-report":()=>U.copyText(JSON.stringify(buildReport(),null,2)),"download-image":()=>downloadComparisonImage()};
    if(resultActions[action]){try{await resultActions[action]();toast(action.startsWith("copy")?"已复制到剪贴板":"文件已下载","success");}catch(error){toast("操作失败，请重试","error");}}
  });
  window.__SB_COMPARISON_TEST__={state,parseJson,validatePair,optionalContextWarnings,mergeOptionalContext,compare,collectChanges,buildCorrectedResult,buildRefinedResult,buildResultExportBundle,exportTimestamp,downloadComparisonImage,makeDemo,prepareNextComparison,render};
  render();
})();
