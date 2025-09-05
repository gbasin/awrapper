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
      lifecycle text not null,
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
  lifecycle: 'oneshot' | 'persistent';
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
};

export type Message = {
  id: string;
  session_id: string;
  turn_id?: string | null;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  created_at: number;
};

