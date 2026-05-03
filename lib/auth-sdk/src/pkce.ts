// Isomorphic PKCE helpers. Uses Web Crypto (`globalThis.crypto.subtle`) which
// is available in both modern browsers and Node 20+.

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  // btoa is available in Node 20+ and all modern browsers.
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomUrlSafeString(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export async function generatePkcePair(): Promise<PkcePair> {
  const codeVerifier = randomUrlSafeString(32);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  return { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
}
