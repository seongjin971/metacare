/** Validate the API base before sending device credentials to it. */
export function configuredCareEndpoint(value: string, development: boolean): string {
  const invalid = '복약 공유 서버의 HTTPS 주소를 확인해 주세요.';
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(invalid); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // URL normalizes numeric, hexadecimal and IPv6 host spellings before this check.
  // Deployed apps use a named HTTPS service. Emulator and LAN hosts remain available in development.
  const publicName = /^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/.test(host)
    && !/(^|\.)(localhost|local|localdomain|internal|lan|home|home\.arpa)$/.test(host);
  if (url.username || url.password || url.search || url.hash || (!development && !publicName)
    || (url.protocol !== 'https:' && !(development && url.protocol === 'http:'))) throw new Error(invalid);
  return url.toString().replace(/\/+$/, '');
}

/** Keep an existing PC preview session local; a new service must issue its own device credentials. */
export function serviceSessionKey(key: string, configured: string | undefined, development: boolean): string {
  if (!configured) return development ? key : `${key}.unconfigured`;
  let endpoint: string;
  try { endpoint = configuredCareEndpoint(configured, development); } catch { return `${key}.invalid`; }
  // URL serializes to ASCII. Hex keeps the full identity unambiguous and valid for SecureStore keys.
  return `${key}.server.${Array.from(endpoint, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;
}
