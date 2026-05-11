// Minimal Office Open XML (.docx) writer with no third-party dependencies.
//
// We emit the three parts every Word build needs — [Content_Types].xml,
// _rels/.rels, word/document.xml — and pack them into a ZIP using the
// STORED (uncompressed) method. STORED keeps the implementation small and
// avoids pulling in a compressor; Word opens stored-only docx files fine.

import type {
  MemoBlock,
  MemoDraft,
  MemoInline,
  MemoSection,
} from "./build"

// ─────────────────────────────────────────────────────────────────────────────
// CRC32
// ─────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny ZIP (STORED) writer
// ─────────────────────────────────────────────────────────────────────────────

type ZipEntry = {
  name: string
  data: Uint8Array
}

function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, d.getFullYear())
  const date =
    ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  return { date, time }
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, n, true)
  return b
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, true)
  return b
}
function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

function buildZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder()
  const { date, time } = dosDateTime(new Date())

  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    // Local file header
    const local = concat([
      u32(0x04034b50), // signature
      u16(20), // version needed
      u16(0), // general purpose bit flag
      u16(0), // compression method = STORED
      u16(time),
      u16(date),
      u32(crc),
      u32(size), // compressed size = uncompressed
      u32(size),
      u16(nameBytes.length),
      u16(0), // extra length
      nameBytes,
      entry.data,
    ])
    localChunks.push(local)

    // Central directory header
    const central = concat([
      u32(0x02014b50),
      u16(20), // version made by
      u16(20), // version needed
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ])
    centralChunks.push(central)

    offset += local.length
  }

  const central = concat(centralChunks)
  const centralOffset = offset
  const centralSize = central.length

  const endOfCentral = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(centralOffset),
    u16(0),
  ])

  return concat([...localChunks, central, endOfCentral])
}

// ─────────────────────────────────────────────────────────────────────────────
// XML escaping
// ─────────────────────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// ─────────────────────────────────────────────────────────────────────────────
// document.xml generation
// ─────────────────────────────────────────────────────────────────────────────

function runXml(inline: MemoInline): string {
  if (inline.kind === "text") {
    return `<w:r><w:t xml:space="preserve">${xmlEscape(inline.text)}</w:t></w:r>`
  }
  if (inline.kind === "ticker") {
    return `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:b/><w:color w:val="6B5A1D"/></w:rPr><w:t xml:space="preserve">${xmlEscape(inline.text)}</w:t></w:r>`
  }
  // citation
  return `<w:r><w:rPr><w:vertAlign w:val="superscript"/><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:color w:val="8A8474"/></w:rPr><w:t xml:space="preserve">[${inline.n}]</w:t></w:r>`
}

function paragraphXml(runs: MemoInline[], opts?: { listLevel?: number }): string {
  const numPr =
    typeof opts?.listLevel === "number"
      ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`
      : ""
  const inner = runs.map(runXml).join("")
  return `<w:p><w:pPr>${numPr}<w:spacing w:after="120"/></w:pPr>${inner}</w:p>`
}

function headingXml(text: string, level: 1 | 2): string {
  const sz = level === 1 ? "32" : "22"
  return `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`
}

function blockXml(block: MemoBlock): string {
  if (block.kind === "p") return paragraphXml(block.runs)
  return block.items.map((runs) => paragraphXml(runs, { listLevel: 0 })).join("")
}

function sectionXml(section: MemoSection, idx: number): string {
  const title = idx === 0 ? section.title : `${idx}. ${section.title}`
  return [headingXml(title, 2), ...section.blocks.map(blockXml)].join("")
}

function documentXml(draft: MemoDraft, includedIds: Set<string>): string {
  const included = draft.sections.filter((s) => includedIds.has(s.id))

  const metaLines = [
    `From: Ameya · A. Shanbhag · GSCR/GSBD PM`,
    `To: Credit Committee · ${new Date().toDateString()}`,
    `Subject: Goldman BDC credit memo · auto-drafted from latest filings`,
  ]

  const headerXml = [
    `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t xml:space="preserve">Goldman BDC weekly credit memo</w:t></w:r></w:p>`,
    ...metaLines.map(
      (line) =>
        `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:color w:val="6B6859"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`,
    ),
  ].join("")

  const bodyXml = included.map((s, i) => sectionXml(s, i)).join("")

  const citationsXml =
    draft.citations.length > 0
      ? [
          headingXml("Sources", 2),
          ...draft.citations.map((c) => {
            const label = c.url ? `${c.label} — ${c.url}` : c.label
            return `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">[${c.n}] </w:t></w:r><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${xmlEscape(label)}</w:t></w:r></w:p>`
          }),
        ].join("")
      : ""

  const footerXml = `<w:p><w:pPr><w:spacing w:before="240"/></w:pPr><w:r><w:rPr><w:i/><w:sz w:val="18"/><w:color w:val="6B6859"/></w:rPr><w:t xml:space="preserve">Sources cited to SEC EDGAR. Data current as of last filing date per security. Prepared with swarm credit intelligence.</w:t></w:r></w:p>`

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${headerXml}
${bodyXml}
${citationsXml}
${footerXml}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body>
</w:document>`
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function buildMemoDocx(
  draft: MemoDraft,
  includedSectionIds: string[],
): Uint8Array {
  const enc = new TextEncoder()
  const included = new Set(includedSectionIds)

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const doc = documentXml(draft, included)

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rels) },
    { name: "word/document.xml", data: enc.encode(doc) },
  ]

  return buildZip(entries)
}

export function memoFilename(draft: MemoDraft): string {
  const d = new Date(draft.generatedAt)
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
  return `goldman-bdc-credit-memo-${stamp}.docx`
}
