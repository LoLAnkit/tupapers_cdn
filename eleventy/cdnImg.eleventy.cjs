/**
 * Nunjucks shortcode for the TUpapers asset CDN.
 *
 * In your Eleventy site's `.eleventy.js`:
 *
 *   const registerCdnImg = require("./cdnImg.eleventy.cjs");
 *   module.exports = function (eleventyConfig) {
 *     registerCdnImg(eleventyConfig);
 *   };
 *
 * Usage:
 *   {% cdnImg "course/bca/first-semester/computer-fundamental/notes/diagram/addressing-modes.webp",
 *             "Addressing modes diagram", "rounded shadow" %}
 *
 * Renders:
 *   <img src="https://cdn.tupapers.com/course/bca/.../addressing-modes.7e8d3c41.webp"
 *        alt="Addressing modes diagram" class="rounded shadow"
 *        width="1200" height="640" loading="lazy" decoding="async">
 *
 * The url comes directly from the shard — no runtime assembly.
 */

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

module.exports = function registerCdnImg(eleventyConfig) {
  eleventyConfig.addShortcode("cdnImg", function (logicalPath, alt = "", cls = "") {
    // Dynamic require interop for the ESM data file.
    // eslint-disable-next-line global-require
    const mod = require("./_data/cdn.js");
    const cdn = mod.default ?? mod;

    // resolve() reads only the relevant shard (lazy, cached).
    const url = cdn.resolve(logicalPath);
    const { width, height } = cdn.meta(logicalPath);
    const dims = width && height ? ` width="${width}" height="${height}"` : "";
    const clsAttr = cls ? ` class="${escapeAttr(cls)}"` : "";

    return (
      `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}"` +
      `${clsAttr}${dims} loading="lazy" decoding="async">`
    );
  });
};
