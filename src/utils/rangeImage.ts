/**
 * Range image → xyz point cloud conversion.
 *
 * Port of Waymo SDK's `lidar_utils.convert_range_image_to_point_cloud()`.
 * Converts LiDAR range images from the Waymo Open Dataset v2 Parquet format
 * into 3D point clouds in vehicle frame.
 *
 * Math:
 *   x = range × cos(inclination) × cos(azimuth)
 *   y = range × cos(inclination) × sin(azimuth)
 *   z = range × sin(inclination)
 *   Then apply extrinsic 4×4 matrix (sensor frame → vehicle frame).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LidarCalibration {
  laserName: number;
  /** 4×4 row-major transform matrix (sensor → vehicle frame) */
  extrinsic: number[];
  /** Non-uniform beam inclinations (e.g. 64 values for TOP). null = uniform. */
  beamInclinationValues: number[] | null;
  /** Min inclination angle (radians). Used for uniform interpolation. */
  beamInclinationMin: number;
  /** Max inclination angle (radians). Used for uniform interpolation. */
  beamInclinationMax: number;
}

export interface RangeImage {
  /** Flat array of [range, intensity, elongation, nlz] × (height × width) */
  values: number[] | Float32Array;
  /** [height, width, channels] */
  shape: [number, number, number];
}

/** Floats per point in the interleaved buffer: x,y,z,intensity,range,elongation */
export const POINT_STRIDE = 6;

export interface PointCloud {
  /** Interleaved [x, y, z, intensity, range, elongation, ...] in vehicle frame */
  positions: Float32Array;
  /** Number of valid points */
  pointCount: number;
}

// ---------------------------------------------------------------------------
// Calibration parsing from Parquet row
// ---------------------------------------------------------------------------

export function parseLidarCalibration(row: Record<string, unknown>): LidarCalibration {
  return {
    laserName: row['key.laser_name'] as number,
    extrinsic: row['[LiDARCalibrationComponent].extrinsic.transform'] as number[],
    beamInclinationValues:
      (row['[LiDARCalibrationComponent].beam_inclination.values'] as number[] | undefined) ?? null,
    beamInclinationMin: row['[LiDARCalibrationComponent].beam_inclination.min'] as number,
    beamInclinationMax: row['[LiDARCalibrationComponent].beam_inclination.max'] as number,
  };
}

// ---------------------------------------------------------------------------
// Core conversion
// ---------------------------------------------------------------------------

/**
 * Compute beam inclination angles for each row of the range image.
 */
function computeInclinations(height: number, calib: LidarCalibration): Float32Array {
  const inclinations = new Float32Array(height);

  if (calib.beamInclinationValues && calib.beamInclinationValues.length === height) {
    // Values stored ascending; range image row 0 = max (top), so reverse
    for (let i = 0; i < height; i++) {
      inclinations[i] = calib.beamInclinationValues[height - 1 - i];
    }
  } else {
    // Uniform interpolation: row 0 = max, last row = min
    for (let i = 0; i < height; i++) {
      const t = height > 1 ? i / (height - 1) : 0;
      inclinations[i] = calib.beamInclinationMax * (1 - t) + calib.beamInclinationMin * t;
    }
  }

  return inclinations;
}

/**
 * Compute azimuth angles for each column of the range image.
 */
function computeAzimuths(width: number, azCorrection: number): Float32Array {
  const azimuths = new Float32Array(width);
  for (let col = 0; col < width; col++) {
    const ratio = (width - col - 0.5) / width;
    azimuths[col] = (ratio * 2 - 1) * Math.PI - azCorrection;
  }
  return azimuths;
}

/**
 * Convert a range image to a 3D point cloud (vehicle frame).
 */
export function convertRangeImageToPointCloud(
  rangeImage: RangeImage,
  calibration: LidarCalibration,
): PointCloud {
  const [height, width, channels] = rangeImage.shape;
  const values = rangeImage.values;

  const inclinations = computeInclinations(height, calibration);
  const azCorrection = Math.atan2(calibration.extrinsic[4], calibration.extrinsic[0]);
  const azimuths = computeAzimuths(width, azCorrection);

  // Precompute trig tables
  const cosInc = new Float32Array(height);
  const sinInc = new Float32Array(height);
  for (let r = 0; r < height; r++) {
    cosInc[r] = Math.cos(inclinations[r]);
    sinInc[r] = Math.sin(inclinations[r]);
  }
  const cosAz = new Float32Array(width);
  const sinAz = new Float32Array(width);
  for (let c = 0; c < width; c++) {
    cosAz[c] = Math.cos(azimuths[c]);
    sinAz[c] = Math.sin(azimuths[c]);
  }

  // Extrinsic matrix components (row-major 4×4)
  const e = calibration.extrinsic;
  const e00 = e[0], e01 = e[1], e02 = e[2], e03 = e[3];
  const e10 = e[4], e11 = e[5], e12 = e[6], e13 = e[7];
  const e20 = e[8], e21 = e[9], e22 = e[10], e23 = e[11];

  const maxPoints = height * width;
  const output = new Float32Array(maxPoints * POINT_STRIDE);
  let pointCount = 0;

  for (let row = 0; row < height; row++) {
    const ci = cosInc[row];
    const si = sinInc[row];

    for (let col = 0; col < width; col++) {
      const pixelIdx = (row * width + col) * channels;
      const range = values[pixelIdx];

      if (range <= 0) continue;

      const intensity = values[pixelIdx + 1];
      const elongation = values[pixelIdx + 2];

      // Spherical → Cartesian (sensor frame)
      const x = range * ci * cosAz[col];
      const y = range * ci * sinAz[col];
      const z = range * si;

      // Apply extrinsic (sensor → vehicle frame)
      const vx = e00 * x + e01 * y + e02 * z + e03;
      const vy = e10 * x + e11 * y + e12 * z + e13;
      const vz = e20 * x + e21 * y + e22 * z + e23;

      const outIdx = pointCount * POINT_STRIDE;
      output[outIdx] = vx;
      output[outIdx + 1] = vy;
      output[outIdx + 2] = vz;
      output[outIdx + 3] = intensity;
      output[outIdx + 4] = range;
      output[outIdx + 5] = elongation;

      pointCount++;
    }
  }

  return { positions: output.subarray(0, pointCount * POINT_STRIDE), pointCount };
}

/**
 * Convert range images from all LiDAR sensors into a merged point cloud.
 * Returns positions (xyz) and attributes (intensity, range, elongation) as separate arrays
 * compatible with our existing PointCloud component.
 */
export function convertAllSensorsToSplit(
  rangeImages: Map<number, RangeImage>,
  calibrations: Map<number, LidarCalibration>,
): { positions: Float32Array; attributes: Float32Array; pointCount: number } {
  // Convert each sensor
  const clouds: PointCloud[] = [];
  let totalPoints = 0;

  for (const [laserName, rangeImage] of rangeImages) {
    const calib = calibrations.get(laserName);
    if (!calib) continue;
    const cloud = convertRangeImageToPointCloud(rangeImage, calib);
    clouds.push(cloud);
    totalPoints += cloud.pointCount;
  }

  // Merge into split position/attribute arrays
  const positions = new Float32Array(totalPoints * 3);
  const attributes = new Float32Array(totalPoints * 3);
  let offset = 0;

  for (const cloud of clouds) {
    for (let i = 0; i < cloud.pointCount; i++) {
      const src = i * POINT_STRIDE;
      const dst3 = (offset + i) * 3;
      // xyz
      positions[dst3] = cloud.positions[src];
      positions[dst3 + 1] = cloud.positions[src + 1];
      positions[dst3 + 2] = cloud.positions[src + 2];
      // intensity, range, elongation
      attributes[dst3] = cloud.positions[src + 3];
      attributes[dst3 + 1] = cloud.positions[src + 4];
      attributes[dst3 + 2] = cloud.positions[src + 5];
    }
    offset += cloud.pointCount;
  }

  return { positions, attributes, pointCount: totalPoints };
}
