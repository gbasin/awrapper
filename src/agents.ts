import { getDb, type Agent } from './db.js';

export function ensureAgentsRegistry() {
  const db = getDb();
  const existing = db.prepare('select count(*) as c from agents where id = ?').get('codex') as { c: number };
  if (!existing || existing.c === 0) {
    const agent: Agent = {
      id: 'codex',
      name: 'OpenAI Codex CLI',
      command_template: 'codex',
      allowed_params_json: JSON.stringify({
        model: { type: 'string', optional: true },
        cd: { type: 'string', optional: true }
      }),
      env_defaults_json: JSON.stringify({}),
      logging_hints_json: JSON.stringify({ paths: ['~/.codex/log/codex-tui.log'] })
    };
    db.prepare(
      'insert into agents (id, name, command_template, allowed_params_json, env_defaults_json, logging_hints_json) values (@id, @name, @command_template, @allowed_params_json, @env_defaults_json, @logging_hints_json)'
    ).run(agent);
  }
}

