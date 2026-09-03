import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import { marked } from "marked";

const ROOT = join(import.meta.dirname, "..");
const RESEARCH = join(ROOT, "research");
const OUT = join(import.meta.dirname, "dist");
const PUBLIC = join(import.meta.dirname, "public");

mkdirSync(OUT, { recursive: true });
copyFileSync(join(PUBLIC, "style.css"), join(OUT, "style.css"));

const pages = readdirSync(RESEARCH)
  .filter((f) => f.endsWith(".md"))
  .sort();

const navItems = pages.map((file) => {
  const slug = basename(file, ".md");
  const title = readFileSync(join(RESEARCH, file), "utf8").match(/^# (.+)/m)?.[1] ?? slug;
  return { slug, title, file };
});

function layout(title, body, activeSlug) {
  const nav = navItems
    .map(
      ({ slug, title: t }) =>
        `<li><a href="/${slug}.html"${slug === activeSlug ? ' aria-current="page"' : ""}>${t}</a></li>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · Crypto Accumulation Research</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header>
    <a class="brand" href="/">Crypto Accumulation Research</a>
    <p class="tagline">Long-horizon plan · verified bounties · scam avoidance</p>
  </header>
  <div class="shell">
    <nav aria-label="Research notes"><ul>${nav}</ul></nav>
    <main>${body}</main>
  </div>
  <footer>
    <p>Not financial advice. This site does not hold funds or accept deposits.</p>
  </footer>
</body>
</html>`;
}

for (const { slug, file } of navItems) {
  const md = readFileSync(join(RESEARCH, file), "utf8");
  const title = md.match(/^# (.+)/m)?.[1] ?? slug;
  const html = marked.parse(md);
  writeFileSync(join(OUT, `${slug}.html`), layout(title, html, slug));
}

const homeBody = `
<h1>Crypto accumulation research</h1>
<p>Evidence-backed notes for accumulating crypto without speed trading, custody hand-offs, or guaranteed-return scams.</p>
<ul class="home-list">
${navItems.map(({ slug, title }) => `<li><a href="/${slug}.html"><strong>${title}</strong></a></li>`).join("\n")}
</ul>
<p class="warn">Do not send crypto, seed phrases, or exchange keys to any agent or address posted in chat.</p>`;

writeFileSync(join(OUT, "index.html"), layout("Home", homeBody, ""));

console.log(`Built ${navItems.length + 1} pages → ${OUT}`);
