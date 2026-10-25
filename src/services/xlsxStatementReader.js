import readExcelFile from "read-excel-file/universal"
import { Unzip, UnzipInflate } from "fflate"
import { STATEMENT_LIMITS } from "./statementImportModel.js"
import { parsePaytmWorkbookRows } from "./paytmStatementParser.js"

export const WORKBOOK_LIMITS = Object.freeze({ entries: 128, expanded: 32 * 1024 * 1024, entry: 8 * 1024 * 1024, ratio: 200, columns: 32, cells: 150000, text: 16 * 1024 * 1024 })
const fail = (message) => { throw Object.assign(new Error(message), { name: "WorkbookSafetyError" }) }
const decoder = new TextDecoder("utf-8", { fatal: true })
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let current = value
  for (let bit = 0; bit < 8; bit++) current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1
  return current >>> 0
})
const crcChunk = (crc, bytes) => { for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return crc >>> 0 }

// Check central-directory sizes before decompression, then verify actual output
// incrementally. Small compressed chunks bound allocation even for forged sizes.
export const validateWorkbookArchive = (buffer) => {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer)
  if (bytes.length > STATEMENT_LIMITS.bytes) fail("Workbook exceeds the 10 MB file safety limit.")
  let end = -1
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) {
    if (view.getUint32(index, true) === 0x06054b50 && index + 22 + view.getUint16(index + 20, true) === bytes.length) { end = index; break }
  }
  if (end < 0) fail("This XLSX file is not a complete ZIP workbook. Legacy XLS and encrypted workbooks are unsupported.")
  const count = view.getUint16(end + 10, true), centralSize = view.getUint32(end + 12, true), centralOffset = view.getUint32(end + 16, true)
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count === 65535 || centralOffset + centralSize !== end) fail("Multipart or ZIP64 workbooks are unsupported.")
  if (!count || count > WORKBOOK_LIMITS.entries) fail("Workbook exceeds the archive-entry safety limit.")
  const entries = new Map()
  let cursor = centralOffset, declaredOutput = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) fail("The workbook ZIP directory is malformed.")
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true)
    const crc = view.getUint32(cursor + 16, true), compressed = view.getUint32(cursor + 20, true), expanded = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true), offset = view.getUint32(cursor + 42, true)
    if (cursor + 46 + nameLength + extraLength + commentLength > end) fail("The workbook ZIP directory is truncated.")
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    if (!name || entries.has(name) || /(?:^\/|\\|\0|(?:^|\/)\.\.(?:\/|$))/.test(name)) fail("The workbook contains ambiguous or unsafe archive paths.")
    if (flags & 1 || ![0, 8].includes(method)) fail("Encrypted or unsupported workbook compression is not supported.")
    if (/vbaProject|^xl\/(?:embeddings|activeX|externalLinks)\//i.test(name)) fail("Macro-enabled workbooks, embedded objects and external workbook links are unsupported.")
    declaredOutput += expanded
    if (expanded > WORKBOOK_LIMITS.entry || declaredOutput > WORKBOOK_LIMITS.expanded || expanded > Math.max(1, compressed) * WORKBOOK_LIMITS.ratio) fail("Workbook exceeds the decompression safety limit.")
    if (offset + 30 > centralOffset || view.getUint32(offset, true) !== 0x04034b50) fail("The workbook ZIP entry is malformed.")
    const dataOffset = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true)
    if (dataOffset + compressed > centralOffset) fail("The workbook ZIP data is truncated.")
    entries.set(name, { crc, compressed, expanded, method })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  if (cursor !== end || !entries.has("[Content_Types].xml") || !entries.has("xl/workbook.xml") || !entries.has("xl/_rels/workbook.xml.rels")) fail("This archive is not a supported XLSX workbook.")
  let output = 0, cells = 0, finished = 0, failure
  const observed = new Set()
  const unzip = new Unzip((file) => {
    const expected = entries.get(file.name)
    if (!expected || observed.has(file.name) || file.compression !== expected.method) fail("Workbook ZIP entries do not match their directory.")
    observed.add(file.name)
    let length = 0, crc = 0xffffffff
    const parts = [], xml = /\.(?:xml|rels)$/i.test(file.name)
    file.ondata = (error, data, final) => {
      if (failure) return
      try {
        if (error) fail("The workbook compressed data is invalid.")
        length += data.length; output += data.length
        if (length > expected.expanded || length > WORKBOOK_LIMITS.entry || output > WORKBOOK_LIMITS.expanded) fail("Workbook exceeds the decompression safety limit.")
        crc = crcChunk(crc, data)
        if (xml) parts.push(data.slice())
        if (final) {
          if (length !== expected.expanded || ((crc ^ 0xffffffff) >>> 0) !== expected.crc) fail("The workbook ZIP data failed its integrity check.")
          if (xml) {
            const all = new Uint8Array(length)
            let offset = 0
            for (const part of parts) { all.set(part, offset); offset += part.length }
            const text = decoder.decode(all)
            if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail("Workbook XML entities are unsupported.")
            if (/macroEnabled|vbaProject/i.test(text)) fail("Macro-enabled workbooks are unsupported.")
            if (/^xl\/worksheets\//.test(file.name)) {
              if (/<(?:\w+:)?f(?:\s|\/?>)/i.test(text)) fail("Formula-backed worksheets are unsupported. Export the statement with values only.")
              const rowTags = [...text.matchAll(/<(?:\w+:)?row\b/gi)]
              if (rowTags.length > STATEMENT_LIMITS.csvRows) fail("Workbook exceeds the row safety limit.")
              cells += [...text.matchAll(/<(?:\w+:)?c\b/gi)].length
              if (cells > WORKBOOK_LIMITS.cells) fail("Workbook exceeds the cell-count safety limit.")
              for (const match of text.matchAll(/\b(?:r|ref)=["'](?:[A-Z]+\d+:)?([A-Z]+)(\d+)["']/gi)) {
                let column = 0
                for (const letter of match[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64
                if (column > WORKBOOK_LIMITS.columns || Number(match[2]) > STATEMENT_LIMITS.csvRows) fail("Workbook exceeds the worksheet-dimension safety limit.")
              }
            }
          }
          finished++
        }
      } catch (problem) { failure = problem }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  for (let index = 0; index < bytes.length; index += 1024) {
    unzip.push(bytes.subarray(index, index + 1024), index + 1024 >= bytes.length)
    if (failure) throw failure
  }
  if (finished !== entries.size || observed.size !== entries.size) fail("The workbook ZIP archive is incomplete.")
}

export const readPaytmWorkbook = async (file) => {
  let sheets
  try {
    const buffer = await file.arrayBuffer()
    validateWorkbookArchive(buffer)
    // Numeric cells stay decimal strings: references and paise must not pass
    // through floating-point rounding. The reader never evaluates formulas.
    sheets = await readExcelFile(buffer, { parseNumber: (text) => text, trim: false })
    // Shared strings can reference one large value from many tiny cells. Bound
    // resolved text as well as ZIP output before normalizing or rendering rows.
    let textSize = 0
    for (const sheet of sheets) for (const row of sheet.data) for (const cell of row) {
      textSize += typeof cell === "string" ? cell.length : 0
      if (textSize > WORKBOOK_LIMITS.text) fail("Workbook exceeds the resolved-text safety limit.")
    }
  } catch (error) {
    if (error?.name === "WorkbookSafetyError") throw error
    throw new Error("This XLSX workbook could not be read. Select an unencrypted, values-only Paytm statement.")
  }
  return parsePaytmWorkbookRows(sheets)
}
