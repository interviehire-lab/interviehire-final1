-- AlterTable
-- Backblaze B2 object key for the interview recording (replaces
-- recordingDriveFileId/recordingDriveUrl for NEW uploads only). IF NOT
-- EXISTS keeps this idempotent, matching the repo's other hand-rolled
-- migrations (see 20260720000000_add_recording_drive_fields).
ALTER TABLE "InterviewSession" ADD COLUMN IF NOT EXISTS "recordingB2Key" TEXT;
