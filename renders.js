// -------------------------
// Global error trap (helps debugging silently failing buttons)
// -------------------------
window.addEventListener("error", (e) => {
  console.error("GLOBAL ERROR:", e.message, e.filename, e.lineno, e.colno);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("UNHANDLED PROMISE:", e.reason);
});

// -------------------------
// State
// -------------------------
let loadedXsltText = "";
let baseDir = "";
let lastDetectedRoot = "SupplyAgreementDto";
let lastDetectedCandidates = [];
let lastDetectedByXslt = "";

// -------------------------
// Document type rules
// -------------------------
const DOC_RULES = {
  sales:   { root: "SupplyAgreementDto", decode: "smart" },
  grid:    { root: "SalesContractDto",  decode: "smart" },
  invoice: { root: "Finvoice",          decode: "smart" },
  deposit: { root: "SecurityDepositReceiptDto", decode: "smart" },
  auto:    { root: null,                decode: "smart" }
};

function getDocSettings(xsltText = "") {
  const type = document.getElementById("docType")?.value || "auto";
  const lock = document.getElementById("lockDocType")?.checked ?? true;
  const decodeMode = document.getElementById("decodeMode")?.value || "smart";

  const detected = detectRootsFromXslt(xsltText);
  const autoRoot = detected?.bestRoot || "SupplyAgreementDto";

  const wantedRoot = (lock && DOC_RULES[type]?.root) ? DOC_RULES[type].root : autoRoot;

  return {
    type,
    lock,
    wantedRoot,
    detectedRoot: autoRoot,
    candidates: detected?.candidates || [],
    decodeMode
  };
}

// -------------------------
// i18n (FI/EN)
// -------------------------
const I18N = {
  fi: {
    previewStarted: "Preview started",
    noXslt: "Valitse XSLT",
    xmlParseError: "ERROR: XML parsererror (source XML).",
    xsltParseError: "ERROR: XSLT parsererror (stylesheet).",
    foRootMissing: "FO-rootia ei löytynyt tuloksesta.",
    tipXml: "TIP: Source XML ei ole validi. Luo testidata (rootista) tai liitä oikea XML (rootin pitää vastata match=\"...\").",
    includesNoBase: "WARN: xsl:include/xsl:import löytyi mutta pohjakansiota ei ole valittu.",
    baseDirSet: "Base directory set: ",
    baseDirCanceled: "Base directory selection canceled.",
    cleared: "Cleared.",
    inputTitle: "Syöte",
    previewBtn: "Näytä preview",
    clearBtn: "Tyhjennä",
    pickBaseDir: "Valitse pohjakansio (include/import)",
    logsTitle: "Lokit",
    runFromEditor: "Aja editorista",
    genXml: "Luo testidata (rootista)",
    saveXslt: "Tallenna XSLT…",
    saveXml: "Tallenna XML…",
    reset: "Palauta ladattu"
  },
  en: {
    previewStarted: "Preview started",
    noXslt: "Select an XSLT file",
    xmlParseError: "ERROR: XML parsererror (source XML).",
    xsltParseError: "ERROR: XSLT parsererror (stylesheet).",
    foRootMissing: "FO root not found in output.",
    tipXml: "TIP: Source XML is not valid. Generate test XML (from root) or paste a valid XML (root must match match=\"...\").",
    includesNoBase: "WARN: xsl:include/xsl:import found but no base directory selected.",
    baseDirSet: "Base directory set: ",
    baseDirCanceled: "Base directory selection canceled.",
    cleared: "Cleared.",
    runFromEditor: "Run from editor",
    genXml: "Generate test XML (from root)",
    saveXslt: "Save XSLT…",
    saveXml: "Save XML…",
    reset: "Reset to loaded",
    inputTitle: "Input",
    previewBtn: "Show preview",
    clearBtn: "Clear",
    pickBaseDir: "Pick base directory (include/import)",
    logsTitle: "Logs"
  }
};

let lang = localStorage.getItem("xsltPreviewLang") || "fi";
function t(key) { return (I18N[lang] && I18N[lang][key]) || key; }

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const k = el.getAttribute("data-i18n");
    if (k) el.textContent = t(k);
  });
}
function setLang(newLang) {
  lang = newLang;
  localStorage.setItem("xsltPreviewLang", lang);
  applyI18n();
}

// -------------------------
// Logging + helpers
// -------------------------
function log(msg) {
  const logDiv = document.getElementById("log");
  if (logDiv) {
    logDiv.innerHTML += String(msg) + "<br>";
    logDiv.scrollTop = logDiv.scrollHeight;
  }
  console.log(msg);
}

function isParserError(doc) {
  if (!doc || !doc.getElementsByTagName) return false;
  return doc.getElementsByTagName("parsererror").length > 0;
}

function serializeNodeSafe(node) {
  try {
    if (!node) return null;
    return new XMLSerializer().serializeToString(node);
  } catch {
    return null;
  }
}

function prettyXml(xml) {
  if (!xml) return "";
  // format real XML "<tag>"
  xml = xml.replace(/(>)(<)(\/*)/g, "$1\n$2$3");
  let pad = 0;
  return xml.split("\n").map(line => {
    if (/^<\/\w/.test(line)) pad = Math.max(pad - 1, 0);
    const indent = "  ".repeat(pad);
    if (/^<\w[^>]*[^\/]>.*$/.test(line) && !line.includes("</")) pad += 1;
    return indent + line;
  }).join("\n");
}

function escapeXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function val(id) {
  const el = document.getElementById(id);
  if (!el) return "";
  if (el.type === "checkbox") return el.checked ? "true" : "false";
  return el.value ?? "";
}

function boolFrom(id, fallback = false) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  return !!el.checked;
}

function selectVal(id, fallback = "") {
  const el = document.getElementById(id);
  if (!el) return fallback;
  return String(el.value ?? fallback);
}

function decodeEntities(s) {
  if (!s) return "";
  const ta = document.createElement("textarea");
  ta.innerHTML = s;
  return ta.value;
}

/**
 * Normalize XML/XSLT into real markup (<tag>),
 * supporting both &lt; and &amp;lt; (multi-pass decoding).
 */
function normalizeXmlText(text) {
  if (!text) return "";
  let s = String(text);

  for (let i = 0; i < 6; i++) {
    const t0 = s.trimStart();
    const containsEscaped =
      t0.startsWith("&lt;") || t0.startsWith("&amp;lt;") ||
      t0.includes("&lt;xsl:") || t0.includes("&amp;lt;xsl:") ||
      t0.includes("&lt;fo:")  || t0.includes("&amp;lt;fo:")  ||
      t0.includes("&lt;?xml") || t0.includes("&amp;lt;?xml");

    if (!containsEscaped) break;

    const decoded = decodeEntities(s);
    if (decoded === s) break;
    s = decoded;

    const hasRealTags = /<[A-Za-z?\/!]/.test(s.trimStart());
    const stillEscaped =
      s.includes("&lt;xsl:") || s.includes("&amp;lt;xsl:") ||
      s.includes("&lt;fo:")  || s.includes("&amp;lt;fo:");

    if (hasRealTags && !stillEscaped) break;
  }

  return s;
}

function normalizeByMode(text, mode = "smart") {
  if (mode === "strict") return String(text || "");
  if (mode === "smart") return normalizeXmlText(text);

  if (mode === "aggressive") {
    let s = String(text || "");
    for (let i = 0; i < 6; i++) {
      if (!s.includes("&lt;") && !s.includes("&amp;lt;")) break;
      const d = decodeEntities(s);
      if (d === s) break;
      s = d;
    }
    return s;
  }

  return normalizeXmlText(text);
}

// -------------------------
// Browser download fallback (for Save XSLT/XML when Electron API missing)
// -------------------------
function downloadTextFile(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// -------------------------
// Tabs (PDF / FO / DTO)
// -------------------------
function setTab(tab) {
  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${tab}"]`)?.classList.add("active");

  const pdf = document.getElementById("previewPdf");
  const fo = document.getElementById("previewFo");
  const dto = document.getElementById("previewDto");
  if (pdf) pdf.hidden = tab !== "pdf";
  if (fo) fo.hidden = tab !== "fo";
  if (dto) dto.hidden = tab !== "dto";
}

// -------------------------
// XSLT: detect roots
// -------------------------
function detectRootsFromXslt(xsltText) {
  xsltText = normalizeXmlText(xsltText);

  const matches = [];
  // NOTE: real markup "<xsl:template ... match='...'>"
  const re = /<xsl:template\b[^>]*\bmatch=(["'])([^"']+)\1/gi;
  let m;
  while ((m = re.exec(xsltText)) !== null) {
    const raw = (m[2] || "").trim();
    if (!raw) continue;
    raw.split("|").map(s => s.trim()).filter(Boolean).forEach(x => matches.push(x));
  }

  const norm = (expr) => {
    let s = (expr || "").trim();
    if (!s) return "";
    s = s.replace(/\[[^\]]*\]/g, "");
    s = s.replace(/^\/+/, "");
    if (s.includes("/")) s = s.split("/").filter(Boolean).pop() || s;
    if (s.startsWith("@") || s === "*" || s === "." || s === "text()") return "";
    if (s.includes(":")) s = s.split(":").pop();
    return s.trim();
  };

  const cleaned = matches.map(norm).filter(Boolean);
  const dto = cleaned.find(x => /Dto$/i.test(x));
  const fin = cleaned.find(x => /^Finvoice$/i.test(x));
  const best = fin || dto || cleaned[0] || "SupplyAgreementDto";

  return { bestRoot: best, candidates: [...new Set(cleaned)] };
}

// -------------------------
// include/import resolver (Electron IPC)
// -------------------------
function getIncludeImportRefs(xsltText) {
  xsltText = normalizeXmlText(xsltText);
  const refs = [];
  // NOTE: real markup "<xsl:include href='...'>"
  const re = /<xsl:(include|import)\b[^>]*\bhref="([^"]+)"[^>]*\/?>/gi;
  let m;
  while ((m = re.exec(xsltText)) !== null) refs.push({ type: m[1], href: m[2] });
  return refs;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveIncludes(xsltText, seen = new Set()) {
  xsltText = normalizeXmlText(xsltText);

  const refs = getIncludeImportRefs(xsltText);
  if (refs.length === 0) return xsltText;

  if (!baseDir) {
    log(t("includesNoBase"));
    return xsltText;
  }
  if (!window.api?.readTextFileRel) {
    log("WARN: readTextFileRel API missing → include/import cannot be resolved.");
    return xsltText;
  }

  let output = xsltText;

  for (const r of refs) {
    const key = (baseDir + "||" + r.href).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const res = await window.api.readTextFileRel(baseDir, r.href);
    if (!res.ok) {
      log(`ERROR: include/import not found: ${r.href} → ${res.error}`);
      continue;
    }

    const nestedResolved = await resolveIncludes(res.text, seen);
    const nested = normalizeXmlText(nestedResolved);

    // strip outer stylesheet wrapper
    const inner = nested
      .replace(/^[\s\S]*?<xsl:stylesheet\b[^>]*>/i, "")
      .replace(/<\/xsl:stylesheet>\s*$/i, "")
      .replace(/^[\s\S]*?<xsl:transform\b[^>]*>/i, "")
      .replace(/<\/xsl:transform>\s*$/i, "");

    const tagRe = new RegExp(
      `<xsl:${r.type}\\b[^>]*\\bhref="${escapeRegExp(r.href)}"[^>]*\\/?>(?:\\s*<\\/xsl:${r.type}>)?`,
      "gi"
    );

    output = output.replace(
      tagRe,
      `<!-- ${r.type} ${r.href} (inlined) -->\n${inner}\n<!-- /${r.type} ${r.href} -->`
    );
  }

  // normalize output in case included files were escaped
  output = normalizeXmlText(output);
  return output;
}

// -------------------------
// CRM compat patch
// -------------------------
function replaceBalancedCalls(text, fnName, replacer) {
  let i = 0;
  let out = "";

  while (true) {
    const idx = text.indexOf(fnName, i);
    if (idx === -1) { out += text.slice(i); break; }
    out += text.slice(i, idx);

    let j = idx + fnName.length;
    while (j < text.length && /\s/.test(text[j])) j++;

    if (text[j] !== "(") { out += fnName; i = j; continue; }

    let depth = 0;
    let k = j;
    for (; k < text.length; k++) {
      const ch = text[k];

      if (ch === '"' || ch === "'") {
        const q = ch;
        k++;
        for (; k < text.length; k++) {
          const c = text[k];
          if (c === "\\") { k++; continue; }
          if (c === q) break;
        }
        continue;
      }

      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) { k++; break; }
      }
    }

    const inside = text.slice(j + 1, k - 1);

    const args = [];
    let buf = "";
    depth = 0;

    for (let p = 0; p < inside.length; p++) {
      const ch = inside[p];

      if (ch === '"' || ch === "'") {
        const q = ch;
        buf += ch;
        p++;
        for (; p < inside.length; p++) {
          const c = inside[p];
          buf += c;
          if (c === "\\") {
            if (p + 1 < inside.length) { buf += inside[p + 1]; p++; }
            continue;
          }
          if (c === q) break;
        }
        continue;
      }

      if (ch === "(") { depth++; buf += ch; continue; }
      if (ch === ")") { depth = Math.max(0, depth - 1); buf += ch; continue; }

      if (ch === "," && depth === 0) { args.push(buf.trim()); buf = ""; continue; }
      buf += ch;
    }

    if (buf.trim() !== "" || inside.includes(",")) args.push(buf.trim());
    out += replacer(args, text.slice(idx, k));
    i = k;
  }

  return out;
}

function patchCrmFunctionsForPreview(xsltText) {
  xsltText = normalizeXmlText(xsltText);

  // Fix QName param
  xsltText = xsltText.replace(
    /<xsl:param\b([^>]*?)\bname=(["'])crm:appdata\2([^>]*?)\/?>/gi,
    (m, a, q, b) => `<xsl:param${a}name=${q}appdata${q}${b}/>`
  );
  xsltText = xsltText.replace(/\$crm:appdata\b/g, "$appdata");

  // Known helpers
  xsltText = xsltText.replace(/crm:FormatDate\s*\(\s*([^)]+?)\s*\)/g, "string($1)");
  xsltText = xsltText.replace(
    /crm:ToUpperCase\s*\(\s*([^)]+?)\s*\)/g,
    "translate($1,'abcdefghijklmnopqrstuvwxyzåäö','ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ')"
  );

  // SplitLines(X)[1] -> string(X)
  xsltText = xsltText.replace(/crm:SplitLines\s*\(\s*([^)]+?)\s*\)\s*\[\s*\d+\s*\]/g, "string($1)");

  // for-each SplitLines stub
  xsltText = xsltText.replace(
    /<xsl:for-each\s+select=(["'])crm:SplitLines\(\s*([^)]+?)\s*\)\1\s*>[\s\S]*?<\/xsl:for-each>/gi,
    (m, q, expr) => `<block><xsl:value-of select="${expr.trim()}"/></block>`
  );
  xsltText = xsltText.replace(/crm:SplitLines\s*\(\s*([^)]+?)\s*\)/g, "string($1)");

  // SplitGet stub
  xsltText = replaceBalancedCalls(xsltText, "crm:SplitGet", (args) => {
    const a0 = args?.[0]?.trim() || "''";
    return `string(${a0})`;
  });

  xsltText = replaceBalancedCalls(xsltText, "crm:FormatPeriod", (args) => `string(${args?.[0]?.trim() || "''"})`);
  xsltText = replaceBalancedCalls(xsltText, "crm:FormatReference", (args) => `string(${args?.[0]?.trim() || "''"})`);
  xsltText = replaceBalancedCalls(xsltText, "crm:AddSpacing", (args) => `string(${args?.[0]?.trim() || "''"})`);
  xsltText = replaceBalancedCalls(xsltText, "crm:Replace", (args) => `string(${args?.[0]?.trim() || "''"})`);

  // Barcode stub
  xsltText = xsltText.replace(
    /<xsl:template\b[^>]*\bname=(["'])Barcode\1[^>]*>[\s\S]*?<\/xsl:template>/i,
    () => `
<xsl:template name="Barcode">
  <xsl:param name="value"/>
  <block font-size="8pt" color="#666666" padding-top="2mm">
    [BARCODE: <xsl:value-of select="string($value)"/> ]
  </block>
  <block-container height="6mm" width="100%" background-color="#111111" opacity="0.12" margin-top="1mm"/>
</xsl:template>
`.trim()
  );

  return xsltText;
}

// -------------------------
// FO -> PDF-look renderer
// -------------------------
const FO_NS = "http://www.w3.org/1999/XSL/Format";
function foAttr(el, name) { return el?.getAttribute?.(name) ?? ""; }

function cssFromFo(el) {
  const css = [];
  const props = [
    ["font-size", "font-size"], ["font-weight", "font-weight"], ["font-style", "font-style"],
    ["text-align", "text-align"], ["line-height", "line-height"], ["color", "color"],
    ["background-color", "background"], ["margin-top", "margin-top"], ["margin-bottom", "margin-bottom"],
    ["space-before", "margin-top"], ["space-after", "margin-bottom"],
    ["padding-top", "padding-top"], ["padding-bottom", "padding-bottom"],
    ["padding-before", "padding-top"], ["padding-after", "padding-bottom"],
    ["padding-left", "padding-left"], ["padding-right", "padding-right"],
    ["border-bottom", "border-bottom"], ["border-top", "border-top"],
    ["text-decoration", "text-decoration"]
  ];
  for (const [fo, cssName] of props) {
    const v = foAttr(el, fo);
    if (v) css.push(`${cssName}:${v};`);
  }
  return css.join("");
}

function createSheet() {
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const header = document.createElement("div");
  header.className = "header";
  const content = document.createElement("div");
  content.className = "content";
  const footer = document.createElement("div");
  footer.className = "footer";
  sheet.appendChild(header);
  sheet.appendChild(content);
  sheet.appendChild(footer);
  return { sheet, header, content, footer };
}

function renderListBlock(node, parent, ctx) {
  const ul = document.createElement("div");
  ul.style.paddingLeft = "18px";
  parent.appendChild(ul);

  const items = Array.from(node.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE);
  for (const it of items) {
    if (it.namespaceURI === FO_NS && it.localName === "list-item") {
      const row = document.createElement("div");
      row.style.display = "grid";
      row.style.gridTemplateColumns = "32px 1fr";
      row.style.gap = "8px";
      ul.appendChild(row);

      const label = document.createElement("div");
      const body = document.createElement("div");
      row.appendChild(label);
      row.appendChild(body);

      for (const c of Array.from(it.childNodes)) {
        if (c.nodeType !== Node.ELEMENT_NODE) continue;
        if (c.namespaceURI === FO_NS && c.localName === "list-item-label") {
          Array.from(c.childNodes).forEach(ch => renderFoNode(ch, label, ctx));
        } else if (c.namespaceURI === FO_NS && c.localName === "list-item-body") {
          Array.from(c.childNodes).forEach(ch => renderFoNode(ch, body, ctx));
        }
      }
    }
  }
}

function renderFoNode(node, parent, ctx) {
  if (!node) return;

  if (node.nodeType === Node.TEXT_NODE) {
    const txt = node.nodeValue;
    if (txt && txt.trim() !== "") parent.appendChild(document.createTextNode(txt));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const ns = node.namespaceURI;
  const local = node.localName;

  if (ns === FO_NS) {
    if (local === "block") {
      const breakBefore = foAttr(node, "break-before");
      if (breakBefore === "page") {
        const next = createSheet();
        ctx.sheets.push(next.sheet);
        ctx.current = next;
        parent = next.content;
      }
      const div = document.createElement("div");
      const style = cssFromFo(node);
      if (style) div.setAttribute("style", style);
      parent.appendChild(div);
      Array.from(node.childNodes).forEach(ch => renderFoNode(ch, div, ctx));
      return;
    }

    if (local === "inline") {
      const span = document.createElement("span");
      const style = cssFromFo(node);
      if (style) span.setAttribute("style", style);
      parent.appendChild(span);
      Array.from(node.childNodes).forEach(ch => renderFoNode(ch, span, ctx));
      return;
    }

    if (local === "table") {
      const table = document.createElement("table");
      table.style.cssText = "border-collapse:collapse;width:100%;";
      const style = cssFromFo(node);
      if (style) table.setAttribute("style", table.getAttribute("style") + style);
      parent.appendChild(table);
      Array.from(node.childNodes).forEach(ch => renderFoNode(ch, table, ctx));
      return;
    }
    if (local === "table-body") {
      const tbody = document.createElement("tbody");
      parent.appendChild(tbody);
      Array.from(node.childNodes).forEach(ch => renderFoNode(ch, tbody, ctx));
      return;
    }
    if (local === "table-row") {
      const tr = document.createElement("tr");
      parent.appendChild(tr);
      Array.from(node.childNodes).forEach(ch => renderFoNode(ch, tr, ctx));
      return;
    }
    if (local === "table-cell") {
      const td = document.createElement("td");
      td.style.cssText = "vertical-align:top;padding:2px 4px;" + cssFromFo(node);
      const span = foAttr(node, "number-columns-spanned");
      if (span) td.colSpan = parseInt(span, 10) || 1;
      parent.appendChild(td);
      Array.from(node.childNodes).forEach(ch => renderFoNode(ch, td, ctx));
      return;
    }

    if (local === "external-graphic") {
      const ph = document.createElement("div");
      ph.title = foAttr(node, "src") || "external-graphic";
      ph.style.cssText =
        "display:inline-block;width:180px;height:44px;" +
        "background:linear-gradient(90deg,#0ea5e9,#6366f1);" +
        "border-radius:6px;opacity:.85;margin:2px 0;";
      parent.appendChild(ph);
      return;
    }

    if (local === "basic-link") {
      const a = document.createElement("a");
      a.href = (foAttr(node, "external-destination") || "#").replace(/^url\((.*)\)$/i, "$1");
      a.target = "_blank";
      a.rel = "noopener";
      const style = cssFromFo(node);
      if (style) a.setAttribute("style", style);
      parent.appendChild(a);
      Array.from(node.childNodes).forEach(ch => renderFoNode(ch, a, ctx));
      return;
    }

    if (local === "list-block") {
      renderListBlock(node, parent, ctx);
      return;
    }

    if (local === "flow" || local === "page-sequence" || local === "root") {
      Array.from(node.childNodes).forEach(ch => renderFoNode(ch, parent, ctx));
      return;
    }

    if (local === "layout-master-set") return;

    Array.from(node.childNodes).forEach(ch => renderFoNode(ch, parent, ctx));
    return;
  }

  Array.from(node.childNodes).forEach(ch => renderFoNode(ch, parent, ctx));
}

function renderFoDocumentToPdfLook(outDoc) {
  const foRoot =
    outDoc?.documentElement?.namespaceURI === FO_NS && outDoc?.documentElement?.localName === "root"
      ? outDoc.documentElement
      : outDoc?.getElementsByTagNameNS?.(FO_NS, "root")?.[0] || null;

  if (!foRoot) return null;

  const first = createSheet();
  const ctx = { sheets: [first.sheet], current: first };

  const pageSeqs = Array.from(foRoot.getElementsByTagNameNS(FO_NS, "page-sequence"));

  if (pageSeqs.length === 0) {
    renderFoNode(foRoot, first.content, ctx);
  } else {
    for (const seq of pageSeqs) {
      const statics = Array.from(seq.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE && n.namespaceURI === FO_NS && n.localName === "static-content");
      const flows = Array.from(seq.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE && n.namespaceURI === FO_NS && n.localName === "flow");

      const headerNodes = statics.filter(s => (foAttr(s, "flow-name") || "").includes("region-before"));
      const footerNodes = statics.filter(s => (foAttr(s, "flow-name") || "").includes("region-after"));

      headerNodes.forEach(s => {
        const box = document.createElement("div");
        box.style.cssText = "padding-bottom:10px;border-bottom:1px solid rgba(0,0,0,.08);margin-bottom:12px;";
        ctx.current.header.appendChild(box);
        Array.from(s.childNodes).forEach(ch => renderFoNode(ch, box, ctx));
      });

      footerNodes.forEach(s => {
        const box = document.createElement("div");
        box.style.cssText = "padding-top:10px;border-top:1px solid rgba(0,0,0,.08);margin-top:12px;";
        ctx.current.footer.appendChild(box);
        Array.from(s.childNodes).forEach(ch => renderFoNode(ch, box, ctx));
      });

      if (flows.length === 0) {
        renderFoNode(seq, ctx.current.content, ctx);
      } else {
        flows.forEach(f => renderFoNode(f, ctx.current.content, ctx));
      }
    }
  }

  const wrapper = document.createElement("div");
  wrapper.style.display = "grid";
  wrapper.style.gap = "18px";
  ctx.sheets.forEach(s => wrapper.appendChild(s));
  return wrapper;
}

// -------------------------
// Output detection
// -------------------------
function detectXsltOutput(xsltText, outDoc, resultText) {
  if (outDoc && isParserError(outDoc)) return "PARSERERROR";

  const xslt = (xsltText || "").toLowerCase();
  const result = (resultText || "").toLowerCase();

  const de = outDoc?.documentElement;
  if (de?.namespaceURI === FO_NS && de?.localName === "root") return "XSL-FO";
  if (outDoc?.getElementsByTagNameNS?.(FO_NS, "root")?.length) return "XSL-FO";

  const rootName = de?.localName?.toLowerCase?.() || "";
  if (rootName === "html") return "HTML";

  if (xslt.includes('method="html"') || xslt.includes("method='html'")) return "HTML";
  if (xslt.includes('method="text"') || xslt.includes("method='text'")) return "TEXT";

  if (result.includes("http://www.w3.org/1999/xsl/format") && result.includes("<root")) return "XSL-FO";
  if (result.includes("<html") || result.includes("<!doctype html")) return "HTML";
  if (result.includes("<fo:root") || result.includes("fo:root")) return "XSL-FO";

  return "UNKNOWN";
}

// -------------------------
// DTO page renderer
// -------------------------
function renderDtoPage(settings) {
  const host = document.getElementById("previewDto");
  if (!host) return;

  const typeLabel = ({
    sales: "Sales agreement (SupplyAgreementDto)",
    grid: "Grid / network agreement (SalesContractDto)",
    invoice: "Invoice (Finvoice)",
    deposit: "Security deposit receipt (SecurityDepositReceiptDto)",
    auto: "Auto (from XSLT match)"
  })[settings.type] || settings.type;

  host.innerHTML = `
    <div class="dtoPage">
      <h2>DTO Info</h2>

      <div class="dtoCard">
        <h3>Current selection</h3>
        <div><b>Document type:</b> ${escapeHtml(typeLabel)}</div>
        <div><b>Locked root:</b> ${escapeHtml(settings.wantedRoot)}</div>
        <div><b>Detected from XSLT:</b> ${escapeHtml(settings.detectedRoot)}</div>
        <div><b>Match candidates:</b> ${escapeHtml((settings.candidates || []).join(", ") || "-")}</div>
        <div><b>Decode mode:</b> ${escapeHtml(settings.decodeMode)}</div>
      </div>

      <div class="dtoCard">
        <h3>What this means</h3>
        <ul>
          <li><b>Locked root</b> controls which test XML root is generated.</li>
          <li><b>Detected root</b> is extracted from <code>xsl:template match="..."</code> patterns.</li>
          <li>If Locked ≠ Detected and Lock is enabled, the preview may not hit templates (root mismatch).</li>
        </ul>
      </div>

      <div class="dtoCard">
        <h3>Credits</h3>
        <div><b>Creator:</b> Teemu Leisto</div>
      </div>
    </div>
  `;
}

// -------------------------
// Diagnostics (minimal)
// -------------------------
function renderDiagnostics(issues) {
  const host = document.getElementById("diag");
  if (!host) return;
  host.innerHTML = "";

  if (!issues || issues.length === 0) {
    host.innerHTML = `<div class="diagItem info"><h4>OK</h4><div class="meta">No blocking issues detected.</div></div>`;
    return;
  }

  for (const it of issues) {
    const cls = it.severity === "ERROR" ? "error" : it.severity === "WARN" ? "warn" : "info";
    host.innerHTML += `
      <div class="diagItem ${cls}">
        <h4>${escapeHtml(it.title || it.code || "Notice")}</h4>
        <div class="meta">${escapeHtml(it.severity || "INFO")} • ${escapeHtml(it.code || "GENERIC")}</div>
        <div>${escapeHtml(it.message || "")}</div>
        ${it.fix ? `<div class="fix"><b>Fix:</b> ${escapeHtml(it.fix)}</div>` : ""}
        ${it.snippet ? `<pre>${escapeHtml(it.snippet)}</pre>` : ""}
      </div>
    `;
  }
}

function diagnoseQuick({ xsltNorm, xmlNorm, xsltDoc, xmlDoc, outDoc, outText, includesRefs }) {
  const issues = [];
  const add = (severity, code, title, message, fix, snippet) =>
    issues.push({ severity, code, title, message, fix, snippet });

  if (xmlNorm && xmlNorm.trim().startsWith("&lt;")) {
    add("ERROR", "XML_ESCAPED", "Source XML looks escaped (&lt;...)", "XML is still escaped. It must be decoded to real <tag> form.", "Paste real XML or use decode mode Aggressive.", xmlNorm.slice(0, 160));
  }
  if (xsltNorm && xsltNorm.trim().startsWith("&lt;")) {
    add("ERROR", "XSLT_ESCAPED", "XSLT looks escaped (&lt;...)", "XSLT is still escaped. It must be decoded to real <xsl:...> form.", "Use decode mode Aggressive or fix the template source.", xsltNorm.slice(0, 160));
  }
  if (xmlDoc && isParserError(xmlDoc)) add("ERROR", "XML_PARSE", "Source XML parsererror", "Source XML is not valid XML.", "Fix XML or regenerate test data.", "");
  if (xsltDoc && isParserError(xsltDoc)) add("ERROR", "XSLT_PARSE", "XSLT parsererror", "Stylesheet is not valid XML.", "Fix XSLT (often broken include/import or copy/paste escaping).", "");
  if (outDoc && isParserError(outDoc)) {
    const pe = outDoc.getElementsByTagName("parsererror")[0];
    add("ERROR", "XSLT_RUNTIME", "Transform returned parsererror document", (pe?.textContent || "parsererror").slice(0, 300), "Check crm:* functions and root mismatch.", outText?.slice(0, 220));
  }
  if (includesRefs?.length && !baseDir) add("WARN", "INCLUDES_BASEDIR", "include/import found but baseDir missing", `Found ${includesRefs.length} include/import references.`, "Pick base directory.", "");
  return issues;
}

// -------------------------
// Test XML generation (real XML)
// -------------------------
function isXmlEffectivelyEmpty(xmlText) {
  if (!xmlText) return true;
  const stripped = xmlText
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, "");
  return stripped.length === 0;
}

function getAgreementKind() {
  const el = document.getElementById("agreementKind");
  return (el?.value || "grid").toLowerCase();
}

function p(...ids) {
  for (const id of ids) {
    const v = val(id);
    if (v !== null && v !== undefined && String(v).trim() !== "") return v;
  }
  return "";
}

// DTO aliases + smart builder
const DTO_ALIASES = {
  GridAgreementDto: "SupplyAgreementDto",
  HeatingAgreementDto: "SupplyAgreementDto",
  ElectricitySalesAgreementDto: "SupplyAgreementDto",
  AgreementDto: "SupplyAgreementDto",
  InvoiceDto: "Finvoice"
};

function buildSmartTestXml(rootName, xsltText = "") {
  const aliased = DTO_ALIASES[rootName] || rootName;
  try {
    const out = buildTestXml(aliased);
    if (out && String(out).trim()) return out;
  } catch (e) {
    log(`WARN: buildTestXml failed for ${aliased}: ${e?.message || e}`);
  }
  return buildHybridXml(aliased, xsltText);
}

function sampleValueFor(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("date")) return "2026-03-10";
  if (n.includes("amount") || n.includes("sum") || n.includes("price")) return "100.00";
  if (n.includes("percent") || n.includes("vat")) return "24";
  if (n.includes("id")) return "123456";
  if (n.includes("address")) return "Testikatu 1 A 2";
  if (n.includes("name")) return "Testaaja Testi";
  return "TEST";
}

function extractElementNamesFromXslt(xsltText) {
  xsltText = normalizeXmlText(xsltText);
  const names = new Set();

  const attrRe = /\b(?:select|match|test)=["']([^"']+)["']/gi;
  let m;
  while ((m = attrRe.exec(xsltText)) !== null) {
    const expr = (m[1] || "");
    const tokens = expr
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/[@()=<>!+*\-|,]/g, " ")
      .split(/[\s/]+/g)
      .map(t => t.trim())
      .filter(Boolean)
      .map(t => t.includes(":") ? t.split(":").pop() : t)
      .filter(t => /^[A-Za-z_][\w.-]*$/.test(t))
      .filter(t => !["xsl", "fo", "text", "node"].includes(t.toLowerCase()));
    tokens.forEach(t => names.add(t));
  }

  return [...names].slice(0, 120);
}

function buildHybridXml(rootName, xsltText = "") {
  const elNames = extractElementNamesFromXslt(xsltText);

  const common = `
  <OutputDate>2026-03-10</OutputDate>
  <FirstDate>2026-04-01</FirstDate>
  <PeriodFirstDate>2026-04-01</PeriodFirstDate>
  <LastDate></LastDate>
  <VatRatePercent>24</VatRatePercent>

  <OwnerClient ID="123456">
    <isBusinessCustomer>false</isBusinessCustomer>
    <Name>Testaaja Testi</Name>
    <LastNameFirst>Testaaja Testi</LastNameFirst>
    <Code>123456-789A</Code>
    <Address>
      <PostalAddressPrint>Testikatu 1 A 2&#x0A;00100 Helsinki</PostalAddressPrint>
      <PostalAddress1>Testikatu 1 A 2</PostalAddress1>
      <PostalCode>00100</PostalCode>
      <City>Helsinki</City>
    </Address>
  </OwnerClient>

  <MeteringPoint>
    <GridOperator>ESIMERKKIVERKKO OY</GridOperator>
  </MeteringPoint>

  <Object ID="KP-001">
    <FinnishMeteringPointID>123456789012345678</FinnishMeteringPointID>
    <AddressLines>Testikäyttöpaikantie 1 A 2&#x0A;00100 Helsinki</AddressLines>
    <Address>Testikäyttöpaikantie 1 A 2&#x0A;00100 Helsinki</Address>
    <PostCode>00100</PostCode>
    <Settlement>Helsinki</Settlement>
    <CadastralCode>001-002-0003-0004</CadastralCode>
  </Object>

  <Product>
    <ID>100</ID>
    <Name>Esimerkkituote</Name>
    <IsNpsProduct>true</IsNpsProduct>
    <IsLegalEntity>false</IsLegalEntity>
    <Margin>0.30</Margin>
    <MarginWithVat>0.37</MarginWithVat>
    <MonthlyFee>5.00</MonthlyFee>
    <MonthlyFeeWithVat>6.20</MonthlyFeeWithVat>
    <Tariff>
      <BasePrice>9.50</BasePrice>
      <BasePriceWithVat>11.78</BasePriceWithVat>
    </Tariff>
  </Product>
`.trim();

  const covered = new Set([
    "OutputDate","FirstDate","PeriodFirstDate","LastDate","VatRatePercent",
    "OwnerClient","MeteringPoint","Object","Product",
    "Name","Code","Address","PostalAddressPrint","FinnishMeteringPointID","GridOperator",
    "Tariff","BasePrice","BasePriceWithVat"
  ]);

  const extraLeaves = elNames
    .filter(n => !covered.has(n))
    .filter(n => !/Dto$/i.test(n))
    .slice(0, 40)
    .map(n => `  <${n}>${escapeXml(sampleValueFor(n))}</${n}>`)
    .join("\n");

  return `
<${rootName}>
${common}
${extraLeaves ? "\n" + extraLeaves : ""}
</${rootName}>
`.trim();
}

// NOTE: buildTestXml(...) is unchanged from your version.
// Paste your existing buildTestXml(rootName) here if it is in another file.
// (In your paste it's already included and long; keep it as-is.)
//
// For brevity, I assume you keep your existing buildTestXml exactly same.
// If you want me to re-paste it verbatim too, say "liitä buildTestXml mukaan" and I’ll output the full block.
//
// -------------------------
// !!! IMPORTANT !!!
// If your buildTestXml function is in this same file already, keep it.
// -------------------------

// -------------------------
// Transform runner
// -------------------------
async function runTransform(xsltTextInput, xmlTextInput) {
  const parser = new DOMParser();

  const xsltTextInputNorm = normalizeXmlText(xsltTextInput);
  const xmlText = normalizeXmlText(xmlTextInput);

  const includesRefs = getIncludeImportRefs(xsltTextInputNorm);

  if (isXmlEffectivelyEmpty(xmlText)) {
    log(t("xmlParseError"));
    log(t("tipXml"));
    renderDiagnostics([{
      severity: "ERROR",
      code: "XML_EMPTY",
      title: "Source XML is empty",
      message: "Paste valid XML or regenerate test data.",
      fix: "Use 'Update test data' or 'Generate test XML'."
    }]);
    return;
  }

  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  if (isParserError(xmlDoc)) {
    log(t("xmlParseError"));
    const pe = xmlDoc.getElementsByTagName("parsererror")[0];
    if (pe) log(("XML parsererror: " + (pe.textContent || "")).slice(0, 300));
    log(t("tipXml"));
    renderDiagnostics(diagnoseQuick({
      xsltNorm: xsltTextInputNorm, xmlNorm: xmlText, xsltDoc: null, xmlDoc, outDoc: null, outText: "", includesRefs
    }));
    return;
  }

  // Compat mode auto if crm:* exists
  const compatCheckbox = document.getElementById("compatMode");
  const compatWantedByUser = !!compatCheckbox?.checked;
  const crmDetected = /\bcrm:([A-Za-z_]\w*)\s*\(/.test(xsltTextInputNorm) || /\$crm:appdata\b/.test(xsltTextInputNorm);
  const compat = compatWantedByUser || crmDetected;

  if (crmDetected && !compatWantedByUser) log("INFO: crm:* detected → compat patch auto-enabled for preview.");

  const xsltText = compat ? patchCrmFunctionsForPreview(xsltTextInputNorm) : xsltTextInputNorm;

  const xsltDoc = parser.parseFromString(xsltText, "text/xml");
  if (isParserError(xsltDoc)) {
    log(t("xsltParseError"));
    const pe = xsltDoc.getElementsByTagName("parsererror")[0];
    if (pe) log(("XSLT parsererror: " + (pe.textContent || "")).slice(0, 300));
    renderDiagnostics(diagnoseQuick({
      xsltNorm: xsltText, xmlNorm: xmlText, xsltDoc, xmlDoc, outDoc: null, outText: "", includesRefs
    }));
    return;
  }

  const processor = new XSLTProcessor();
  try {
    processor.importStylesheet(xsltDoc);
  } catch (e) {
    log("ERROR: importStylesheet failed: " + (e?.message || e));
    return;
  }

  let outDoc;
  try {
    outDoc = processor.transformToDocument(xmlDoc);
  } catch (e) {
    log("ERROR: transformToDocument threw: " + (e?.message || e));
    return;
  }

  const raw = serializeNodeSafe(outDoc) || "";
  log("DEBUG: transform done. serialized length = " + raw.length);

  const foOutEl = document.getElementById("foOut");
  if (foOutEl) foOutEl.textContent = raw ? prettyXml(raw) : "(empty result)";

  const outputType = detectXsltOutput(xsltText, outDoc, raw);
  document.getElementById("xsltAnalysis")?.replaceChildren(document.createTextNode("Detected output: " + outputType));
  log("DEBUG: outputType = " + outputType);

  renderDiagnostics(diagnoseQuick({
    xsltNorm: xsltText, xmlNorm: xmlText, xsltDoc, xmlDoc, outDoc, outText: raw, includesRefs
  }));

  const pdfArea = document.getElementById("previewPdf");
  if (pdfArea) pdfArea.innerHTML = "";

  if (outputType === "PARSERERROR") {
    log("ERROR: Output is parsererror → showing raw output.");
    showRawPreview(raw);
    return;
  }

  if (outputType === "XSL-FO") {
    const rendered = renderFoDocumentToPdfLook(outDoc);
    if (rendered) {
      pdfArea?.appendChild(rendered);
      setTab("pdf");
      log("DEBUG: FO rendered OK.");
    } else {
      pdfArea.textContent = t("foRootMissing");
      log("ERROR: " + t("foRootMissing"));
    }
    return;
  }

  if (outputType === "HTML") {
    const rt = raw.trim();
    if (rt.includes("<parsererror") || rt.includes("&lt;parsererror")) {
      log("WARN: HTML contains parsererror → showing raw.");
      showRawPreview(raw);
      return;
    }
    showHtmlPreview(raw);
    return;
  }

  showRawPreview(raw);
}

function showHtmlPreview(resultText) {
  const area = document.getElementById("previewPdf");
  if (!area) return;
  area.innerHTML = resultText || "";
  setTab("pdf");
}

function showRawPreview(resultText) {
  const area = document.getElementById("previewPdf");
  if (!area) return;
  area.textContent = resultText || "";
  setTab("pdf");
}

// -------------------------
// UI actions
// -------------------------
async function generatePreviewFromFile() {
  log(t("previewStarted"));

  const xsltFileEl = document.getElementById("xsltFile");
  const file = xsltFileEl?.files?.[0];

  const xsltEditor = document.getElementById("xsltEditor");
  const xmlEditor  = document.getElementById("xmlEditor");

  // 1) If no file selected, fall back to editor content
  if (!file) {
    const xsltFromEditor = xsltEditor?.value || "";
    if (!xsltFromEditor.trim()) {
      log(t("noXslt"));
      alert(t("noXslt"));
      return;
    }

    // ✅ FIX: snapshot for "Reset to loaded" when working directly in editor
    if (!loadedXsltText && xsltFromEditor.trim()) {
      loadedXsltText = xsltFromEditor;
      log("INFO: loadedXsltText snapshot set from editor (no file selected).");
    }

    let xsltResolved = xsltFromEditor;
    try { xsltResolved = await resolveIncludes(xsltResolved); }
    catch (e) { log("WARN: include resolver error: " + (e?.message || e)); }

    const settings = getDocSettings(xsltResolved);
    xsltResolved = normalizeByMode(xsltResolved, settings.decodeMode);

    lastDetectedRoot = settings.wantedRoot;
    lastDetectedByXslt = settings.detectedRoot;
    lastDetectedCandidates = settings.candidates;

    // Root changed => regenerate XML
    const currentRoot = (() => {
      try {
        const d = new DOMParser().parseFromString(normalizeByMode(xmlEditor?.value || "", settings.decodeMode), "text/xml");
        return d?.documentElement?.localName || "";
      } catch { return ""; }
    })();

    if (!xmlEditor?.value || isXmlEffectivelyEmpty(xmlEditor.value) || currentRoot !== settings.wantedRoot) {
      xmlEditor.value = buildSmartTestXml(settings.wantedRoot, xsltResolved);
      log(`INFO: XML regenerated for root: ${settings.wantedRoot} (prev: ${currentRoot || "-"})`);
    }

    renderDtoPage(settings);
    await runTransform(xsltResolved, xmlEditor?.value || "");
    return;
  }

  // 2) File path
  let xsltText = await file.text();
  loadedXsltText = xsltText; // file snapshot

  let xsltResolved = xsltText;
  try { xsltResolved = await resolveIncludes(xsltText); }
  catch (e) { log("WARN: include resolver error: " + (e?.message || e)); }

  const settings = getDocSettings(xsltResolved);
  xsltResolved = normalizeByMode(xsltResolved, settings.decodeMode);

  lastDetectedRoot = settings.wantedRoot;
  lastDetectedByXslt = settings.detectedRoot;
  lastDetectedCandidates = settings.candidates;

  if (xsltEditor) xsltEditor.value = xsltResolved;

  const currentRoot = (() => {
    try {
      const d = new DOMParser().parseFromString(normalizeByMode(xmlEditor?.value || "", settings.decodeMode), "text/xml");
      return d?.documentElement?.localName || "";
    } catch { return ""; }
  })();

  if (xmlEditor && (!xmlEditor.value || isXmlEffectivelyEmpty(xmlEditor.value) || currentRoot !== settings.wantedRoot)) {
    xmlEditor.value = buildSmartTestXml(settings.wantedRoot, xsltResolved);
    log(`INFO: XML regenerated for root: ${settings.wantedRoot} (prev: ${currentRoot || "-"})`);
  }

  renderDtoPage(settings);
  await runTransform(xsltResolved, xmlEditor?.value || "");
}

async function runFromEditors() {
  let xsltText = document.getElementById("xsltEditor")?.value || "";
  const xmlEditor = document.getElementById("xmlEditor");
  let xmlText = xmlEditor?.value || "";

  if (!xsltText.trim()) { log("ERROR: XSLT editor empty"); return; }

  // ✅ FIX: snapshot for "Reset to loaded" when user runs from editor
  if (!loadedXsltText && xsltText.trim()) {
    loadedXsltText = xsltText;
    log("INFO: loadedXsltText snapshot set from editor run.");
  }

  try { xsltText = await resolveIncludes(xsltText); }
  catch (e) { log("WARN: include resolver error (editor run): " + (e?.message || e)); }

  const settings = getDocSettings(xsltText);
  xsltText = normalizeByMode(xsltText, settings.decodeMode);

  lastDetectedRoot = settings.wantedRoot;
  lastDetectedByXslt = settings.detectedRoot;
  lastDetectedCandidates = settings.candidates;

  const currentRoot = (() => {
    try {
      const d = new DOMParser().parseFromString(normalizeByMode(xmlText, settings.decodeMode), "text/xml");
      return d?.documentElement?.localName || "";
    } catch { return ""; }
  })();

  if (!xmlText.trim() || isXmlEffectivelyEmpty(xmlText) || (settings.lock && currentRoot && currentRoot !== settings.wantedRoot)) {
    xmlText = buildSmartTestXml(settings.wantedRoot, xsltText);
    if (xmlEditor) xmlEditor.value = xmlText;
    log(`INFO: XML regenerated for root: ${settings.wantedRoot} (prev: ${currentRoot || "-"})`);
  }

  renderDtoPage(settings);
  await runTransform(xsltText, xmlText);
}

function resetXslt() {
  const xsltEditor = document.getElementById("xsltEditor");
  if (!xsltEditor) return;

  if (loadedXsltText && loadedXsltText.trim()) {
    xsltEditor.value = loadedXsltText;
    log("XSLT reset to loaded snapshot.");
  } else {
    log("WARN: No loaded snapshot found. Tip: load a file or run once from editor to create snapshot.");
  }
}

async function saveXslt() {
  const xsltText = document.getElementById("xsltEditor")?.value || "";
  if (!xsltText.trim()) return;

  if (window.api?.saveTextFile) {
    const res = await window.api.saveTextFile("template-edited.xslt", xsltText);
    log(res.ok ? `Saved: ${res.filePath}` : "Save canceled");
  } else {
    // ✅ FIX: browser fallback
    downloadTextFile("template-edited.xslt", xsltText, "application/xml;charset=utf-8");
    log("Saved via browser download (Electron API missing).");
  }
}

async function saveXml() {
  const xmlText = document.getElementById("xmlEditor")?.value || "";
  if (!xmlText.trim()) return;

  if (window.api?.saveTextFile) {
    const res = await window.api.saveTextFile("source.xml", xmlText);
    log(res.ok ? `Saved: ${res.filePath}` : "Save canceled");
  } else {
    // ✅ FIX: browser fallback
    downloadTextFile("source.xml", xmlText, "application/xml;charset=utf-8");
    log("Saved via browser download (Electron API missing).");
  }
}

function generateXmlFromRoot() {
  const xmlEditor = document.getElementById("xmlEditor");
  if (!xmlEditor) return;

  const xsltText = document.getElementById("xsltEditor")?.value || loadedXsltText || "";

  // ✅ FIX: always compute current settings/root from current XSLT
  const settings = getDocSettings(xsltText);
  lastDetectedRoot = settings.wantedRoot;
  lastDetectedByXslt = settings.detectedRoot;
  lastDetectedCandidates = settings.candidates;

  xmlEditor.value = buildSmartTestXml(settings.wantedRoot || "SupplyAgreementDto", xsltText);
  log("Test XML generated (button). Root: " + (settings.wantedRoot || "SupplyAgreementDto"));

  renderDtoPage(settings);
}

function clearAll() {
  const f = document.getElementById("xsltFile");
  if (f) f.value = "";
  document.getElementById("previewPdf") && (document.getElementById("previewPdf").innerHTML = "");
  document.getElementById("foOut") && (document.getElementById("foOut").textContent = "");
  log(t("cleared"));
}

async function pickBaseDir() {
  if (!window.api?.pickBaseDirectory) {
    log("ERROR: base directory picker requires Electron preload/IPC.");
    return;
  }
  const res = await window.api.pickBaseDirectory();
  if (res.ok) {
    baseDir = res.dir;
    const info = document.getElementById("baseDirInfo");
    if (info) info.textContent = "Base: " + baseDir;
    log(t("baseDirSet") + baseDir);
  } else log(t("baseDirCanceled"));
}

function updateXmlFromTestParams({ runAfter = true } = {}) {
  const xmlEditor = document.getElementById("xmlEditor");
  if (!xmlEditor) return;

  const xsltText = document.getElementById("xsltEditor")?.value || loadedXsltText || "";
  const settings = getDocSettings(xsltText);

  lastDetectedRoot = settings.wantedRoot;

  xmlEditor.value = buildSmartTestXml(settings.wantedRoot, xsltText);
  log(`Test XML updated from params. Root: ${settings.wantedRoot} (detected: ${settings.detectedRoot})`);

  renderDtoPage(settings);

  if (runAfter) {
    const xsltRun = document.getElementById("xsltEditor")?.value || loadedXsltText || "";
    if (xsltRun.trim()) runTransform(xsltRun, xmlEditor.value);
  }
}

// -------------------------
// Find-in-textarea (optional)
// -------------------------
function findInTextarea(textarea, query, direction = 1, caseSensitive = false) {
  if (!textarea) return false;
  const text = textarea.value || "";
  if (!query) return false;

  const make = (s) => caseSensitive ? s : s.toLowerCase();
  const needle = make(query);

  const selStart = textarea.selectionStart ?? 0;
  const selEnd = textarea.selectionEnd ?? selStart;
  let startPos = direction > 0 ? selEnd : selStart - 1;
  if (startPos < 0) startPos = 0;

  const hay = make(text);

  let idx = -1;
  if (direction > 0) {
    idx = hay.indexOf(needle, startPos);
    if (idx === -1) idx = hay.indexOf(needle, 0);
  } else {
    idx = hay.lastIndexOf(needle, startPos);
    if (idx === -1) idx = hay.lastIndexOf(needle);
  }

  if (idx === -1) return false;
  textarea.focus();
  textarea.setSelectionRange(idx, idx + query.length);
  return true;
}

function wireFind(inputId, prevBtnId, nextBtnId, caseId, textareaId) {
  const input = document.getElementById(inputId);
  const prevBtn = document.getElementById(prevBtnId);
  const nextBtn = document.getElementById(nextBtnId);
  const caseBox = document.getElementById(caseId);
  const ta = document.getElementById(textareaId);
  if (!input || !prevBtn || !nextBtn || !caseBox || !ta) return;

  const doFind = (dir) => {
    const q = input.value || "";
    const ok = findInTextarea(ta, q, dir, caseBox.checked);
    if (!ok && q.trim()) {
      input.classList.add("notfound");
      setTimeout(() => input.classList.remove("notfound"), 250);
    }
  };

  prevBtn.addEventListener("click", () => doFind(-1));
  nextBtn.addEventListener("click", () => doFind(+1));

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); doFind(e.shiftKey ? -1 : +1); }
    if (e.key === "Escape") { input.value = ""; input.blur(); }
  });

  caseBox.addEventListener("change", () => doFind(+1));
}

// -------------------------
// Events
// -------------------------
window.addEventListener("DOMContentLoaded", () => {
  // Tabs
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  // ✅ FIX: Robust button handling (works even if IDs duplicated or UI re-rendered)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    switch (btn.id) {
      case "previewBtn": generatePreviewFromFile(); break;
      case "runFromEditorBtn": runFromEditors(); break;
      case "genXmlBtn": generateXmlFromRoot(); break;
      case "saveXsltBtn": saveXslt(); break;
      case "saveXmlBtn": saveXml(); break;
      case "resetXsltBtn": resetXslt(); break;
      case "clearBtn": clearAll(); break;
      case "pickBaseDirBtn": pickBaseDir(); break;

      case "langFiBtn": setLang("fi"); break;
      case "langEnBtn": setLang("en"); break;

      case "updateTestDataBtn":
      case "updateTestDataBtn2": {
        const auto = document.getElementById("autoRunOnUpdate")?.checked ?? true;
        updateXmlFromTestParams({ runAfter: auto });
        break;
      }
    }
  }, true);

  // Find wiring
  if (typeof wireFind === "function") {
    wireFind("findXslt", "findXsltPrev", "findXsltNext", "findXsltCase", "xsltEditor");
    wireFind("findXml", "findXmlPrev", "findXmlNext", "findXmlCase", "xmlEditor");
  }

  // DocType + decode rules change => regen XML + optional run
  function onDocRuleChange() {
    const xsltText = document.getElementById("xsltEditor")?.value || loadedXsltText || "";
    if (!xsltText.trim()) return;

    const settings = getDocSettings(xsltText);
    lastDetectedRoot = settings.wantedRoot;
    lastDetectedByXslt = settings.detectedRoot;
    lastDetectedCandidates = settings.candidates;

    const xmlEditor = document.getElementById("xmlEditor");
    if (xmlEditor) {
      xmlEditor.value = buildSmartTestXml(settings.wantedRoot, xsltText);
      log(`INFO: DocType changed → XML regenerated for ${settings.wantedRoot}`);
    }

    renderDtoPage(settings);

    const auto = document.getElementById("autoRunOnUpdate")?.checked ?? true;
    if (auto) runTransform(xsltText, xmlEditor?.value || "");
  }

  document.getElementById("docType")?.addEventListener("change", onDocRuleChange);
  document.getElementById("lockDocType")?.addEventListener("change", onDocRuleChange);
  document.getElementById("decodeMode")?.addEventListener("change", onDocRuleChange);

  // Init
  setTab("pdf");
  applyI18n();

  // render initial DTO page (even if empty)
  renderDtoPage(getDocSettings(document.getElementById("xsltEditor")?.value || ""));

  // Debug: confirm button counts (helps detect duplicate IDs)
  ["runFromEditorBtn","genXmlBtn","saveXsltBtn","saveXmlBtn","resetXsltBtn"].forEach(id => {
    const c = document.querySelectorAll("#" + id).length;
    log(`DEBUG: ${id} count=${c}`);
  });
});