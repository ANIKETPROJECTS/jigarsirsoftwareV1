// idCodec.js — Base64URL encode/decode for IDs in browser URLs.
//
// WHY: Internal PKs like "ADS!HO!123" reveal company codes and record counts.
// Encoding hides the structure without any DB changes.
//
// The try/catch in decodeId provides backward-compat: if a bookmark or direct
// link somehow contains a plain ID it falls back to using it as-is.

export function encodeId(id) {
  return btoa(String(id))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function decodeId(token) {
  if (!token) return token;
  if (token === 'new') return 'new';   // sentinel — never base64-decode it
  try {
    return atob(token.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return token; // fallback for plain IDs
  }
}
