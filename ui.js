(function () {
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  const paths = {
    arrowLeft: '<path d="M15 18l-6-6 6-6"/><path d="M21 12H9"/>',
    arrowRight: '<path d="M9 18l6-6-6-6"/><path d="M3 12h12"/>',
    back: '<path d="M15 18l-6-6 6-6"/><path d="M21 12H9"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12l2.5 2.5L16 9"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    chevronRight: '<path d="M9 18l6-6-6-6"/>',
    clipboard: '<rect x="7" y="5" width="10" height="16" rx="2"/><path d="M9 5V3h6v2M4 17V7a2 2 0 012-2"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
    download: '<path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v3h16v-3"/>',
    edit: '<path d="M4 20h4l11-11-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h6"/>',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    headphones: '<path d="M4 14v-2a8 8 0 0116 0v2"/><path d="M4 14h3v6H5a1 1 0 01-1-1v-5zm16 0h-3v6h2a1 1 0 001-1v-5z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
    music: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
    paste: '<path d="M9 5V3h6v2"/><rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 10h6M9 14h6M9 18h4"/>',
    play: '<path d="M8 5l11 7-11 7V5z"/>',
    refresh: '<path d="M20 7v5h-5"/><path d="M19 12a7 7 0 10-2 5"/>',
    shield: '<path d="M12 3l8 3v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
    shuffle: '<path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6M4 4l5 5"/>',
    spark: '<path d="M12 2l1.4 5.1L18 9l-4.6 1.9L12 16l-1.4-5.1L6 9l4.6-1.9L12 2zM19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15z"/>',
    table: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M8 5v14M15 5v14"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
    upload: '<path d="M12 16V4m0 0L8 8m4-4l4 4"/><path d="M4 14v6h16v-6"/>',
    warning: '<path d="M12 3L2 21h20L12 3z"/><path d="M12 9v5M12 18h.01"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>'
  };

  const aliases = {
    "arrow-left": "arrowLeft",
    "arrow-right": "arrowRight",
    "audio-waveform": "music",
    "check-circle": "checkCircle",
    "circle-alert": "warning",
    "file-spreadsheet": "table",
    "file-up": "upload",
    "flask-conical": "spark",
    "lock-keyhole": "lock",
    "shield-check": "shield",
    "triangle-alert": "warning"
  };

  function icon(name, size) {
    const resolvedName = aliases[name] || name;
    const body = paths[resolvedName] || paths.info;
    const px = Number(size) || 18;
    return `<svg class="icon icon-${escapeHtml(name)}" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  function toast(message, type) {
    const region = document.getElementById("toast-region") || document.body;
    const item = document.createElement("div");
    item.className = `toast toast-${type || "info"}`;
    const iconName = type === "error" ? "warning" : type === "success" ? "checkCircle" : "info";
    item.innerHTML = `${icon(iconName, 18)}<span>${escapeHtml(message)}</span>`;
    region.appendChild(item);
    window.requestAnimationFrame(() => item.classList.add("is-visible"));
    window.setTimeout(() => {
      item.classList.remove("is-visible");
      window.setTimeout(() => item.remove(), 220);
    }, 3200);
  }

  function formatJson(value) {
    try {
      return JSON.stringify(typeof value === "string" ? JSON.parse(value) : value, null, 2);
    } catch (error) {
      return String(value == null ? "" : value);
    }
  }

  Object.assign(window, {
    SB_UI: { escapeHtml, icon, toast, formatJson }
  });
})();
