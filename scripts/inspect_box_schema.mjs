import { readFileSync } from "fs";
import { parquetMetadata, parquetRead } from "hyparquet";
import { compressors } from "hyparquet-compressors";

const f = readFileSync("scripts/_scan_tmp/lidar_box/10023947602400723454_1120_000_1140_000.parquet");
const ab = f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength);
const file = { byteLength: ab.byteLength, slice: (s, e) => ab.slice(s, e) };

const meta = parquetMetadata(ab);
console.log("COLUMNS:");
meta.schema.forEach((col, i) => console.log(`  [${i}] ${col.name} (${col.element?.type ?? col.type ?? "group"})`));

console.log("\nFIRST 3 ROWS:");
await parquetRead({
  file,
  compressors,
  rowEnd: 3,
  onComplete: (rows) => {
    for (const row of rows) {
      console.log(row);
    }
  },
});
