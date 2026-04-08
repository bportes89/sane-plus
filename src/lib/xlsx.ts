import * as XLSX from "xlsx";

type SheetRows = Array<Record<string, unknown>> | Array<Array<unknown>>;

function isAoa(rows: SheetRows): rows is Array<Array<unknown>> {
  return rows.length > 0 && Array.isArray(rows[0]);
}

export function buildXlsxBuffer(sheets: { name: string; rows: SheetRows }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const sheet = isAoa(s.rows)
      ? XLSX.utils.aoa_to_sheet(s.rows as Array<Array<unknown>>)
      : XLSX.utils.json_to_sheet(s.rows as Array<Record<string, unknown>>);
    XLSX.utils.book_append_sheet(wb, sheet, s.name.slice(0, 31) || "Sheet1");
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Uint8Array(buf);
}
