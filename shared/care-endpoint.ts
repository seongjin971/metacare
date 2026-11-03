/** Validate the API base before sending device credentials to it. */
export function configuredCareEndpoint(value: string, development: boolean): string {
  const invalid = '복약 공유 서버의 HTTPS 주소를 확인해 주세요.';
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(invalid); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const local = host === 'localhost' || host.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(host)
    || host === '[::1]' || host === '[::]' || host === '0.0.0.0' || host === '10.0.2.2'
    || /^\[::ffff:7f[0-9a-f]{2}:/.test(host);
  if (url.username || url.password || url.search || url.hash || (!development && local)
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
