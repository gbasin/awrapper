import type { Subprocess } from 'execa';
import { EventEmitter } from 'node:events';

export type CodexProtoEvent = {
  id: string;
  msg: { type: string; [k: string]: any };
};

export class CodexProtoSession {
  private proc: Subprocess;
  private emitter = new EventEmitter();
  private stdoutBuf = '';
  private configured = false;

  constructor(proc: Subprocess) {
    this.proc = proc;
    this.attach();
  }

  private attach() {
    this.proc.stdout?.setEncoding('utf8');
    this.proc.stdout?.on('data', (chunk: string) => {
      // Try parse whole chunk, otherwise line-split
      const tryParse = (s: string) => {
        try {
          const obj = JSON.parse(s);
          this.emitter.emit('event', obj as CodexProtoEvent);
          return true;
        } catch {
          return false;
        }
      };

      if (typeof chunk !== 'string') chunk = String(chunk);
      if (tryParse(chunk)) return;

      this.stdoutBuf += chunk;
      let idx;
      while ((idx = this.stdoutBuf.indexOf('\n')) !== -1) {
        const line = this.stdoutBuf.slice(0, idx).trim();
        this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
        if (!line) continue;
        tryParse(line);
      }
    });
  }

  onEvent(cb: (e: CodexProtoEvent) => void) {
    this.emitter.on('event', cb);
    return () => this.emitter.off('event', cb);
  }

  send(obj: any) {
    const line = JSON.stringify(obj) + '\n';
    if (!this.proc.stdin?.writable) throw new Error('stdin not writable');
    this.proc.stdin.write(line);
  }

  async configureSession(cwd: string, opts?: {
    provider?: { name?: string; base_url?: string; env_key?: string; wire_api?: 'responses' | 'chat' };
    model?: string;
    approval_policy?: string;
  }) {
    if (this.configured) return;
    const id = crypto.randomUUID();
    const provider = {
      name: 'OpenAI',
      base_url: 'https://api.openai.com/v1',
      env_key: 'OPENAI_API_KEY',
      wire_api: 'responses',
      ...(opts?.provider || {})
    };
    const model = opts?.model || 'o4-mini';
    const approval_policy = opts?.approval_policy || 'never';
    const payload = {
      id,
      op: {
        type: 'configure_session',
        provider,
        model,
        model_reasoning_effort: 'low',
        model_reasoning_summary: 'concise',
        approval_policy,
        sandbox_policy: { permissions: ['disk-write-cwd'] },
        cwd
      }
    };

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        off();
        // Resolve anyway; some codex builds may not send configured event
        resolve();
      }, 2000);
      const off = this.onEvent((ev) => {
        if (ev.id === id && ev.msg?.type === 'session_configured') {
          clearTimeout(timeout);
          off();
          this.configured = true;
          resolve();
        } else if (ev.id === id && ev.msg?.type === 'error') {
          clearTimeout(timeout);
          off();
          reject(new Error(String(ev.msg?.message || 'error configuring session')));
        }
      });
      this.send(payload);
    });
  }

  sendUserInput(text: string, runId = crypto.randomUUID()) {
    this.send({
      id: runId,
      op: {
        type: 'user_input',
        items: [{ type: 'text', text }]
      }
    });
    return runId;
  }

  async awaitTaskComplete(runId: string, timeoutMs = 5 * 60_000) {
    // Treat timeoutMs as an inactivity timeout: any event for this run resets the clock.
    let acc = '';
    return new Promise<string>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      const reset = () => {
        if (timeoutMs <= 0) return; // 0 (or negative) disables inactivity timeout
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          off();
          reject(new Error('timeout'));
        }, timeoutMs);
      };

      const off = this.onEvent((ev) => {
        if (ev.id !== runId) return;
        const t = ev.msg?.type;
        if (t === 'agent_message' && typeof ev.msg?.message === 'string') {
          acc += (acc ? '\n' : '') + ev.msg.message;
          reset();
        } else if (t === 'task_complete') {
          off();
          if (timer) clearTimeout(timer);
          resolve(acc);
        } else if (t === 'error') {
          off();
          if (timer) clearTimeout(timer);
          reject(new Error(String(ev.msg?.message || 'error')));
        } else {
          // Any other event for this run indicates activity; reset inactivity timer
          reset();
        }
      });

      // Arm the initial inactivity timer
      reset();

      // Clear timeout on resolve/reject via wrapping as a final safeguard
      const wrap = (fn: any) => (v: any) => {
        if (timer) clearTimeout(timer);
        fn(v);
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (resolve as any) = wrap(resolve);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (reject as any) = wrap(reject);
    });
  }
}
