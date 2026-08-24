const assert = require("node:assert/strict");
const fs = require("node:fs");

const beaconUrl = "https://static.cloudflareinsights.com/beacon.min.js";
const token = "eea4dfe6f095498b8e3ec03c14941504";

for (const file of ["index.html", "readme.html"]) {
  const html = fs.readFileSync(file, "utf8");
  assert.equal(
    html.split(beaconUrl).length - 1,
    1,
    `${file} should load the Cloudflare beacon exactly once`,
  );
  assert.ok(html.includes(token), `${file} should use the configured analytics token`);
}

for (const file of ["admin.html", "admin-console.html", "aggregation.html"]) {
  const html = fs.readFileSync(file, "utf8");
  assert.ok(!html.includes(beaconUrl), `${file} should not load public-page analytics`);
  assert.ok(!html.includes(token), `${file} should not contain the analytics token`);
}

console.log("Analytics scope checks passed.");
