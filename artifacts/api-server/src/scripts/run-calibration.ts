/**
 * Standalone entry point for the calibration job.
 *
 * Kept separate from calibration-job.ts because that module is imported by the
 * server (cron.ts). A self-executing block there would run — and exit — inside
 * the bundled server. This file is only ever run directly via tsx:
 *
 *   pnpm --filter @workspace/api-server run calibrate
 */

import { calibrationJob } from "./calibration-job";

calibrationJob
  .runHistoricalCalibration()
  .then((r) => {
    console.log("Calibration complete:", r);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
