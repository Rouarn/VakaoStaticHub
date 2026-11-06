CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE TABLE resource_roots (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    path        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE file_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    root_id      TEXT NOT NULL REFERENCES resource_roots(id) ON DELETE CASCADE,
    category     TEXT NOT NULL,
    rel_path     TEXT NOT NULL,
    name         TEXT NOT NULL,
    extension    TEXT NOT NULL DEFAULT '',
    size         INTEGER NOT NULL,
    mtime_ms     INTEGER NOT NULL,
    content_hash TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    UNIQUE (root_id, category, rel_path)
);
CREATE INDEX idx_file_entries_hash ON file_entries(content_hash);
CREATE INDEX idx_file_entries_category ON file_entries(root_id, category);

CREATE TABLE share_links (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    token        TEXT NOT NULL UNIQUE,
    root_id      TEXT NOT NULL,
    category     TEXT NOT NULL,
    file_paths   TEXT NOT NULL,
    remark       TEXT NOT NULL DEFAULT '',
    enabled      INTEGER NOT NULL DEFAULT 1,
    expires_at   INTEGER,
    max_accesses INTEGER,
    password_hash TEXT,
    access_count INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_share_links_enabled ON share_links(enabled, expires_at);

CREATE TABLE share_access_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id   INTEGER NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
    ip         TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    success    INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_share_access_logs_share ON share_access_logs(share_id, created_at);

CREATE TABLE apps (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    app_key    TEXT NOT NULL,
    platform   TEXT NOT NULL DEFAULT 'android',
    name       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (app_key, platform)
);

CREATE TABLE app_versions (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id                   INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    version_name             TEXT NOT NULL,
    version_code             INTEGER NOT NULL,
    file_size                INTEGER NOT NULL,
    checksum                 TEXT NOT NULL,
    storage_root_id          TEXT NOT NULL DEFAULT 'software-update',
    category                 TEXT NOT NULL,
    rel_path                 TEXT NOT NULL,
    update_log               TEXT NOT NULL DEFAULT '',
    force_update             INTEGER NOT NULL DEFAULT 0,
    min_version_code         INTEGER NOT NULL DEFAULT 0,
    gray_percent             INTEGER NOT NULL DEFAULT 0 CHECK (gray_percent BETWEEN 0 AND 100),
    gray_auto_increment      INTEGER NOT NULL DEFAULT 0,
    gray_increment_schedule  TEXT NOT NULL DEFAULT '[]',
    scheduled_publish_at     INTEGER,
    scheduled_publish_mode   TEXT NOT NULL DEFAULT 'full',
    scheduled_gray_percent   INTEGER NOT NULL DEFAULT 0,
    status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'offline')),
    offline_reason           TEXT NOT NULL DEFAULT '',
    publish_time             INTEGER,
    remark                   TEXT NOT NULL DEFAULT '',
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL,
    UNIQUE (app_id, version_code)
);
CREATE INDEX idx_app_versions_status ON app_versions(app_id, status, version_code);

CREATE TABLE app_upgrade_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    app_key           TEXT NOT NULL,
    version_id        INTEGER,
    device_id         TEXT NOT NULL,
    from_version_code INTEGER,
    to_version_code   INTEGER,
    event             TEXT NOT NULL,
    fail_code         TEXT NOT NULL DEFAULT '',
    network_type      TEXT NOT NULL DEFAULT '',
    os_version        TEXT NOT NULL DEFAULT '',
    device_model      TEXT NOT NULL DEFAULT '',
    cost_ms           INTEGER,
    created_at        INTEGER NOT NULL
);
CREATE INDEX idx_app_upgrade_events_app ON app_upgrade_events(app_key, created_at);
CREATE INDEX idx_app_upgrade_events_device ON app_upgrade_events(device_id);
CREATE INDEX idx_app_upgrade_events_event ON app_upgrade_events(event);

CREATE TABLE audit_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER,
    username      TEXT NOT NULL,
    action        TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id   TEXT NOT NULL DEFAULT '',
    details       TEXT NOT NULL DEFAULT '{}',
    ip            TEXT NOT NULL DEFAULT '',
    user_agent    TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL
);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
