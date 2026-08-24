const assert = require("node:assert/strict");
const fs = require("node:fs");

const beaconUrl = "https://static.cloudflareinsights.com/beacon.min.js";
const token = "eea4dfe6f095498b8e3ec03c14941504";
const htmlFiles = fs.readdirSync(".").filter((file) => file.endsWith(".html"));

assert.deepEqual(
  htmlFiles.sort(),
  ["admin-console.html", "admin.html", "aggregation.html", "index.html", "readme.html"],
  "Update the analytics coverage test when adding or removing an HTML entry point",
);

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  assert.equal(
    html.split(beaconUrl).length - 1,
    1,
    `${file} should load the Cloudflare beacon exactly once`,
  );
  assert.ok(html.includes(token), `${file} should use the configured analytics token`);
}

console.log("All HTML entry points include analytics exactly once.");
