const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const { marked } = require("marked");

/* ---------- Site config — edit site.json, not this file ---------- */
const ROOT = __dirname;

function loadSiteConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "site.json"), "utf8"));
  } catch {
    console.error("❌ Could not read site.json — make sure it exists and is valid JSON.");
    process.exit(1);
  }
}
const SITE = loadSiteConfig();

/* ---------- Paths ---------- */
const POSTS_DIR = path.join(ROOT, "content", "blog");
const TEMPLATES_DIR = path.join(ROOT, "templates");
const STATIC_DIR = path.join(ROOT, "static");
const OUT_DIR = path.join(ROOT, "dist");

/* ---------- Utils ---------- */
const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const formatDate = (d) =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const readingTime = (md) =>
  `${Math.max(1, Math.round(md.trim().split(/\s+/).length / 200))} min read`;

/* NEW — XML escaping for sitemap URLs */
const escapeXml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

/* Tiny template engine: {{ key }} and {{#if key}} ... {{/if}} */
function render(template, data) {
  let out = template.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, key, block) => (data[key] ? block : "")
  );
  return out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
    data[key] != null ? String(data[key]) : ""
  );
}

const loadTemplate = (name) => fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf8");

/* ---------- Content ---------- */
function getPosts() {
  return fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(POSTS_DIR, file), "utf8");
      const { data: fm, content } = matter(raw);
      const slug = fm.slug || path.basename(file, path.extname(file));
      const date = fm.date ? new Date(fm.date) : fs.statSync(path.join(POSTS_DIR, file)).mtime;

      const post = {
        slug,
        url: `/blog/${slug}/`,
        title: fm.title || slug,
        description: fm.description || "",
        category: fm.category || "",
        date,
        isoDate: date.toISOString(),
        dateFormatted: formatDate(date),
        featuredImage: fm.featuredImage || "",
        featuredImageAlt: fm.featuredImageAlt || fm.title || "",
        readingTime: readingTime(content),
        html: marked.parse(content),
      };
      if (post.category) {
        post.categorySlug = slugify(post.category);
        post.categoryUrl = `/categories/${post.categorySlug}/`;
      }
      return post;
    })
    .sort((a, b) => b.date - a.date);
}

function getCategories(posts) {
  const map = {};
  for (const p of posts) {
    if (!p.category) continue;
    (map[p.categorySlug] ||= {
      name: p.category, slug: p.categorySlug, url: p.categoryUrl, posts: [],
    }).posts.push(p);
  }
  return map;
}

/* ---------- NEW: SEO — sitemap.xml + robots.txt ---------- */
function buildSitemap(posts, categories) {
  const base = SITE.url.replace(/\/+$/, "");

  if (/your-site\.netlify\.app|example\.com/.test(base)) {
    console.warn('⚠️  site.json → "url" is still a placeholder. Set your real domain for an accurate sitemap.');
  }

  const today = new Date().toISOString().split("T")[0];

  const urls = [
    // Home
    { loc: `${base}/`, lastmod: today, changefreq: "daily", priority: "1.0" },
    // Every post — lastmod uses the post's own date
    ...posts.map((p) => ({
      loc: `${base}${p.url}`,
      lastmod: p.isoDate.split("T")[0],
      changefreq: "monthly",
      priority: "0.8",
    })),
    // Every category
    ...Object.values(categories).map((c) => ({
      loc: `${base}${c.url}`,
      lastmod: today,
      changefreq: "weekly",
      priority: "0.6",
    })),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`;
}

function buildRobots() {
  const base = SITE.url.replace(/\/+$/, "");
  return `User-agent: *
Allow: /

Sitemap: ${base}/sitemap.xml
`;
}

/* ---------- Shared components ---------- */
function kicker(post) {
  return post.category
    ? `<a class="kicker" href="${post.categoryUrl}">${escapeHtml(post.category)}</a>`
    : "";
}

function meta(post) {
  return `<p class="meta"><time datetime="${post.isoDate}">${post.dateFormatted}</time><span class="meta-dot">·</span>${post.readingTime}</p>`;
}

function leadCard(post) {
  const media = post.featuredImage
    ? `<a class="lead-media" href="${post.url}">
         <img src="${escapeHtml(post.featuredImage)}" alt="${escapeHtml(post.featuredImageAlt)}">
       </a>`
    : "";
  return `
  <article class="lead">
    ${media}
    <div class="lead-body">
      ${kicker(post)}
      <h2 class="lead-title"><a href="${post.url}">${escapeHtml(post.title)}</a></h2>
      ${post.description ? `<p class="lead-excerpt">${escapeHtml(post.description)}</p>` : ""}
      ${meta(post)}
    </div>
  </article>`;
}

function rowCard(post) {
  const media = post.featuredImage
    ? `<a class="row-media" href="${post.url}">
         <img src="${escapeHtml(post.featuredImage)}" alt="${escapeHtml(post.featuredImageAlt)}" loading="lazy">
       </a>`
    : "";
  return `
  <article class="row">
    ${media}
    <div class="row-body">
      ${kicker(post)}
      <h3 class="row-title"><a href="${post.url}">${escapeHtml(post.title)}</a></h3>
      ${post.description ? `<p class="row-excerpt">${escapeHtml(post.description)}</p>` : ""}
      ${meta(post)}
    </div>
  </article>`;
}

/* ---------- Sidebar: Recent posts + Categories ---------- */
function buildSidebar(posts, categories) {
  const recentHtml = posts.slice(0, 5).map((p) => `
    <a class="widget-post" href="${p.url}">
      ${p.featuredImage
        ? `<img class="widget-post-thumb" src="${escapeHtml(p.featuredImage)}" alt="" loading="lazy">`
        : ""}
      <span class="widget-post-text">
        <span class="widget-post-title">${escapeHtml(p.title)}</span>
        <span class="widget-post-date">${p.dateFormatted}</span>
      </span>
    </a>`).join("");

  const catsHtml = Object.values(categories).map((c) => `
    <a class="widget-cat" href="${c.url}">
      <span>${escapeHtml(c.name)}</span>
      <span class="widget-cat-count">${c.posts.length}</span>
    </a>`).join("");

  return `
    ${recentHtml ? `
    <section class="widget">
      <h2 class="widget-title">Recent posts</h2>
      ${recentHtml}
    </section>` : ""}
    ${catsHtml ? `
    <section class="widget">
      <h2 class="widget-title">Categories</h2>
      ${catsHtml}
    </section>` : ""}`;
}

/* ---------- Related posts: same category first, then latest ---------- */
function getRelated(post, posts, limit = 3) {
  const others = posts.filter((p) => p.slug !== post.slug);
  const sameCat = post.category ? others.filter((p) => p.category === post.category) : [];
  const fill = others.filter((p) => !sameCat.includes(p));
  return [...sameCat, ...fill].slice(0, limit);
}

function relatedCard(post) {
  const media = post.featuredImage
    ? `<img src="${escapeHtml(post.featuredImage)}" alt="" loading="lazy">`
    : `<span class="related-media-empty" aria-hidden="true">${escapeHtml(post.title.charAt(0).toUpperCase())}</span>`;
  return `
  <a class="related-card" href="${post.url}">
    ${media}
    <span class="related-body">
      <span class="related-title">${escapeHtml(post.title)}</span>
      <span class="related-meta">${post.dateFormatted}</span>
    </span>
  </a>`;
}

/* ---------- Build ---------- */
function build() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const posts = getPosts();
  const categories = getCategories(posts);

  /* Header nav = pages only (Home + site.json links). Categories live in the sidebar. */
  const navHtml = ['<a href="/">Home</a>',
    ...(SITE.nav || []).map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`),
  ].join("\n");

  const siteData = {
    siteName: SITE.name,
    tagline: SITE.tagline || "",
    footerText: SITE.footerText || "",
    navLinks: navHtml,
    sidebar: buildSidebar(posts, categories),
    year: new Date().getFullYear(),
  };

  const inner = (name, data) => render(loadTemplate(name), { ...siteData, ...data });
  const page = (html, data) => render(loadTemplate("_layout.html"), { ...siteData, content: html, ...data });

  const writeFile = (rel, html) => {
    const full = path.join(OUT_DIR, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, html);
  };

  /* HOME */
  const [featured, ...rest] = posts;
  writeFile("index.html", page(inner("index.html", {
    featuredPost: featured ? leadCard(featured) : "",
    postList: rest.map(rowCard).join("\n"),
  }), { title: SITE.name, description: SITE.description || SITE.tagline }));

  /* POSTS (with related posts) */
  for (const post of posts) {
    const related = getRelated(post, posts).map(relatedCard).join("\n");
    writeFile(path.join("blog", post.slug, "index.html"),
      page(inner("post.html", { ...post, content: post.html, relatedPosts: related }), {
        title: `${post.title} — ${SITE.name}`,
        description: post.description,
        featuredImageAbs: post.featuredImage ? new URL(post.featuredImage, SITE.url).href : "",
      }));
  }

  /* CATEGORIES */
  for (const cat of Object.values(categories)) {
    writeFile(path.join("categories", cat.slug, "index.html"),
      page(inner("category.html", {
        categoryName: escapeHtml(cat.name),
        postCount: `${cat.posts.length} ${cat.posts.length === 1 ? "post" : "posts"}`,
        postList: cat.posts.map(rowCard).join("\n"),
      }), {
        title: `${cat.name} — ${SITE.name}`,
        description: `All posts in ${cat.name}`,
      }));
  }

  /* 404 */
  writeFile("404.html", page(
    `<div class="notfound"><h1>404 — page not found</h1><p><a class="back-link" href="/">← Back to home</a></p></div>`,
    { title: `Not found — ${SITE.name}`, description: "" }
  ));

  /* NEW — SEO files: regenerated on every build */
  writeFile("sitemap.xml", buildSitemap(posts, categories));
  writeFile("robots.txt", buildRobots());

  copyDir(STATIC_DIR, OUT_DIR);
  console.log(`✅ "${SITE.name}" — ${posts.length} post(s), ${Object.keys(categories).length} category page(s), sitemap.xml + robots.txt → dist/`);
}

build();
