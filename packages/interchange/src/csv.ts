export type CsvRow = Record<string, string>;

export function stringifyCsv(headers: string[], rows: CsvRow[]): string {
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(escapeField).join(","))
    .join("\n")}\n`;
}

export function parseCsv(csv: string): CsvRow[] {
  const records = parseRecords(csv);
  const headers = records.shift();
  if (!headers) return [];
  return records
    .filter((record) => record.some((field) => field !== ""))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

function parseRecords(csv: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!;
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      record.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  return records;
}

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
