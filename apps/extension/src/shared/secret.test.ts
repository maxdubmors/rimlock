import { Console } from 'node:console';
import { PassThrough } from 'node:stream';
import { format, inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { Secret } from './secret';

const marker = 'rmlk-canary-0123';

describe('a Secret', () => {
  it('reveals the text it holds', () => {
    expect(Secret.fromText(marker).reveal()).toBe(marker);
  });

  it('reveals UTF-8 bytes as text', () => {
    expect(new Secret(new Uint8Array([0x70, 0xc3, 0xa4, 0x73, 0x73])).reveal()).toBe('päss');
  });

  it('zeroes its bytes on wipe and reveals nothing after it', () => {
    const bytes = new TextEncoder().encode(marker);
    const secret = new Secret(bytes);
    secret.wipe();
    expect([...bytes].every((byte) => byte === 0)).toBe(true);
    expect(secret.reveal()).toBe('');
  });
});

describe('a Secret written anywhere but the protocol codec', () => {
  const secret = Secret.fromText(marker);

  it('is [Secret] under toString', () => {
    expect(secret.toString()).toBe('[Secret]');
  });

  it('is [Secret] under String() and concatenation', () => {
    expect(String(secret)).toBe('[Secret]');
    expect('key: ' + String(secret)).toBe('key: [Secret]');
  });

  it('is [Secret] under toJSON and JSON.stringify', () => {
    expect(secret.toJSON()).toBe('[Secret]');
    expect(JSON.stringify({ password: secret })).toBe('{"password":"[Secret]"}');
  });

  it('is [Secret] under inspection, hidden properties included', () => {
    expect(inspect(secret)).toBe('[Secret]');
    expect(inspect({ password: secret }, { showHidden: true, depth: Infinity })).toBe(
      '{ password: [Secret] }',
    );
    expect(format('%o %O %s', secret, secret, secret)).toBe('[Secret] [Secret] [Secret]');
  });

  it('shows no content even when inspection ignores its custom form', () => {
    expect(inspect(secret, { customInspect: false, showHidden: true })).not.toContain(marker);
    expect(inspect(secret, { customInspect: false, showHidden: true })).not.toContain('Uint8Array');
  });

  it('is [Secret] under console.log', () => {
    const out = new PassThrough();
    new Console({ stdout: out }).log('unlocked with', secret, { secret });
    expect(String(out.read())).toBe('unlocked with [Secret] { secret: [Secret] }\n');
  });
});
