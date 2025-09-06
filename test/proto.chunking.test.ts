import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';

// Unit tests for stream chunking/line framing in CodexProtoSession

describe('CodexProtoSession stdout chunking', () => {
  it('parses a single JSON event split across two chunks', async () => {
    const out = new PassThrough();
    const fakeProc = { stdout: out, stdin: new PassThrough() } as any;
    const { CodexProtoSession } = await import('../src/proto.ts');

    const session = new CodexProtoSession(fakeProc);

    const got = new Promise<any>((resolve) => {
      session.onEvent((e) => resolve(e));
    });

    const obj = { id: 'run1', msg: { type: 'agent_message', message: 'Hello' } };
    const line = JSON.stringify(obj) + '\n';
    // Write partial then remainder to simulate chunk boundary in the middle of JSON
    const mid = Math.floor(line.length / 2);
    out.write(line.slice(0, mid));
    out.write(line.slice(mid));

    const ev = await got;
    expect(ev.id).toBe('run1');
    expect(ev.msg?.type).toBe('agent_message');
    expect(ev.msg?.message).toBe('Hello');
  });

  it('parses multiple JSONL events delivered in a single chunk', async () => {
    const out = new PassThrough();
    const fakeProc = { stdout: out, stdin: new PassThrough() } as any;
    const { CodexProtoSession } = await import('../src/proto.ts');

    const session = new CodexProtoSession(fakeProc);

    const events: any[] = [];
    session.onEvent((e) => events.push(e));

    const e1 = { id: 'a', msg: { type: 'agent_message', message: 'one' } };
    const e2 = { id: 'b', msg: { type: 'agent_message', message: 'two' } };
    const payload = JSON.stringify(e1) + '\n' + JSON.stringify(e2) + '\n';
    // Deliver both lines in a single chunk
    out.write(payload);

    // Small delay to allow event loop to process the data handler
    await new Promise((r) => setTimeout(r, 10));

    expect(events.length).toBe(2);
    expect(events[0].id).toBe('a');
    expect(events[0].msg.message).toBe('one');
    expect(events[1].id).toBe('b');
    expect(events[1].msg.message).toBe('two');
  });
});

