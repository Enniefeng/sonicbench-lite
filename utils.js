(function () {
  function detectDelimiter(text) {
    let inQuotes = false;
    let tabCount = 0;
    let commaCount = 0;
    const sample = String(text || "").slice(0, 4000);
    for (let i = 0; i < sample.length; i += 1) {
      const char = sample[i];
      if (char === '"') {
        if (inQuotes && sample[i + 1] === '"') {
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (!inQuotes && char === "\t") {
        tabCount += 1;
      } else if (!inQuotes && char === ",") {
        commaCount += 1;
      } else if (!inQuotes && (char === "\n" || char === "\r")) {
        break;
      }
    }
    return tabCount > 0 || tabCount >= commaCount ? "\t" : ",";
  }

  function parseDelimitedDetailed(text, explicitDelimiter) {
    const source = String(text || "").replace(/^\uFEFF/, "");
    if (!source.trim()) return { rows: [], delimiter: explicitDelimiter || ",", error: null };
    const delimiter = explicitDelimiter || detectDelimiter(source);
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      const next = source[i + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          cell += char;
        }
        continue;
      }

      if (char === '"' && cell.length === 0) {
        inQuotes = true;
      } else if (char === delimiter) {
        row.push(cell);
        cell = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && next === "\n") i += 1;
        row.push(cell);
        if (row.some((value) => String(value).length > 0)) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }

    if (inQuotes) {
      return {
        rows: [],
        delimiter,
        error: "文件中存在未闭合的双引号，请用 Excel 重新另存为 CSV UTF-8 后再导入"
      };
    }

    row.push(cell);
    if (row.some((value) => String(value).length > 0)) rows.push(row);
    return { rows, delimiter, error: null };
  }

  function parseDelimited(text, explicitDelimiter) {
    return parseDelimitedDetailed(text, explicitDelimiter).rows;
  }

  function quoteDelimitedCell(value, delimiter) {
    const text = value == null ? "" : String(value);
    const needsQuotes = text.includes(delimiter) || /[\r\n"]/.test(text);
    return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function serializeCSVRow(cells) {
    return cells.map((value) => quoteDelimitedCell(value, ",")).join(",");
  }

  function serializeCSV(rows) {
    return rows.map(serializeCSVRow).join("\r\n");
  }

  function quoteTSVCell(value) {
    return quoteDelimitedCell(value, "\t");
  }

  function serializeTSVRow(cells) {
    return cells.map(quoteTSVCell).join("\t");
  }

  function serializeTSV(rows) {
    return rows.map(serializeTSVRow).join("\n");
  }

  function encodeFlatText(value) {
    return String(value == null ? "" : value)
      .replace(/\\/g, "\\\\")
      .replace(/\t/g, "\\t")
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n");
  }

  function decodeFlatText(value) {
    const source = String(value == null ? "" : value);
    let output = "";
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] !== "\\" || i === source.length - 1) {
        output += source[i];
        continue;
      }
      const next = source[i + 1];
      if (next === "n") output += "\n";
      else if (next === "r") output += "\r";
      else if (next === "t") output += "\t";
      else if (next === "\\") output += "\\";
      else {
        output += `\\${next}`;
      }
      i += 1;
    }
    return output;
  }

  function protectSpreadsheetText(value) {
    const text = String(value == null ? "" : value);
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  }

  function unprotectSpreadsheetText(value) {
    const text = String(value == null ? "" : value);
    return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
  }

  function looksLikeHeader(row) {
    const first = String((row || [])[0] || "").trim().toLowerCase();
    return ["case_id", "case id", "caseid", "id"].includes(first);
  }

  function normalizeHttpUrl(value) {
    const text = String(value || "").trim();
    const markdownLink = text.match(/^\[[^\]\r\n]*\]\(\s*(https?:\/\/[^\r\n]+)\s*\)$/i);
    return markdownLink ? markdownLink[1].trim() : text;
  }

  function isHttpUrl(value) {
    try {
      const parsed = new URL(normalizeHttpUrl(value));
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  function randomUint(maxExclusive) {
    if (maxExclusive <= 0) return 0;
    if (window.crypto && window.crypto.getRandomValues) {
      const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
      const buffer = new Uint32Array(1);
      do {
        window.crypto.getRandomValues(buffer);
      } while (buffer[0] >= limit);
      return buffer[0] % maxExclusive;
    }
    return Math.floor(Math.random() * maxExclusive);
  }

  function secureShuffle(values) {
    const result = Array.from(values || []);
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = randomUint(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function randomToken(length) {
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let value = "";
    for (let i = 0; i < length; i += 1) value += alphabet[randomUint(alphabet.length)];
    return value;
  }

  function uniqueBlindId(usedIds) {
    let id = "";
    do {
      id = `R-${randomToken(4)}-${randomToken(4)}-${randomToken(4)}`;
    } while (usedIds.has(id));
    usedIds.add(id);
    return id;
  }

  function makeBatchId() {
    const date = new Date();
    const stamp = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, "0")))
      .join("");
    return `BATCH-${stamp}-${randomToken(4)}`;
  }

  function hashString(input) {
    let hash = 2166136261;
    const source = String(input || "");
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function taskIdentityFingerprint(value) {
    const source = value || {};
    const context = source.work_order || source;
    const candidates = Array.isArray(context.candidates) ? context.candidates : [];
    const payload = {
      schema_version: String(context.schema_version || source.schema || "sonicbench-work-order/flexible-model/1.0"),
      batch_id: String(context.batch_id || source.batch_id || source.batchId || ""),
      task_bundle_id: String(context.task_bundle_id || source.task_bundle_id || source.taskBundleId || ""),
      case_id: String(context.case_id || source.case_id || source.caseId || ""),
      model_count: Number(context.model_count || source.model_count || source.modelCount || candidates.length || 0),
      candidates: candidates.map((candidate, index) => ({
        slot: Number(candidate.slot || candidate.candidate_slot || index + 1),
        blind_id: String(candidate.blind_id || candidate.id || ""),
        url: normalizeHttpUrl(candidate.url || "")
      })),
      elo_order_key: String(context.elo_order_key || source.elo_order_key || source.eloOrderKey || "")
    };
    return hashString(JSON.stringify(payload));
  }

  function seededRandom(seedText) {
    let state = parseInt(hashString(seedText), 16) >>> 0;
    return function next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createEloOrderFromKey(blindIds, orderKey) {
    const ids = Array.from(blindIds || []);
    if (ids.length < 2 || ids.length > 6 || new Set(ids).size !== ids.length || !String(orderKey || "")) return [];
    const random = seededRandom(`${orderKey}\u241f${ids.join("\u241f")}`);
    const pairs = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const flipped = random() >= 0.5;
        pairs.push({
          left_id: flipped ? ids[j] : ids[i],
          right_id: flipped ? ids[i] : ids[j]
        });
      }
    }
    for (let i = pairs.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    return pairs.map((pair, index) => ({
      match_id: `ELO-${String(index + 1).padStart(2, "0")}`,
      left_id: pair.left_id,
      right_id: pair.right_id
    }));
  }

  function safeJsonParse(value) {
    try {
      return { value: JSON.parse(String(value || "")), error: null };
    } catch (error) {
      return { value: null, error };
    }
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function truncate(value, length) {
    const text = String(value || "");
    return text.length > length ? `${text.slice(0, Math.max(0, length - 1))}…` : text;
  }

  function fileSafe(value) {
    return String(value || "data").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "data";
  }

  function copyText(text) {
    const value = String(text || "");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).catch(() => fallbackCopy(value));
    }
    return fallbackCopy(value);
  }

  function fallbackCopy(value) {
    return new Promise((resolve, reject) => {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "readonly");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        const success = document.execCommand("copy");
        document.body.removeChild(textarea);
        success ? resolve() : reject(new Error("copy failed"));
      } catch (error) {
        document.body.removeChild(textarea);
        reject(error);
      }
    });
  }

  function downloadText(filename, text, type) {
    const blob = new Blob([String(text || "")], { type: type || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function getUrlHost(url) {
    try {
      return new URL(normalizeHttpUrl(url)).host;
    } catch (error) {
      return "无效 URL";
    }
  }

  Object.assign(window, {
    SB_UTILS: {
      parseDelimited,
      parseDelimitedDetailed,
      serializeCSVRow,
      serializeCSV,
      serializeTSVRow,
      serializeTSV,
      encodeFlatText,
      decodeFlatText,
      protectSpreadsheetText,
      unprotectSpreadsheetText,
      looksLikeHeader,
      normalizeHttpUrl,
      isHttpUrl,
      secureShuffle,
      randomToken,
      uniqueBlindId,
      makeBatchId,
      hashString,
      taskIdentityFingerprint,
      createEloOrderFromKey,
      safeJsonParse,
      nowISO,
      truncate,
      fileSafe,
      copyText,
      downloadText,
      getUrlHost
    }
  });
})();
