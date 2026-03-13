// -------------------------
// Demo: hard time limit (24h) + hard lock
// -------------------------
const DEMO_LIMIT_HOURS = 24;

function getDemoState() {
  let started = localStorage.getItem("demoStartedAt");
  if (!started) {
    started = new Date().toISOString();
    localStorage.setItem("demoStartedAt", started);
  }
  const start = new Date(started).getTime();
  const now = Date.now();
  const limitMs = DEMO_LIMIT_HOURS * 60 * 60 * 1000;
  const elapsed = now - start;
  const expired = elapsed >= limitMs;
  const msLeft = Math.max(0, limitMs - elapsed);
  return { startedAt: started, expired, msLeft };
}
function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function hardLockDemoUI() {
  document.querySelectorAll("button, input, select, textarea").forEach(el => {
    el.disabled = true;
    if (el.tagName === "TEXTAREA") el.readOnly = true;
  });
  const overlay = document.getElementById("demoLockOverlay");
  if (overlay) overlay.style.display = "flex";
}

function guardDemoOrLock() {
  const st = getDemoState();
  if (!st.expired) return true;
  hardLockDemoUI();
  return false;
}

function updateDemoBadge() {
  const st = getDemoState();
  const dot = document.getElementById("demoDot");
  const txt = document.getElementById("demoStatus");
  if (!dot || !txt) return;

  if (st.expired) {
    dot.className = "dot err";
    txt.textContent = "Demo expired";
  } else {
    const left = formatMs(st.msLeft);
    dot.className = st.msLeft < 2 * 60 * 60 * 1000 ? "dot warn" : "dot";
    txt.textContent = `Demo mode • time left: ${left}`;
  }
}

// -------------------------
// Global error trap
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
let loadedXmlText = "";
let loadedFileLabels = { xslt: "", xml: "" };

let lastDetectedRoot = "SupplyAgreementDto";
let lastDetectedCandidates = [];
let lastDetectedByXslt = "";

// -------------------------
// Minimal doc rules (demo)
// -------------------------
const DOC_RULES = {
  sales:   { root: "SupplyAgreementDto", decode: "smart" },
  invoice: { root: "Finvoice",          decode: "smart" },
  auto:    { root: null,                decode: "smart" }
};

function getDocSettings(xsltText = "") {
  const type = document.getElementById("docType")?.value || "auto";
  const lock = document.getElementById("lockDocType")?.checked ?? true;
  const decodeMode = document.getElementById("decodeMode")?.value || "smart";

  const detected = detectRootsFromXslt(xsltText);
  const autoRoot = detected?.bestRoot || "SupplyAgreementDto";
  const wantedRoot = (lock && DOC_RULES[type]?.root) ? DOC_RULES[type].root : autoRoot;

  return { type, lock, wantedRoot, detectedRoot: autoRoot, candidates: detected?.candidates || [], decodeMode };
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

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  // Insert line breaks between tags
  xml = xml.replace(/(>)(<)(\/*)/g, "$1\n$2$3");
  let pad = 0;
  return xml.split("\n").map(line => {
    const trimmed = line.trim();
    if (/^<\/\w/.test(trimmed)) pad = Math.max(pad - 1, 0);
    const indent = "  ".repeat(pad);
    if (/^<\w[^>]*[^\/]>.*$/.test(trimmed) && !trimmed.includes("</")) pad += 1;
    return indent + trimmed;
  }).join("\n");
}

function decodeEntities(s) {
  if (!s) return "";
  const ta = document.createElement("textarea");
  ta.innerHTML = s;
  return ta.value;
}

/**
 * Normalize XML/XSLT into real markup (<tag>),
 * supporting multi-pass decoding for &lt; and &amp;lt.
 */
function normalizeXmlText(text) {
  if (!text) return "";
  let s = String(text);

  for (let i = 0; i < 6; i++) {
    const t0 = s.trimStart();

    const containsEscaped =
      t0.startsWith("&lt;") || t0.startsWith("&amp;lt;") || t0.startsWith("&amp;amp;lt;") ||
      t0.includes("&lt;xsl:") || t0.includes("&amp;lt;xsl:") || t0.includes("&amp;amp;lt;xsl:") ||
      t0.includes("&lt;fo:")  || t0.includes("&amp;lt;fo:")  || t0.includes("&amp;amp;lt;fo:")  ||
      t0.includes("&lt;?xml") || t0.includes("&amp;lt;?xml") || t0.includes("&amp;amp;lt;?xml");

    if (!containsEscaped) break;

    const decoded = decodeEntities(s);
    if (decoded === s) break;
    s = decoded;

    // stop early if we have real markup now
    const hasRealTags = /<[A-Za-z?\/!]/.test(s.trimStart());
    const stillEscaped =
      s.includes("&lt;xsl:") || s.includes("&amp;lt;xsl:") || s.includes("&amp;amp;lt;xsl:") ||
      s.includes("&lt;fo:")  || s.includes("&amp;lt;fo:")  || s.includes("&amp;amp;lt;fo:");
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
      if (!s.includes("&lt;") && !s.includes("&amp;lt;") && !s.includes("&amp;amp;lt;")) break;
      const d = decodeEntities(s);
      if (d === s) break;
      s = d;
    }
    return s;
  }
  return normalizeXmlText(text);
}

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
// Tabs (FIXED)
// -------------------------
function setTab(tab) {
  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${tab}"]`)?.classList.add("active");

  const pdf = document.getElementById("previewPdf");
  const editors = document.getElementById("previewEditors");
  const dto = document.getElementById("previewDto");

  if (pdf) pdf.hidden = tab !== "pdf";
  if (editors) editors.hidden = tab !== "editors";
  if (dto) dto.hidden = tab !== "dto";
}

// -------------------------
// XSLT: detect roots (FIXED regex to real '<')
// -------------------------
function detectRootsFromXslt(xsltText) {
  // Work with normalized markup because presets may be escaped.
  xsltText = normalizeXmlText(xsltText);

  const matches = [];
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
// CRM compat patch (FIXED to real '<')
// -------------------------
function replaceBalancedCalls(text, fnName, replacer) {
  let i = 0, out = "";
  while (true) {
    const idx = text.indexOf(fnName, i);
    if (idx === -1) { out += text.slice(i); break; }
    out += text.slice(i, idx);

    let j = idx + fnName.length;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] !== "(") { out += fnName; i = j; continue; }

    let depth = 0, k = j;
    for (; k < text.length; k++) {
      const ch = text[k];
      if (ch === '"' || ch === "'") {
        const q = ch; k++;
        for (; k < text.length; k++) {
          const c = text[k];
          if (c === "\\") { k++; continue; }
          if (c === q) break;
        }
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") { depth--; if (depth === 0) { k++; break; } }
    }

    const inside = text.slice(j + 1, k - 1);
    const args = [];
    let buf = ""; depth = 0;

    for (let p = 0; p < inside.length; p++) {
      const ch = inside[p];
      if (ch === '"' || ch === "'") {
        const q = ch;
        buf += ch;
        p++;
        for (; p < inside.length; p++) {
          const c = inside[p];
          buf += c;
          if (c === "\\") { if (p + 1 < inside.length) { buf += inside[p + 1]; p++; } continue; }
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

  // crm:appdata param -> appdata
  xsltText = xsltText.replace(
    /<xsl:param\b([^>]*?)\bname=(["'])crm:appdata\2([^>]*?)\/?>/gi,
    (m, a, q, b) => `<xsl:param${a}name=${q}appdata${q}${b}/>`
  );
  xsltText = xsltText.replace(/\$crm:appdata\b/g, "$appdata");

  // common CRM helpers -> safe fallbacks
  xsltText = xsltText.replace(/crm:FormatDate\s*\(\s*([^)]+?)\s*\)/g, "string($1)");
  xsltText = xsltText.replace(
    /crm:ToUpperCase\s*\(\s*([^)]+?)\s*\)/g,
    "translate($1,'abcdefghijklmnopqrstuvwxyzåäö','ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ')"
  );

  xsltText = xsltText.replace(/crm:SplitLines\s*\(\s*([^)]+?)\s*\)\s*\[\s*\d+\s*\]/g, "string($1)");
  xsltText = xsltText.replace(
    /<xsl:for-each\s+select=(["'])crm:SplitLines\(\s*([^)]+?)\s*\)\1\s*>[\s\S]*?<\/xsl:for-each>/gi,
    (m, q, expr) => `<block><xsl:value-of select="${expr.trim()}"/></block>`
  );
  xsltText = xsltText.replace(/crm:SplitLines\s*\(\s*([^)]+?)\s*\)/g, "string($1)");

  xsltText = replaceBalancedCalls(xsltText, "crm:SplitGet", (args) => `string(${args?.[0]?.trim() || "''"})`);
  xsltText = replaceBalancedCalls(xsltText, "crm:FormatPeriod", (args) => `string(${args?.[0]?.trim() || "''"})`);
  xsltText = replaceBalancedCalls(xsltText, "crm:FormatReference", (args) => `string(${args?.[0]?.trim() || "''"})`);
  xsltText = replaceBalancedCalls(xsltText, "crm:AddSpacing", (args) => `string(${args?.[0]?.trim() || "''"})`);
  xsltText = replaceBalancedCalls(xsltText, "crm:Replace", (args) => `string(${args?.[0]?.trim() || "''"})`);

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
        "border-radius:8px;opacity:.85;margin:2px 0;";
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
      const statics = Array.from(seq.childNodes).filter(n =>
        n.nodeType === Node.ELEMENT_NODE && n.namespaceURI === FO_NS && n.localName === "static-content"
      );
      const flows = Array.from(seq.childNodes).filter(n =>
        n.nodeType === Node.ELEMENT_NODE && n.namespaceURI === FO_NS && n.localName === "flow"
      );

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

      if (flows.length === 0) renderFoNode(seq, ctx.current.content, ctx);
      else flows.forEach(f => renderFoNode(f, ctx.current.content, ctx));
    }
  }

  const wrapper = document.createElement("div");
  wrapper.style.display = "grid";
  wrapper.style.gap = "18px";
  ctx.sheets.forEach(s => wrapper.appendChild(s));
  return wrapper;
}

// -------------------------
// Output detection (FIXED to real '<')
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
// DTO info page
// -------------------------
function renderDtoPage(settings) {
  const host = document.getElementById("previewDto");
  if (!host) return;

  const typeLabel = ({
    sales: "Sales agreement (SupplyAgreementDto)",
    invoice: "Invoice (Finvoice)",
    auto: "Auto (from XSLT match)"
  })[settings.type] || settings.type;

  host.innerHTML = `
    <div style="max-width:900px">
      <h2 style="margin:0 0 10px;font-size:16px;color:#dbeafe;">DTO Info</h2>
      <div class="diagItem info">
        <div><b>Document type:</b> ${escapeHtml(typeLabel)}</div>
        <div><b>Locked root:</b> ${escapeHtml(settings.wantedRoot)}</div>
        <div><b>Detected from XSLT:</b> ${escapeHtml(settings.detectedRoot)}</div>
        <div><b>Match candidates:</b> ${escapeHtml((settings.candidates || []).join(", ") || "-")}</div>
        <div><b>Decode mode:</b> ${escapeHtml(settings.decodeMode)}</div>
      </div>

      <div class="diagItem">
        <div class="meta">What this means</div>
        <ul style="margin:6px 0 0 18px;color:#cbd5e1;">
          <li><b>Locked root</b> controls which root is used for “Generate XML”.</li>
          <li><b>Detected root</b> is extracted from <code>xsl:template match="..."</code>.</li>
          <li>If root mismatches, preview may not hit templates → output may be empty.</li>
        </ul>
      </div>
    </div>
  `;
}

// -------------------------
// Diagnostics
// -------------------------
function renderDiagnostics(issues) {
  const host = document.getElementById("diag");
  if (!host) return;
  host.innerHTML = "";

  if (!issues || issues.length === 0) {
    host.innerHTML = `<div class="diagItem info"><div class="meta">OK</div>No blocking issues detected.</div>`;
    return;
  }

  for (const it of issues) {
    const cls = it.severity === "ERROR" ? "error" : it.severity === "WARN" ? "warn" : "info";
    host.innerHTML += `
      <div class="diagItem ${cls}">
        <div><b>${escapeHtml(it.title || it.code || "Notice")}</b></div>
        <div class="meta">${escapeHtml(it.severity || "INFO")} • ${escapeHtml(it.code || "GENERIC")}</div>
        <div>${escapeHtml(it.message || "")}</div>
        ${it.fix ? `<div class="meta" style="margin-top:6px;"><b>Fix:</b> ${escapeHtml(it.fix)}</div>` : ""}
        ${it.snippet ? `<pre style="margin-top:8px;">${escapeHtml(it.snippet)}</pre>` : ""}
      </div>
    `;
  }
}

function diagnoseQuick({ xsltNorm, xmlNorm, xsltDoc, xmlDoc, outDoc, outText }) {
  const issues = [];
  const add = (severity, code, title, message, fix, snippet) =>
    issues.push({ severity, code, title, message, fix, snippet });

  if (xmlDoc && isParserError(xmlDoc)) add("ERROR", "XML_PARSE", "Source XML parsererror", "Source XML is not valid XML.", "Open another XML or fix XML.", "");
  if (xsltDoc && isParserError(xsltDoc)) add("ERROR", "XSLT_PARSE", "XSLT parsererror", "Stylesheet is not valid XML.", "Open another XSLT or fix XSLT.", "");
  if (outDoc && isParserError(outDoc)) {
    const pe = outDoc.getElementsByTagName("parsererror")[0];
    add("ERROR", "XSLT_RUNTIME", "Transform returned parsererror", (pe?.textContent || "parsererror").slice(0, 260), "Try compat patch or check match/root.", outText?.slice(0, 220));
  }
  if (xsltNorm && (xsltNorm.includes("&lt;") || xsltNorm.includes("&amp;lt;"))) add("WARN", "XSLT_ESCAPED", "XSLT is escaped", "XSLT contains escaped entities. Decoder will try to normalize.", "Use decode mode Aggressive if needed.", xsltNorm.slice(0, 140));
  if (xmlNorm && (xmlNorm.includes("&lt;") || xmlNorm.includes("&amp;lt;"))) add("WARN", "XML_ESCAPED", "XML is escaped", "XML contains escaped entities. Decoder will try to normalize.", "Use decode mode Aggressive if needed.", xmlNorm.slice(0, 140));
  return issues;
}

// -------------------------
// Transform runner
// -------------------------
async function runTransform(xsltTextInput, xmlTextInput) {
  const parser = new DOMParser();

  const settings = getDocSettings(xsltTextInput);
  const xsltTextInputNorm = normalizeByMode(xsltTextInput, settings.decodeMode);
  const xmlTextNorm = normalizeByMode(xmlTextInput, settings.decodeMode);

  const xmlDoc = parser.parseFromString(xmlTextNorm, "text/xml");
  const xsltDocRaw = parser.parseFromString(xsltTextInputNorm, "text/xml");

  // compat auto if crm:* exists
  const crmDetected = /\bcrm:([A-Za-z_]\w*)\s*\(/.test(xsltTextInputNorm) || /\$crm:appdata\b/.test(xsltTextInputNorm);
  const xsltText = crmDetected ? patchCrmFunctionsForPreview(xsltTextInputNorm) : xsltTextInputNorm;
  const xsltDoc = parser.parseFromString(xsltText, "text/xml");

  // diagnostics
  if (isParserError(xmlDoc) || isParserError(xsltDoc)) {
    renderDiagnostics(diagnoseQuick({ xsltNorm: xsltTextInputNorm, xmlNorm: xmlTextNorm, xsltDoc, xmlDoc, outDoc: null, outText: "" }));
    log("ERROR: parse error – see diagnostics.");
    return;
  }

  let outDoc;
  try {
    const processor = new XSLTProcessor();
    processor.importStylesheet(xsltDoc);
    outDoc = processor.transformToDocument(xmlDoc);
  } catch (e) {
    log("ERROR: XSLTProcessor failed: " + (e?.message || e));
    renderDiagnostics([{ severity:"ERROR", code:"XSLT_PROCESSOR", title:"XSLTProcessor failed", message:String(e?.message || e), fix:"Check XSLT validity / compat mode.", snippet:"" }]);
    return;
  }

  const raw = serializeNodeSafe(outDoc) || "";
  const outEl = document.getElementById("foOut");
  if (outEl) outEl.textContent = raw ? prettyXml(raw) : "(empty result)";

  const outputType = detectXsltOutput(xsltText, outDoc, raw);
  document.getElementById("xsltAnalysis")?.replaceChildren(document.createTextNode("Detected output: " + outputType));
  renderDiagnostics(diagnoseQuick({ xsltNorm: xsltTextInputNorm, xmlNorm: xmlTextNorm, xsltDoc, xmlDoc, outDoc, outText: raw }));

  // DTO info always updated
  renderDtoPage(settings);

  const preview = document.getElementById("previewPdf");
  if (preview) preview.innerHTML = "";

  if (outputType === "XSL-FO") {
    const rendered = renderFoDocumentToPdfLook(outDoc);
    if (rendered) preview?.appendChild(rendered);
    else preview.textContent = "FO root not found.";
    setTab("pdf");
    return;
  }

  if (outputType === "HTML") {
    preview.innerHTML = raw || "";
    setTab("pdf");
    return;
  }

  // TEXT / UNKNOWN -> show raw text
  preview.textContent = raw || "";
  setTab("pdf");
}

// -------------------------
// Demo presets (same as you had, unchanged content)
// NOTE: We'll decode to readable markup when loading into editors.
// -------------------------
const DEMO_PRESETS = [
  {
    id: "contract_fo_a",
    name: "Sopimusvahvistus (FO) • Tuote A (ID=100)",
    docType: "sales",
    lockDocType: true,
    decodeMode: "smart",
    xslt: `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns="http://www.w3.org/1999/XSL/Format"
  xmlns:crm="urn:crm">

  <xsl:param name="crm:appdata" />

  <xsl:variable name="isProduction" select="/SupplyAgreementDto/ProductionSiteCode!=''"/>
  <xsl:variable name="productId" select="/SupplyAgreementDto/Product/ID"/>
  <xsl:variable name="isSpotProduct" select="/SupplyAgreementDto/Product/IsNpsProduct='true'"/>
  <xsl:variable name="hasProfileCost" select="/SupplyAgreementDto/Product/HasProfileCost='true'"/>
  <xsl:variable name="fixedPrice" select="/SupplyAgreementDto/Product/FixedPrice='true'"/>
  <xsl:variable name="fixedIndefinitelyPrice" select="/SupplyAgreementDto/Product/FixedIndefinitelyPrice='true'"/>
  <xsl:variable name="fixedQuarterly" select="/SupplyAgreementDto/Product/FixedQuarterly='true'"/>
  <xsl:variable name="fixedAny" select="$fixedPrice or $fixedIndefinitelyPrice or $fixedQuarterly"/>

  <xsl:variable name="isProductA" select="$productId = 100"/>
  <xsl:variable name="isProductB" select="$productId = 200"/>
  <xsl:variable name="isProductC" select="$productId = 300 or $productId = 301"/>

  <xsl:template match="SupplyAgreementDto">
    <root language="FI" country="FI">
      <page-sequence master-reference="seq" font-size="9pt">
        <flow flow-name="xsl-region-body">
          <block font-weight="bold" font-size="14pt" space-after="4mm">SOPIMUSVAHVISTUS (DEMO)</block>
          <block>Tuote: <xsl:value-of select="Product/Name"/></block>
          <block space-before="3mm">
            <xsl:choose>
              <xsl:when test="$isProductA">Sisältö A (esimerkki).</xsl:when>
              <xsl:when test="$isProductB">Sisältö B (esimerkki).</xsl:when>
              <xsl:when test="$isProductC">Sisältö C (esimerkki).</xsl:when>
              <xsl:when test="$isSpotProduct">Spot (esimerkki).</xsl:when>
              <xsl:when test="$fixedAny">Fixed (esimerkki).</xsl:when>
              <xsl:otherwise>Geneerinen sisältö (esimerkki).</xsl:otherwise>
            </xsl:choose>
          </block>
          <block break-before="page"/>
          <block font-weight="bold">Sopimuksen ehdot (demo)</block>
          <block space-before="2mm">Tämä on demoteksti.</block>
        </flow>
      </page-sequence>
    </root>
  </xsl:template>
</xsl:stylesheet>`,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<SupplyAgreementDto ID="D-1001">
  <ProductionSiteCode></ProductionSiteCode>
  <OutputDate>2026-03-12</OutputDate>
  <FirstDate>2026-04-01</FirstDate>
  <PeriodFirstDate>2026-04-01</PeriodFirstDate>
  <LastDate></LastDate>
  <VatRatePercent>24</VatRatePercent>
  <OwnerClient ID="123456">
    <LastNameFirst>Testaaja Testi</LastNameFirst>
    <Code>123456-789A</Code>
    <Address><PostalAddressPrint>Testikatu 1 A 2&#x0A;00100 Helsinki</PostalAddressPrint></Address>
  </OwnerClient>
  <MeteringPoint><GridOperator>ESIMERKKIVERKKO OY</GridOperator></MeteringPoint>
  <Object><FinnishMeteringPointID>123456789012345678</FinnishMeteringPointID><AddressLines>Testikäyttöpaikantie 1 A 2&#x0A;00100 Helsinki</AddressLines></Object>
  <Product>
    <ID>100</ID>
    <Name>Esimerkkituote A</Name>
    <IsNpsProduct>false</IsNpsProduct>
    <HasProfileCost>false</HasProfileCost>
    <FixedPrice>false</FixedPrice>
    <FixedIndefinitelyPrice>false</FixedIndefinitelyPrice>
    <FixedQuarterly>false</FixedQuarterly>
  </Product>
</SupplyAgreementDto>`
  },

  {
    id: "contract_fo_b",
    name: "Sopimusvahvistus (FO) • Tuote B (ID=200)",
    docType: "sales",
    lockDocType: true,
    decodeMode: "smart",
    xslt: null, // copied from A on init
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<SupplyAgreementDto ID="D-2001">
  <ProductionSiteCode></ProductionSiteCode>
  <OutputDate>2026-03-12</OutputDate>
  <FirstDate>2026-04-01</FirstDate>
  <PeriodFirstDate>2026-04-01</PeriodFirstDate>
  <LastDate></LastDate>
  <VatRatePercent>24</VatRatePercent>
  <OwnerClient ID="123456"><LastNameFirst>Testaaja Testi</LastNameFirst></OwnerClient>
  <Product><ID>200</ID><Name>Esimerkkituote B</Name><IsNpsProduct>false</IsNpsProduct></Product>
</SupplyAgreementDto>`
  },

  {
    id: "gsm_text",
    name: "Katkoviesti GSM (TEXT)",
    docType: "auto",
    lockDocType: false,
    decodeMode: "smart",
    xslt: `<?xml version="1.0" ?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="text" />
  <xsl:template match="/*">
    <xsl:text>Huoltotöiden vuoksi keskeytämme sähkönjakelun. Pahoittelemme häiriötä.</xsl:text>
    <xsl:value-of select="Event"/>
    <xsl:for-each select="Event[position()>1]">
      <xsl:text>, </xsl:text>
      <xsl:value-of select="."/>
    </xsl:for-each>
    <xsl:text> </xsl:text>
    <xsl:value-of select="Address"/>
  </xsl:template>
</xsl:stylesheet>`,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<GsmMessage>
  <Event>12.03.2026 klo 10:00–12:00</Event>
  <Event>12.03.2026 klo 14:00–15:00</Event>
  <Address>Testikatu 1, 00100 Helsinki</Address>
</GsmMessage>`
  },

  {
    id: "invoice_html",
    name: "Lasku sähköposti (HTML / Finvoice)",
    docType: "invoice",
    lockDocType: true,
    decodeMode: "smart",
    xslt: `<?xml version="1.0" ?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:crm="urn:crm">
  <xsl:output method="html" />
  <xsl:template match="/Finvoice">
    <xsl:text disable-output-escaping='yes'>&lt;!DOCTYPE html&gt;</xsl:text>
    <html lang="fi">
      <head>
        <style>
          p { line-height: 107%; font-size: 11.0pt; font-family: "Calibri",sans-serif; }
        </style>
      </head>
      <body>
        <p>Hei,</p>
        <p>Tässä sähköpostiin lähetettävä esimerkkilasku.</p>
        <p>
          <b>LASKUN MAKSUTIEDOT:</b><br/>
          Saaja: sähköyhtiö<br/>
          Tilinumero: <xsl:value-of select="EpiDetails/EpiPartyDetails/EpiBeneficiaryPartyDetails/EpiAccountID"/><br/>
          Viitenumero: <xsl:value-of select ="InvoiceDetails/AgreementIdentifier"/><br/>
          Summa: <xsl:value-of select ="EpiDetails/EpiPaymentInstructionDetails/EpiInstructedAmount"/> €<br/>
          Eräpäivä: <xsl:value-of select="crm:FormatPeriod(EpiDetails/EpiPaymentInstructionDetails/EpiDateOptionDate,'','yyyyMMdd')"/>
        </p>
        <p>
          Käytä tätä viivakoodia, jos haluat maksaa laskusi virtuaaliviivakoodilla: <xsl:value-of select="VirtualBankBarcode" />
        </p>
        <p>
          <b>LASKUN TIEDOT:</b><br/>
          Asiakas: <xsl:value-of select="BuyerPartyDetails/BuyerOrganisationName"/><br/>
          Asiakasnumero: <xsl:value-of select="InvoiceDetails/SellersBuyerIdentifier"/><br/>
          Lasku: <xsl:value-of select="InvoiceDetails/InvoiceNumber"/><br/>
          Laskun päiväys: <xsl:value-of select="crm:FormatPeriod(InvoiceDetails/InvoiceDate,'','yyyyMMdd')" />
        </p>
        <p>
          Ystävällisin terveisin,<br/>
          sähköyhtiö<br/>
        </p>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>`,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<Finvoice>
  <EpiDetails>
    <EpiPartyDetails>
      <EpiBeneficiaryPartyDetails>
        <EpiAccountID>FI00 1234 5600 0007</EpiAccountID>
      </EpiBeneficiaryPartyDetails>
    </EpiPartyDetails>
    <EpiPaymentInstructionDetails>
      <EpiInstructedAmount>100.00</EpiInstructedAmount>
      <EpiDateOptionDate>2026-04-15</EpiDateOptionDate>
    </EpiPaymentInstructionDetails>
  </EpiDetails>

  <InvoiceDetails>
    <AgreementIdentifier>30000001</AgreementIdentifier>
    <SellersBuyerIdentifier>ASI-000123</SellersBuyerIdentifier>
    <InvoiceNumber>INV-2026-0001</InvoiceNumber>
    <InvoiceDate>2026-03-12</InvoiceDate>
  </InvoiceDetails>

  <BuyerPartyDetails>
    <BuyerOrganisationName>Testiasiakas Oy</BuyerOrganisationName>
  </BuyerPartyDetails>

  <VirtualBankBarcode>012345678901234567890123456789012345</VirtualBankBarcode>
</Finvoice>`
  }
];

// copy XSLT from A to B
DEMO_PRESETS.find(p => p.id === "contract_fo_b").xslt = DEMO_PRESETS.find(p => p.id === "contract_fo_a").xslt;

// -------------------------
// Demo preset apply (FIXED: selection shown + optional auto-apply on change)
// -------------------------
function updateSelectionUi(preset) {
  const nameEl = document.getElementById("selectedPresetName");
  if (nameEl) nameEl.textContent = preset?.name || "-";

  const filesEl = document.getElementById("loadedFilesLabel");
  if (filesEl) {
    const parts = [];
    if (loadedFileLabels.xslt) parts.push(`XSLT: ${loadedFileLabels.xslt}`);
    if (loadedFileLabels.xml) parts.push(`XML: ${loadedFileLabels.xml}`);
    filesEl.textContent = parts.length ? parts.join(" • ") : "-";
  }
}

function applyDemoPreset(presetId, { autorun = true } = {}) {
  const p = DEMO_PRESETS.find(x => x.id === presetId);
  if (!p) return;

  const xsltEditor = document.getElementById("xsltEditor");
  const xmlEditor  = document.getElementById("xmlEditor");

  const docType = document.getElementById("docType");
  const lock = document.getElementById("lockDocType");
  const decode = document.getElementById("decodeMode");

  if (docType) docType.value = p.docType ?? "auto";
  if (lock) lock.checked = !!p.lockDocType;
  if (decode) decode.value = p.decodeMode ?? "smart";

  // Decode into readable markup for UI
  const mode = decode?.value || "smart";
  const xsltReadable = normalizeByMode(p.xslt || "", mode);
  const xmlReadable  = normalizeByMode(p.xml || "", mode);

  if (xsltEditor) xsltEditor.value = xsltReadable;
  if (xmlEditor) xmlEditor.value = xmlReadable;

  loadedXsltText = xsltReadable;
  loadedXmlText = xmlReadable;
  loadedFileLabels = { xslt: `preset:${p.id}`, xml: `preset:${p.id}` };

  const settings = getDocSettings(xsltReadable);
  lastDetectedRoot = settings.wantedRoot;
  lastDetectedByXslt = settings.detectedRoot;
  lastDetectedCandidates = settings.candidates;

  updateSelectionUi(p);
  renderDtoPage(settings);

  log(`Loaded preset → ${p.name} (root: ${settings.wantedRoot})`);

  if (autorun) runFromEditors();
}

// -------------------------
// UI actions
// -------------------------
async function runFromEditors() {
  const xsltEditor = document.getElementById("xsltEditor");
  const xmlEditor = document.getElementById("xmlEditor");
  const xsltText = xsltEditor?.value || "";
  const xmlText = xmlEditor?.value || "";

  if (!xsltText.trim()) { log("ERROR: XSLT editor empty"); return; }

  // Snapshot for reset
  if (!loadedXsltText && xsltText.trim()) loadedXsltText = xsltText;
  if (!loadedXmlText && xmlText.trim()) loadedXmlText = xmlText;

  const settings = getDocSettings(xsltText);
  lastDetectedRoot = settings.wantedRoot;
  lastDetectedByXslt = settings.detectedRoot;
  lastDetectedCandidates = settings.candidates;

  renderDtoPage(settings);
  await runTransform(xsltText, xmlText);
}

function generateXmlFromRoot() {
  const xmlEditor = document.getElementById("xmlEditor");
  const xsltEditor = document.getElementById("xsltEditor");
  if (!xmlEditor || !xsltEditor) return;

  const xsltText = xsltEditor.value || loadedXsltText || "";
  const settings = getDocSettings(xsltText);

  const root = settings.wantedRoot || "SupplyAgreementDto";

  if (/Finvoice/i.test(root)) {
    const preset = DEMO_PRESETS.find(p => p.id === "invoice_html");
    xmlEditor.value = normalizeByMode(preset?.xml || xmlEditor.value, settings.decodeMode);
  } else if (/SupplyAgreementDto/i.test(root)) {
    const current = normalizeXmlText(xmlEditor.value || "");
    const match = current.match(/<ID>\s*(\d+)\s*<\/ID>/i);
    const pid = match ? match[1] : "100";
    xmlEditor.value = `<?xml version="1.0" encoding="UTF-8"?>
<SupplyAgreementDto ID="D-GEN-${pid}">
  <ProductionSiteCode></ProductionSiteCode>
  <OutputDate>2026-03-12</OutputDate>
  <FirstDate>2026-04-01</FirstDate>
  <PeriodFirstDate>2026-04-01</PeriodFirstDate>
  <LastDate></LastDate>
  <VatRatePercent>24</VatRatePercent>
  <OwnerClient ID="123456"><LastNameFirst>Testaaja Testi</LastNameFirst></OwnerClient>
  <Product><ID>${pid}</ID><Name>Generated Product ${pid}</Name><IsNpsProduct>false</IsNpsProduct></Product>
</SupplyAgreementDto>`;
  } else {
    xmlEditor.value = `<?xml version="1.0" encoding="UTF-8"?><Root><Value>DEMO</Value></Root>`;
  }

  lastDetectedRoot = root;
  log("XML generated for root: " + root);
}

function resetXslt() {
  const xsltEditor = document.getElementById("xsltEditor");
  if (!xsltEditor) return;
  if (loadedXsltText && loadedXsltText.trim()) {
    xsltEditor.value = loadedXsltText;
    log("XSLT reset to loaded snapshot.");
  } else {
    log("WARN: No loaded snapshot.");
  }
}

function resetXml() {
  const xmlEditor = document.getElementById("xmlEditor");
  if (!xmlEditor) return;
  if (loadedXmlText && loadedXmlText.trim()) {
    xmlEditor.value = loadedXmlText;
    log("XML reset to loaded snapshot.");
  } else {
    log("WARN: No loaded XML snapshot.");
  }
}

async function saveXslt() {
  const xsltText = document.getElementById("xsltEditor")?.value || "";
  if (!xsltText.trim()) return;
  downloadTextFile("demo-template.xslt", xsltText, "application/xml;charset=utf-8");
  log("Downloaded XSLT.");
}

async function saveXml() {
  const xmlText = document.getElementById("xmlEditor")?.value || "";
  if (!xmlText.trim()) return;
  downloadTextFile("demo-source.xml", xmlText, "application/xml;charset=utf-8");
  log("Downloaded XML.");
}

// -------------------------
// File support (ALL FILES + drag&drop)
// -------------------------
function guessKindByName(name = "", text = "") {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".xslt") || n.endsWith(".xsl")) return "xslt";
  if (n.endsWith(".xml")) return "xml";
  if (n.endsWith(".html") || n.endsWith(".htm")) return "xslt"; // often output template; still put into XSLT slot if user wants preview
  if (n.endsWith(".txt")) return "xml"; // could be data; fallback

  const t = (text || "").toLowerCase();
  if (t.includes("<xsl:stylesheet") || t.includes("http://www.w3.org/1999/xsl/transform")) return "xslt";
  if (t.trim().startsWith("<")) return "xml";
  if (t.includes("&lt;xsl:stylesheet") || t.includes("&amp;lt;xsl:stylesheet")) return "xslt";
  return "unknown";
}

async function readFileAsText(file) {
  // Works in browser + Electron
  return await file.text();
}

async function loadFileIntoEditors(file, forcedKind = "auto") {
  if (!file) return;
  const text = await readFileAsText(file);
  const mode = document.getElementById("decodeMode")?.value || "smart";
  const normalized = normalizeByMode(text, mode);

  let kind = forcedKind;
  if (kind === "auto") kind = guessKindByName(file.name, text);

  if (kind === "xslt") {
    document.getElementById("xsltEditor").value = normalized;
    loadedXsltText = normalized;
    loadedFileLabels.xslt = file.name;
    log(`Opened XSLT: ${file.name} (${file.size} bytes)`);
  } else if (kind === "xml") {
    document.getElementById("xmlEditor").value = normalized;
    loadedXmlText = normalized;
    loadedFileLabels.xml = file.name;
    log(`Opened XML: ${file.name} (${file.size} bytes)`);
  } else {
    // unknown: choose by content heuristics
    const g = guessKindByName(file.name, text);
    if (g === "xslt") {
      document.getElementById("xsltEditor").value = normalized;
      loadedXsltText = normalized;
      loadedFileLabels.xslt = file.name;
      log(`Opened (auto→XSLT): ${file.name}`);
    } else {
      document.getElementById("xmlEditor").value = normalized;
      loadedXmlText = normalized;
      loadedFileLabels.xml = file.name;
      log(`Opened (auto→XML): ${file.name}`);
    }
  }

  updateSelectionUi({ name: "Custom (file)" });
  renderDtoPage(getDocSettings(document.getElementById("xsltEditor")?.value || ""));
}

function installDragDrop() {
  const xsltEditor = document.getElementById("xsltEditor");
  const xmlEditor = document.getElementById("xmlEditor");

  const attach = (el, kind) => {
    if (!el) return;
    el.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      if (!guardDemoOrLock()) return;
      const file = e.dataTransfer.files?.[0];
      if (file) await loadFileIntoEditors(file, kind);
    });
  };

  attach(xsltEditor, "xslt");
  attach(xmlEditor, "xml");

  // Also allow dropping anywhere -> auto
  document.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  document.addEventListener("drop", async (e) => {
    // if dropped on textarea handlers already handled, this will still run; avoid double by checking target
    if (e.target === xsltEditor || e.target === xmlEditor) return;
    e.preventDefault();
    if (!guardDemoOrLock()) return;
    const file = e.dataTransfer.files?.[0];
    if (file) await loadFileIntoEditors(file, "auto");
  });
}

// -------------------------
// Guard helper (define BEFORE binding)
// -------------------------
function guarded(fn) {
  return (e) => {
    if (!guardDemoOrLock()) {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      return;
    }
    return fn(e);
  };
}

// -------------------------
// Init
// -------------------------
window.addEventListener("DOMContentLoaded", () => {
  updateDemoBadge();
  if (getDemoState().expired) {
    hardLockDemoUI();
    return;
  }
  setInterval(updateDemoBadge, 30_000);

  // Tabs (FIXED)
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", guarded(() => setTab(btn.dataset.tab)));
  });

  // fill presets
  const sel = document.getElementById("demoPreset");
  if (sel) {
    sel.innerHTML = DEMO_PRESETS
      .map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
      .join("");
    sel.value = DEMO_PRESETS[0]?.id || "";
  }

  // preset selection should update immediately (FIXED)
  document.getElementById("demoPreset")
    ?.addEventListener("change", guarded((e) => {
      const id = e.target.value;
      const p = DEMO_PRESETS.find(x => x.id === id);
      updateSelectionUi(p);
      applyDemoPreset(id, { autorun: true });
    }));

  // Buttons
  document.getElementById("loadDemoPresetBtn")
    ?.addEventListener("click", guarded(() => {
      applyDemoPreset(document.getElementById("demoPreset")?.value, { autorun: true });
    }));

  document.getElementById("runFromEditorBtn")
    ?.addEventListener("click", guarded(() => runFromEditors()));

  document.getElementById("genXmlBtn")
    ?.addEventListener("click", guarded(() => generateXmlFromRoot()));

  document.getElementById("resetXsltBtn")
    ?.addEventListener("click", guarded(() => resetXslt()));

  document.getElementById("saveXsltBtn")
    ?.addEventListener("click", guarded(() => saveXslt()));

  document.getElementById("saveXmlBtn")
    ?.addEventListener("click", guarded(() => saveXml()));

  // File buttons
  const fileXslt = document.getElementById("fileXslt");
  const fileXml = document.getElementById("fileXml");
  const fileAny = document.getElementById("fileAny");

  document.getElementById("openXsltBtn")?.addEventListener("click", guarded(() => fileXslt?.click()));
  document.getElementById("openXmlBtn")?.addEventListener("click", guarded(() => fileXml?.click()));
  document.getElementById("openAnyBtn")?.addEventListener("click", guarded(() => fileAny?.click()));

  fileXslt?.addEventListener("change", guarded(async () => {
    const f = fileXslt.files?.[0];
    if (f) await loadFileIntoEditors(f, "xslt");
    fileXslt.value = "";
  }));
  fileXml?.addEventListener("change", guarded(async () => {
    const f = fileXml.files?.[0];
    if (f) await loadFileIntoEditors(f, "xml");
    fileXml.value = "";
  }));
  fileAny?.addEventListener("change", guarded(async () => {
    const f = fileAny.files?.[0];
    if (f) await loadFileIntoEditors(f, "auto");
    fileAny.value = "";
  }));

  // Drag&Drop support
  installDragDrop();

  // auto-load first preset
  applyDemoPreset(DEMO_PRESETS[0]?.id, { autorun: true });

  // defaults
  setTab("pdf");
  log("Demo started at: " + getDemoState().startedAt);
});