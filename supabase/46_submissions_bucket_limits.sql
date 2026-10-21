-- Migration 46 (Phase 1, fix 1.8): upload limits on the `submissions` bucket
-- Finding M-4: no size or type limit. Now 10 MB and the same file types the
-- upload form already accepts (AssignmentsPage: pdf, zip, doc, docx, png, jpg,
-- jpeg, txt, csv, xlsx, pptx). Existing objects are not touched.
--
-- UNDO: update storage.buckets set file_size_limit = null, allowed_mime_types = null
--       where id = 'submissions';

begin;

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array[
      'application/pdf',
      'application/zip',
      'application/x-zip-compressed',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/png',
      'image/jpeg',
      'text/plain',
      'text/csv'
    ]
where id = 'submissions';

commit;
