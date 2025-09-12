import Database from 'better-sqlite3';
import { DB_PATH } from './config.js';

let db: Database.Database;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    migrate(db);
  }
  return db;
}

function migrate(db: Database.Database) {
  // Ensure base tables exist with current schema
  db.exec(`
    create table if not exists agents (
      id text primary key,
      name text not null,
      command_template text not null,
      allowed_params_json text,
      env_defaults_json text,
      logging_hints_json text
    );

    create table if not exists sessions (
      id text primary key,
      agent_id text not null,
      repo_path text not null,
      branch text,
      worktree_path text not null,
      status text not null,
      pid integer,
      started_at integer not null,
      last_activity_at integer,
      closed_at integer,
      exit_code integer,
      log_path text not null,
      error_message text,
      agent_log_hint text,
      artifact_dir text,
      block_while_running integer,
      model text,
      approval_policy text,
      sandbox_mode text,
      include_plan_tool integer,
      web_search integer,
      foreign key(agent_id) references agents(id)
    );

    create table if not exists messages (
      id text primary key,
      session_id text not null,
      turn_id text,
      role text not null,
      content text not null,
      created_at integer not null,
      foreign key(session_id) references sessions(id)
    );

    create index if not exists idx_messages_session_created on messages(session_id, created_at);
  `);

  // Migrate legacy sessions table that included a 'lifecycle' column → drop it.
  try {
    const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>;
    const hasLifecycle = cols.some((c) => c.name === 'lifecycle');
    if (hasLifecycle) {
      db.exec('BEGIN');
      db.exec('drop table if exists sessions_new');
      db.exec(`
        create table sessions_new (
          id text primary key,
          agent_id text not null,
          repo_path text not null,
          branch text,
          worktree_path text not null,
          status text not null,
          pid integer,
          started_at integer not null,
          last_activity_at integer,
          closed_at integer,
          exit_code integer,
          log_path text not null,
          error_message text,
          agent_log_hint text,
          artifact_dir text,
          block_while_running integer,
          model text,
          approval_policy text,
          sandbox_mode text,
          include_plan_tool integer,
          web_search integer,
          foreign key(agent_id) references agents(id)
        );
      `);
      db.exec(`
        insert into sessions_new (id, agent_id, repo_path, branch, worktree_path, status, pid, started_at, last_activity_at, closed_at, exit_code, log_path, error_message, agent_log_hint, artifact_dir, block_while_running, model, approval_policy, sandbox_mode, include_plan_tool, web_search)
        select id, agent_id, repo_path, branch, worktree_path, status, pid, started_at, last_activity_at, closed_at, exit_code, log_path, error_message, agent_log_hint, artifact_dir, 1, NULL, NULL, NULL, NULL, NULL
        from sessions;
      `);
      db.exec('drop table sessions');
      db.exec('alter table sessions_new rename to sessions');
      db.exec('COMMIT');
    }
    // Add newly introduced columns if missing
    const ensureCol = (name: string, ddl: string, fill?: string) => {
      const exists = (db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>).some((c) => c.name === name);
      if (!exists) {
        db.exec(`ALTER TABLE sessions ADD COLUMN ${ddl}`);
        if (fill) db.exec(fill);
      }
    };
    ensureCol('block_while_running', 'block_while_running integer', 'UPDATE sessions SET block_while_running = 1 WHERE block_while_running IS NULL');
    ensureCol('model', 'model text');
    ensureCol('approval_policy', 'approval_policy text');
    ensureCol('sandbox_mode', 'sandbox_mode text');
    ensureCol('include_plan_tool', 'include_plan_tool integer');
    ensureCol('web_search', 'web_search integer');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    // swallow; best-effort migration
  }
}

export type Agent = {
  id: string;
  name: string;
  command_template: string;
  allowed_params_json?: string;
  env_defaults_json?: string;
  logging_hints_json?: string;
};

export type Session = {
  id: string;
  agent_id: string;
  repo_path: string;
  branch?: string | null;
  worktree_path: string;
  status: string;
  pid?: number | null;
  started_at: number;
  last_activity_at?: number | null;
  closed_at?: number | null;
  exit_code?: number | null;
  log_path: string;
  error_message?: string | null;
  agent_log_hint?: string | null;
  artifact_dir?: string | null;
  block_while_running?: 0 | 1;
};

export type Message = {
  id: string;
  session_id: string;
  turn_id?: string | null;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  created_at: number;
};
