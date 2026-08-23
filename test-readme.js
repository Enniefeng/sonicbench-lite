/* eslint-disable no-console */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "readme.html"), "utf8");

assert(html.includes('class="product-tabs"'), "README must expose the shared top navigation");
assert(html.includes('href="./index.html"'), "README must provide a route back to the evaluation workspace");
assert(html.includes('aria-current="page">README'), "README tab must identify the active page");
assert(html.includes('id="quick-start-title"') && html.includes('id="role-guide-title"') && html.includes('id="data-guide-title"'), "README must cover quick start, role guidance and input/output data");
assert(!html.includes("它解决什么问题") && !html.includes('class="readme-hero"'), "README must open with practical modules instead of promotional sections");
assert(html.includes("评测员") && html.includes("质检员"), "README must include separate guidance for evaluators and quality reviewers");
assert(!/评测管理员|管理员 Mapping|工单准备|结果计算|PNG 对比报告/.test(html), "evaluator README must omit administrator-only workflows and outputs");
assert.strictEqual((html.match(/class="release-item/g) || []).length, 7, "README timeline must contain seven curated releases");
assert(html.includes("恢复与必填保护") && html.includes("基础评测能力"), "README timeline must cover the latest and initial capability milestones");
assert(!/\d{4}\.\d{2}\.\d{2}\s*·\s*\d{2}:\d{2}/.test(html), "README release dates must not expose time-of-day timestamps");
assert(!/GitHub Pages|公开访问|首个公开版本/.test(html), "external README timeline must omit publication-channel messaging");

console.log("External README and release timeline regression passed.");
