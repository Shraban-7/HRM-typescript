import { EventEmitter } from 'node:events';
import http from 'node:http';
import type { Socket } from 'node:net';
import { type NextRequest, NextResponse } from 'next/server';
import { createApp } from '../../../../server/app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CapturedResponse {
  statusCode: number;
  headers: Map<string, string | string[]>;
  body: Buffer;
}

async function handleWithExpress(request: NextRequest): Promise<NextResponse> {
  const app = createApp();
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  const rawBody =
    method === 'GET' || method === 'HEAD'
      ? Buffer.alloc(0)
      : Buffer.from(await request.arrayBuffer());

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  if (rawBody.length > 0) {
    headers['content-length'] = String(rawBody.length);
  } else {
    delete headers['content-length'];
    delete headers['transfer-encoding'];
  }

  const forwardedFor = headers['x-forwarded-for']?.split(',')[0]?.trim();
  const remoteAddress = forwardedFor || '127.0.0.1';

  const fakeSocket = {
    remoteAddress,
    encrypted: url.protocol === 'https:',
    destroyed: false,
    writable: true,
    destroy: () => undefined,
    on: () => fakeSocket,
    once: () => fakeSocket,
    off: () => fakeSocket,
    removeListener: () => fakeSocket,
    resume: () => fakeSocket,
    pause: () => fakeSocket,
  } as unknown as Socket;

  const incoming = new http.IncomingMessage(fakeSocket);
  incoming.method = method;
  incoming.url = `${url.pathname}${url.search}`;
  incoming.headers = headers;
  incoming.httpVersion = '1.1';
  incoming.httpVersionMajor = 1;
  incoming.httpVersionMinor = 1;
  incoming._read = () => undefined;

  const contentType = headers['content-type'] ?? '';
  if (rawBody.length > 0 && contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(rawBody.toString('utf8'));
      Object.assign(incoming, { body: parsed, _body: true });
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request payload.' }, { status: 400 });
    }
  } else if (rawBody.length > 0) {
    incoming.push(rawBody);
  }
  incoming.push(null);

  const captured = await new Promise<CapturedResponse>((resolve, reject) => {
    const resEmitter = new EventEmitter();
    const outHeaders = new Map<string, string | string[]>();
    const chunks: Buffer[] = [];
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve({
        statusCode: mockRes.statusCode || 200,
        headers: outHeaders,
        body: Buffer.concat(chunks),
      });
    };

    const normalizeHeaderValue = (val: unknown): string | string[] => {
      if (Array.isArray(val)) return val.map((v) => String(v));
      return String(val);
    };

    const mockRes = Object.assign(resEmitter, {
      statusCode: 200,
      statusMessage: 'OK',
      headersSent: false,
      writableEnded: false,
      finished: false,
      socket: fakeSocket,
      setHeader(name: string, value: unknown) {
        outHeaders.set(name.toLowerCase(), normalizeHeaderValue(value));
        return mockRes;
      },
      appendHeader(name: string, value: unknown) {
        const key = name.toLowerCase();
        const existing = outHeaders.get(key);
        const nextVal = normalizeHeaderValue(value);
        if (!existing) {
          outHeaders.set(key, nextVal);
        } else {
          const prevArr = Array.isArray(existing) ? existing : [existing];
          const nextArr = Array.isArray(nextVal) ? nextVal : [nextVal];
          outHeaders.set(key, [...prevArr, ...nextArr]);
        }
        return mockRes;
      },
      getHeader(name: string) {
        return outHeaders.get(name.toLowerCase());
      },
      getHeaders() {
        return Object.fromEntries(outHeaders.entries());
      },
      getHeaderNames() {
        return Array.from(outHeaders.keys());
      },
      hasHeader(name: string) {
        return outHeaders.has(name.toLowerCase());
      },
      removeHeader(name: string) {
        outHeaders.delete(name.toLowerCase());
      },
      writeHead(
        status: number,
        reasonOrHeaders?: string | Record<string, unknown>,
        maybeHeaders?: Record<string, unknown>
      ) {
        mockRes.statusCode = status;
        const hdrs = typeof reasonOrHeaders === 'string' ? maybeHeaders : reasonOrHeaders;
        if (hdrs) {
          for (const [k, v] of Object.entries(hdrs)) {
            if (v !== undefined) {
              outHeaders.set(k.toLowerCase(), normalizeHeaderValue(v));
            }
          }
        }
        mockRes.headersSent = true;
        return mockRes;
      },
      flushHeaders() {
        mockRes.headersSent = true;
      },
      write(chunk: unknown, encoding?: BufferEncoding | (() => void), cb?: () => void) {
        mockRes.headersSent = true;
        if (chunk !== undefined && chunk !== null) {
          if (Buffer.isBuffer(chunk)) {
            chunks.push(chunk);
          } else if (chunk instanceof Uint8Array) {
            chunks.push(Buffer.from(chunk));
          } else {
            const enc = typeof encoding === 'string' ? encoding : 'utf8';
            chunks.push(Buffer.from(String(chunk), enc));
          }
        }
        const callback = typeof encoding === 'function' ? encoding : cb;
        if (callback) callback();
        return true;
      },
      end(chunk?: unknown, encoding?: BufferEncoding | (() => void), cb?: () => void) {
        if (typeof chunk === 'function') {
          cb = chunk as () => void;
          chunk = undefined;
        }
        if (chunk !== undefined && chunk !== null) {
          mockRes.write(chunk, typeof encoding === 'string' ? encoding : 'utf8');
        }
        mockRes.headersSent = true;
        mockRes.writableEnded = true;
        mockRes.finished = true;
        mockRes.emit('finish');
        const callback = typeof encoding === 'function' ? encoding : cb;
        if (callback) callback();
        finish();
        return mockRes;
      },
      cork: () => undefined,
      uncork: () => undefined,
      setTimeout: () => mockRes,
    });

    app(
      incoming as unknown as Parameters<typeof app>[0],
      mockRes as unknown as Parameters<typeof app>[1],
      (err: unknown) => {
        if (err) {
          reject(err);
        } else if (!resolved) {
          mockRes.statusCode = 404;
          finish();
        }
      }
    );
  });

  const responseHeaders = new Headers();
  captured.headers.forEach((value, key) => {
    if (key === 'content-length' || key === 'transfer-encoding') return;
    if (Array.isArray(value)) {
      for (const v of value) responseHeaders.append(key, v);
    } else {
      responseHeaders.set(key, value);
    }
  });

  const isNullBodyStatus =
    captured.statusCode === 204 || captured.statusCode === 205 || captured.statusCode === 304;

  return new NextResponse(isNullBodyStatus ? null : new Uint8Array(captured.body), {
    status: captured.statusCode,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest) {
  return handleWithExpress(request);
}

export async function POST(request: NextRequest) {
  return handleWithExpress(request);
}

export async function PUT(request: NextRequest) {
  return handleWithExpress(request);
}

export async function PATCH(request: NextRequest) {
  return handleWithExpress(request);
}

export async function DELETE(request: NextRequest) {
  return handleWithExpress(request);
}

export async function OPTIONS(request: NextRequest) {
  return handleWithExpress(request);
}
