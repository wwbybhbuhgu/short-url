-- Migration number: 0000    2026-05-16T04:05:00.000Z
-- Create links table for short URL service

CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    title TEXT,
    clicks INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    domain TEXT,
    page_title TEXT,
    page_content TEXT,
    moderation_status TEXT DEFAULT 'pending',
    moderation_result TEXT,
    moderated_at DATETIME,
    is_blocked INTEGER DEFAULT 0
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_links_slug ON links(slug);
CREATE INDEX IF NOT EXISTS idx_links_created_at ON links(created_at);
CREATE INDEX IF NOT EXISTS idx_links_moderation_status ON links(moderation_status);
CREATE INDEX IF NOT EXISTS idx_links_domain ON links(domain);