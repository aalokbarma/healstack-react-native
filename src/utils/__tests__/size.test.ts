import { jsonByteLength, utf8ByteLength } from '../size';

describe('size', () => {
  it('counts ASCII as 1 byte per char', () => {
    expect(utf8ByteLength('abc')).toBe(3);
  });

  it('counts multi-byte characters', () => {
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('你')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });

  it('measures JSON payloads', () => {
    expect(jsonByteLength({ a: 1 })).toBe(utf8ByteLength('{"a":1}'));
  });

  it('returns 0 when JSON.stringify throws', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(jsonByteLength(circular)).toBe(0);
  });
});
