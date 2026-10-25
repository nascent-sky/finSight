import { build } from "esbuild"
import { mkdir, writeFile, unlink } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL("../../", import.meta.url))
let counter = 0
export const loadStatementModule = async (entry, plugins = []) => {
  const output = fileURLToPath(new URL(`../../tmp/statement-test-${process.pid}-${counter++}.mjs`, import.meta.url))
  await mkdir(fileURLToPath(new URL("../../tmp/", import.meta.url)), { recursive: true })
  const result = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, packages: "external", platform: "node", format: "esm", jsx: "automatic", write: false, plugins: [...plugins, {
    name: "node-pdf-worker",
    setup(builder) {
      builder.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: "worker-url", namespace: "worker" }))
      builder.onLoad({ filter: /.*/, namespace: "worker" }, () => ({ contents: `export default ${JSON.stringify(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href)}` }))
      builder.onResolve({ filter: /^pdfjs-dist$/ }, () => ({ path: pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href, external: true }))
    },
  }] })
  await writeFile(output, result.outputFiles[0].text)
  try { return await import(pathToFileURL(output).href) }
  finally { await unlink(output) }
}

// Small valid text PDF for exercising actual PDF.js extraction without writing
// financial documents or starting a browser. Input is always sanitized fixture data.
export const textPdf = (pages) => {
  const cmap = "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Synthetic def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfrange <00> <FF> <0000> endbfrange 1 beginbfchar <24> <20B9> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end"
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 4 0 R >>", `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`]
  const kids = []
  for (const lines of pages) {
    const pageId = objects.length + 1, streamId = pageId + 1
    kids.push(`${pageId} 0 R`)
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 1000] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`)
    const escape = (line) => line.replaceAll("₹", "$").replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")
    const stream = lines.map((line, index) => (Array.isArray(line) ? line : [{ x: 40, text: line }]).map(({ x, text }) => `BT /F1 10 Tf 1 0 0 1 ${x} ${950 - index * 14} Tm (${escape(text)}) Tj ET`).join("\n")).join("\n")
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`
  let result = "%PDF-1.4\n"
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(result)); result += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(result)
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new File([result], "synthetic.pdf", { type: "application/pdf" })
}
