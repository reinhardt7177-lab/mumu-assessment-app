ALTER TABLE attempt_response_evidence DROP CONSTRAINT IF EXISTS attempt_response_evidence_modality_check;
-- statement-breakpoint
ALTER TABLE attempt_response_evidence ADD CONSTRAINT attempt_response_evidence_modality_check
  CHECK (modality IN ('photo', 'speech', 'chat', 'screen'));
-- statement-breakpoint
ALTER TABLE evidence_assets DROP CONSTRAINT IF EXISTS evidence_assets_mime_type_check;
-- statement-breakpoint
ALTER TABLE evidence_assets ADD CONSTRAINT evidence_assets_mime_type_check
  CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'video/webm', 'video/mp4'));
