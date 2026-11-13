/**
 * The one favicon every page shipreel writes for people to open (the desk, the studio, the upload
 * checklist): the shipreel mark from the site, a slash on a rounded square, inline as a data URI so
 * a page opened from disk needs no extra file. A page with a brand accent (the desk) tints the
 * square with it, so several campaigns open at once are told apart and still read as shipreel.
 */

export const MARK = { fill: "#f4430c", ink: "#210200" };

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const colour = (value, fallback) => (HEX.test(String(value ?? "")) ? value : fallback);

/** The mark as SVG markup. Anything that is not a hex colour falls back to the shipreel colours. */
export function faviconSvg({ fill = MARK.fill, ink = MARK.ink } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${colour(fill, MARK.fill)}"/><path d="M40 11 L24 53" stroke="${colour(ink, MARK.ink)}" stroke-width="11" stroke-linecap="round"/></svg>`;
}

/** The <link rel="icon"> tag to put in a page's <head>. */
export function faviconTag(options = {}) {
  return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(faviconSvg(options))}">`;
}
