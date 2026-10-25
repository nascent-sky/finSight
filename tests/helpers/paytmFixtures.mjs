import { zipSync, strToU8 } from "fflate"
import { PAYTM_HEADERS, parsePaytmWorkbookRows, parsePaytmPdfLines } from "../../src/services/paytmStatementParser.js"

// Fictional people, accounts and identifiers, transcribed to the column/wrapping
// structure observed in the supplied samples. No personal source bytes are kept.
export const paytmSheets = [
  { sheet: "Summary", data: [["Paytm Statement", "1 APR'24 - 31 MAR'25"], ["Total credits", "+2,930.00"]] },
  { sheet: "Passbook Payment History", data: [PAYTM_HEADERS.slice(),
    ["09/08/2024", "19:09:52", "Received from Sample Payer One", "sample***@upi", "Example Bank - 0000", "+60.00", "000000001201", "", "", "", ""],
    ["06/05/2024", "06:44:19", "Received from Sample Two", "sample***@upi", "Example Bank - 0000", "+1,500.00", "000000001202", "", "", "", ""],
    ["08/04/2024", "10:19:57", "Received from Sample Three", "sample***@upi", "Example Bank - 0000", "+1,370.00", "000000001203", "", "", "", ""],
  ] },
]
const line = (...values) => values.map(([x, text]) => ({ x, text }))
export const paytmHeading = [line([22, "Paytm Statement for Sample User"]), line([22, "1 APR'24 - 31 MAR'25"]), line([22, "Summary"], [492, "+ Rs.2,930"]), line([22, "Passbook Payments History"])]
export const paytmTableHeader = [line([22, "Date &"]), line([90, "Transaction Details"], [288, "Comments & Tags"], [396, "Your Account"], [492, "Amount"]), line([22, "Time"])]
export const paytmBlocks = [
  [line([22, "09 Aug"], [91, "Received from Sample Payer"], [414, "Example"], [492, "+"], [502, "Rs.60"]), line([22, "7:09 PM"]), line([91, "One"], [414, "Bank - 0000"]), line([91, "UPI ID: sample***@upi on"]), line([91, "UPI Ref No: 000000001201"])],
  [line([22, "06 May"], [91, "Received from Sample Two"], [414, "Example"], [492, "+ Rs.1,500"]), line([22, "6:44 AM"]), line([91, "UPI ID: sample***@upi on"], [414, "Bank - 0000"]), line([91, "UPI Ref No: 000000001202"])],
  [line([22, "08 Apr"], [91, "Received from Sample Three"], [414, "Example"], [492, "+ Rs.1,370"]), line([22, "10:19 AM"]), line([91, "UPI ID: sample***@upi on"], [414, "Bank - 0000"]), line([91, "UPI Ref No: 000000001203"])],
]
export const paytmPdfPages = [[...paytmHeading, ...paytmTableHeader, ...paytmBlocks.flat(), line([22, "Page 1 of 1"]), line([492, "For personal use only"])]]
export const asLayout = (pages) => pages.map((lines) => ({ lines: lines.map((items, index) => ({ y: 950 - index * 14, items, text: items.map((item) => item.text).join(" ") })) }))
export const parseFixturePdf = (pages = paytmPdfPages) => parsePaytmPdfLines(pages.map((lines) => lines.map((items) => items.map((item) => item.text).join(" "))), asLayout(pages))
export const paytmExcelRows = () => parsePaytmWorkbookRows(structuredClone(paytmSheets)).transactions
export const paytmPdfRows = () => parseFixturePdf().transactions
const xml = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
const column = (value) => value < 26 ? String.fromCharCode(65 + value) : `A${String.fromCharCode(65 + value - 26)}`
// Tiny values-only OOXML packages exercise the real browser-compatible reader.
export const workbookEntries = (sheets = paytmSheets) => {
  const strings = [], indices = new Map()
  const cells = sheets.map(({ data }) => data.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
    if (value == null || value === "") return ""
    if (!indices.has(String(value))) { indices.set(String(value), strings.length); strings.push(String(value)) }
    return `<c r="${column(c)}${r + 1}" t="s"><v>${indices.get(String(value))}</v></c>`
  }).join("")}</row>`).join(""))
  const namespace = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
  return {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": `<workbook ${namespace} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(({ sheet }, i) => `<sheet name="${xml(sheet)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst ${namespace} count="${strings.length}" uniqueCount="${strings.length}">${strings.map((value) => `<si><t>${xml(value)}</t></si>`).join("")}</sst>`,
    ...Object.fromEntries(cells.map((data, i) => [`xl/worksheets/sheet${i + 1}.xml`, `<worksheet ${namespace}><sheetData>${data}</sheetData></worksheet>`])),
  }
}
export const workbookFile = (entries = workbookEntries()) => new File([zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])))], "synthetic.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
