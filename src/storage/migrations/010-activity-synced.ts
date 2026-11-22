import type { Migration } from "./types";
// Activity upload: a per-call synced flag replaces the id cursor, so a still-running call is sent once it completes.
export const activitySynced: Migration = {
  id: "010-activity-synced",
  up(db) {
    db.exec(`
      ALTER TABLE tool_calls ADD COLUMN synced INTEGER NOT NULL DEFAULT 0;
      UPDATE tool_calls SET synced = 1
       WHERE id <= COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'company:activity_cursor'), id);
      DELETE FROM settings WHERE key = 'company:activity_cursor';
      CREATE INDEX idx_tool_calls_unsynced ON tool_calls (id) WHERE synced = 0;
    `);
  },
};
