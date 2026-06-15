import { Breadcrumb } from '../types';

const SEPARATOR = ' › ';

/**
 * Parses a link href into a human-readable page breadcrumb trail.
 * "inbox/message-from-alice" → "Inbox › Message From Alice"
 * "settings/notifications" → "Settings › Notifications"
 * "/" or "" → "Home"
 */
export function parsePageFromHref(href: string): string {
  // Strip protocol/domain if present (shouldn't be, but just in case)
  let path = href.replace(/^https?:\/\/[^/]+/, '');
  // Strip leading/trailing slashes and hash fragments
  path = path.replace(/^\/+|\/+$/g, '').replace(/#.*$/, '').replace(/\?.*$/, '');

  if (!path) return 'Home';

  return path
    .split('/')
    .filter(Boolean)
    .map(segment =>
      segment
        .replace(/[-_]+/g, ' ')          // dashes/underscores → spaces
        .replace(/\b\w/g, c => c.toUpperCase())  // title case
    )
    .join(SEPARATOR);
}

/**
 * Derives a short sitename from a creation prompt.
 * Takes the first 2-3 meaningful words and title-cases them.
 * "A dashboard for monitoring deep sea research stations" → "Deep Sea Research"
 */
export function siteNameFromPrompt(prompt: string): string {
  const stopWords = new Set(['a', 'an', 'the', 'for', 'of', 'to', 'and', 'in', 'on', 'at', 'by', 'with', 'from', 'is', 'that']);
  const words = prompt
    .replace(/[^\w\s]/g, '')  // strip punctuation
    .split(/\s+/)
    .filter(w => !stopWords.has(w.toLowerCase()))
    .slice(0, 3)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  return words.join(' ') || 'Site';
}

/**
 * Formats raw user input for display in the omnibar.
 * Converts fullstops to › arrows: "google.inbox" → "google › inbox"
 */
export function formatBreadcrumbInput(raw: string): string {
  return raw.split('.').join(SEPARATOR);
}

/**
 * Parses a breadcrumb display string back into structured parts.
 * "google › inbox" → { sitename: "google", page: "inbox" }
 * "google" → { sitename: "google", page: "" }
 */
export function parseBreadcrumb(display: string): Breadcrumb {
  const parts = display.split(SEPARATOR).map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { sitename: '', page: '' };
  }
  if (parts.length === 1) {
    return { sitename: parts[0], page: '' };
  }
  return { sitename: parts[0], page: parts.slice(1).join(' › ') };
}

/**
 * Converts a Breadcrumb into the display string for the omnibar.
 */
export function breadcrumbToDisplay(breadcrumb: Breadcrumb): string {
  if (!breadcrumb.sitename) return '';
  if (!breadcrumb.page) return breadcrumb.sitename;
  return `${breadcrumb.sitename}${SEPARATOR}${breadcrumb.page}`;
}

/**
 * Extracts a Breadcrumb from the <title> tag in generated HTML.
 * Handles common title formats:
 *   "SiteName - PageName" → { sitename: "SiteName", page: "PageName" }
 *   "SiteName | PageName" → { sitename: "SiteName", page: "PageName" }
 *   "PageName" (no separator) → { sitename: "PageName", page: "Home" }
 * Returns null if no <title> found.
 */
export function extractTitleFromHtml(html: string): Breadcrumb | null {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/is);
  if (!match || !match[1].trim()) return null;

  const title = match[1].trim();

  // Try common separators: " - ", " | ", " — ", " · "
  for (const sep of [' - ', ' | ', ' — ', ' · ']) {
    const idx = title.indexOf(sep);
    if (idx > 0) {
      return {
        sitename: title.substring(0, idx).trim(),
        page: title.substring(idx + sep.length).trim(),
      };
    }
  }

  // No separator found — use whole title as sitename
  return { sitename: title, page: 'Home' };
}

/**
 * Strips the <title>...</title> tag from HTML so it doesn't render in the body.
 */
export function stripTitleTag(html: string): string {
  return html.replace(/<title>[^<]*<\/title>/i, '');
}