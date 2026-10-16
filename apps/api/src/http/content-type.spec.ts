import { describe, expect, it } from 'vitest';
import { contentTypeEssence } from './content-type';

describe('Content-Type protocol parsing', () => {
  it.each([
    ['image/png ; charset=utf-8', 'image/png'],
    [' Text/Plain ; note="a;b"', 'text/plain'],
    ['Application/JSON; charset=utf-8', 'application/json'],
  ])(
    'normalizes %s without treating parameters as part of the type',
    (header, expected) => {
      expect(contentTypeEssence(header)).toBe(expected);
    },
  );

  it.each([undefined, '', 'not-a-type', 'image/', '/png'])(
    'rejects invalid header %s',
    (header) => {
      expect(contentTypeEssence(header)).toBeUndefined();
    },
  );
});
