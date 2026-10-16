import { createServer, get, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestLogging } from './request-logging';

const observation = vi.hoisted(() => ({
  finish: vi.fn(() => ({ traceId: 'trace-id', spanId: 'span-id' })),
  run: vi.fn((work: () => void) => work()),
  begin: vi.fn(),
  log: vi.fn(),
}));

vi.mock('@workspace/observability', () => ({
  beginHttpRequest: observation.begin.mockReturnValue(observation),
  operationalLogger: { info: observation.log },
}));

const servers: Server[] = [];

async function serve(handle: (response: ServerResponse) => void) {
  let markClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    markClosed = resolve;
  });
  const server = createServer((incoming, outgoing) => {
    outgoing.once('close', markClosed);
    const request = Object.assign(incoming, {
      path: '/files/private-file',
      route: { path: '/files/:fileId' },
    });
    Object.assign(outgoing, { locals: {} });
    requestLogging(request as Request, outgoing as Response, () => {
      handle(outgoing);
    });
  });
  servers.push(server);
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    closed,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('HTTP observation response lifecycle', () => {
  it('records a completed response once with a server-generated request ID', async () => {
    const fixture = await serve((response) =>
      response.writeHead(201).end('ok'),
    );
    const requestId = await new Promise<string | string[] | undefined>(
      (resolve) => {
        get(
          fixture.url,
          { headers: { 'x-request-id': 'untrusted-client-id' } },
          (response) => {
            response.resume();
            response.once('end', () =>
              resolve(response.headers['x-request-id']),
            );
          },
        );
      },
    );

    await expect.poll(() => observation.finish.mock.calls.length).toBe(1);
    await fixture.closed;
    expect(observation.finish).toHaveBeenCalledExactlyOnceWith(
      201,
      '/files/:fileId',
      'completed',
    );
    expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(observation.begin).toHaveBeenCalledExactlyOnceWith(requestId, 'GET');
    expect(observation.log).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ event: 'http.request.completed', requestId }),
    );
  });

  it('records a client disconnect before headers without a fabricated 200', async () => {
    let received!: () => void;
    const started = new Promise<void>((resolve) => {
      received = resolve;
    });
    const fixture = await serve(() => received());
    const request = get(fixture.url);
    request.on('error', () => {});
    await started;
    request.destroy();

    await expect.poll(() => observation.finish.mock.calls.length).toBe(1);
    expect(observation.finish).toHaveBeenCalledExactlyOnceWith(
      undefined,
      '/files/:fileId',
      'aborted',
    );
    expect(observation.log).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        event: 'http.request.aborted',
        statusCode: undefined,
      }),
    );
  });

  it('records an interrupted body as aborted even when headers were successful', async () => {
    const fixture = await serve((response) => {
      response.writeHead(200).write('partial');
    });
    await new Promise<void>((resolve) => {
      const request = get(fixture.url, (response) => {
        response.once('data', () => {
          response.destroy();
          resolve();
        });
      });
      request.on('error', () => {});
    });

    await expect.poll(() => observation.finish.mock.calls.length).toBe(1);
    expect(observation.finish).toHaveBeenCalledExactlyOnceWith(
      200,
      '/files/:fileId',
      'aborted',
    );
    expect(observation.log).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        event: 'http.request.aborted',
        statusCode: 200,
      }),
    );
  });

  it('records a socket error once without logging its private message', async () => {
    const fixture = await serve((response) => {
      response.destroy(new Error('private-storage-failure'));
    });
    await new Promise<void>((resolve) => {
      get(fixture.url).once('error', () => resolve());
    });

    await expect.poll(() => observation.finish.mock.calls.length).toBe(1);
    await fixture.closed;
    expect(observation.finish).toHaveBeenCalledExactlyOnceWith(
      undefined,
      '/files/:fileId',
      'error',
    );
    expect(observation.log).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ event: 'http.request.error' }),
    );
    expect(JSON.stringify(observation.log.mock.calls)).not.toContain(
      'private-storage-failure',
    );
  });
});
