export const publicHost = 'github.com';
export const sitesKey = 'refine:enabledHosts';

export function hostPattern(host: string): string {
  return 'https://' + host + '/*';
}

// Only exact HTTPS grants are eligible for persistent injection.
export function grantedHosts(permissions: chrome.permissions.Permissions): string[] {
  return (permissions.origins ?? []).flatMap(pattern => {
    if (!pattern.startsWith('https://') || !pattern.endsWith('/*') || pattern.slice(0, -2).includes('*')) return [];
    const host = new URL(pattern).hostname;
    return host !== publicHost && pattern === hostPattern(host) ? [host] : [];
  }).sort();
}
