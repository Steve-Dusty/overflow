/**
 * Parquet file loading utilities for Waymo Open Dataset v2.0.
 *
 * Uses hyparquet for browser-native Parquet reading with BROTLI decompression.
 * Supports both URL-based loading (static serving) and File API (drag & drop).
 *
 * For URL sources:
 *   - Small files (<10 MB): pre-fetched into memory
 *   - Large files (>=10 MB): Range Request based (needs server support)
 */

import {
  parquetMetadataAsync,
  parquetReadObjects,
  asyncBufferFromUrl,
  cachedAsyncBuffer,
  type AsyncBuffer,
  type FileMetaData,
} from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

export type ParquetRow = Record<string, unknown>;

const SMALL_FILE_THRESHOLD = 10 * 1024 * 1024; // 10 MB

// ---------------------------------------------------------------------------
// AsyncBuffer implementations
// ---------------------------------------------------------------------------

function asyncBufferFromArrayBuffer(ab: ArrayBuffer): AsyncBuffer {
  return {
    byteLength: ab.byteLength,
    slice(start: number, end?: number): Promise<ArrayBuffer> {
      return Promise.resolve(ab.slice(start, end));
    },
  };
}

function asyncBufferFromFile(file: File): AsyncBuffer {
  return {
    byteLength: file.size,
    slice(start: number, end?: number): Promise<ArrayBuffer> {
      return file.slice(start, end).arrayBuffer();
    },
  };
}

// ---------------------------------------------------------------------------
// WaymoParquetFile — wrapper around a single Parquet file
// ---------------------------------------------------------------------------

export interface WaymoParquetFile {
  component: string;
  buffer: AsyncBuffer;
  metadata: FileMetaData;
  numRows: number;
  rowGroups: Array<{ rowStart: number; rowEnd: number; numRows: number }>;
}

/**
 * Open a Parquet file and parse its metadata.
 */
export async function openParquetFile(
  component: string,
  source: File | string,
): Promise<WaymoParquetFile> {
  let rawBuffer: AsyncBuffer;

  if (source instanceof File) {
    rawBuffer = asyncBufferFromFile(source);
  } else {
    // URL source: check file size first
    const headResp = await fetch(source, { method: 'HEAD' });
    if (!headResp.ok) {
      throw new Error(`Failed to fetch ${source}: ${headResp.status} ${headResp.statusText}`);
    }
    const contentLength = parseInt(headResp.headers.get('Content-Length') ?? '0', 10);

    if (contentLength > 0 && contentLength < SMALL_FILE_THRESHOLD) {
      // Small file: pre-fetch entirely
      const response = await fetch(source);
      const arrayBuffer = await response.arrayBuffer();
      rawBuffer = asyncBufferFromArrayBuffer(arrayBuffer);
    } else {
      // Large file: use Range Requests
      rawBuffer = await asyncBufferFromUrl({ url: source });
    }
  }

  const buffer = cachedAsyncBuffer(rawBuffer);
  const metadata = await parquetMetadataAsync(buffer);

  let offset = 0;
  const rowGroups = metadata.row_groups.map((rg) => {
    const numRows = Number(rg.num_rows);
    const group = { rowStart: offset, rowEnd: offset + numRows, numRows };
    offset += numRows;
    return group;
  });

  return { component, buffer, metadata, numRows: offset, rowGroups };
}

/**
 * Read ALL rows from a Parquet file.
 */
export async function readAllRows(
  pf: WaymoParquetFile,
  columns?: string[],
): Promise<ParquetRow[]> {
  return parquetReadObjects({
    file: pf.buffer,
    metadata: pf.metadata,
    columns,
    compressors,
  });
}

/**
 * Read a specific row range from a Parquet file.
 */
export async function readRowRange(
  pf: WaymoParquetFile,
  rowStart: number,
  rowEnd: number,
  columns?: string[],
): Promise<ParquetRow[]> {
  return parquetReadObjects({
    file: pf.buffer,
    metadata: pf.metadata,
    columns,
    compressors,
    rowStart,
    rowEnd,
  });
}

/**
 * Build a frame index from vehicle_pose rows.
 */
export function buildFrameIndex(
  poseRows: ParquetRow[],
): { timestamps: bigint[]; frameByTimestamp: Map<bigint, number> } {
  const timestamps = poseRows
    .map((row) => row['key.frame_timestamp_micros'] as bigint)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const frameByTimestamp = new Map<bigint, number>();
  timestamps.forEach((ts, i) => frameByTimestamp.set(ts, i));

  return { timestamps, frameByTimestamp };
}

/**
 * Group rows by a column value → Map<key, rows[]>
 */
export function groupRowsBy<T extends ParquetRow>(
  rows: T[],
  column: string,
): Map<unknown, T[]> {
  const map = new Map<unknown, T[]>();
  for (const row of rows) {
    const key = row[column];
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  return map;
}
