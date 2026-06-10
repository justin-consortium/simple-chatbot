// crypto.randomUUID() is only available in secure contexts (HTTPS, or
// localhost which is treated as secure). On a plain-HTTP production origin it
// is undefined and throws, which crashes any render path that calls it. This
// helper prefers the native API when available and otherwise builds an RFC 4122
// v4 UUID from crypto.getRandomValues(), which IS available in insecure
// contexts too — so it works in every environment.
export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') + '-' +
    hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' +
    hex.slice(8, 10).join('') + '-' +
    hex.slice(10, 16).join('')
  );
}
