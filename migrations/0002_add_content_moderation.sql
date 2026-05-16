-- Migration number: 0002    2026-05-16T00:00:00.000Z
-- Add content moderation fields to links table

ALTER TABLE links ADD COLUMN domain TEXT;
ALTER TABLE links ADD COLUMN page_title TEXT;
ALTER TABLE links ADD COLUMN page_content TEXT;
ALTER TABLE links ADD COLUMN moderation_status TEXT DEFAULT 'pending';
ALTER TABLE links ADD COLUMN moderation_result TEXT;
ALTER TABLE links ADD COLUMN moderated_at DATETIME;
ALTER TABLE links ADD COLUMN is_blocked INTEGER DEFAULT 0;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_links_moderation_status ON links(moderation_status);
CREATE INDEX IF NOT EXISTS idx_links_domain ON links(domain);
