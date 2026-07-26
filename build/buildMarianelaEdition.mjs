import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const sourcePath = path.join(
  projectDirectory,
  "sources",
  "marianela.gutenberg.epub",
);
const coverPath = path.join(
  projectDirectory,
  "assets",
  "marianela-cover-v1.jpg",
);
const packagesDirectory = path.join(projectDirectory, "packages");
const outputPath = path.join(
  packagesDirectory,
  "paralingo-es-marianela-v1.epub",
);
const packageRecordPath = path.join(
  packagesDirectory,
  "paralingo-es-marianela-v1.package.json",
);
const archiveDate = new Date("2026-07-26T00:00:00Z");

const sourceChapterFiles = [
  "OEBPS/3246497543003005156_17340-h-0.htm.xhtml",
  "OEBPS/3246497543003005156_17340-h-1.htm.xhtml",
];

const chapterHeadingPattern =
  /<h2\b[^>]*>\s*<a id="([IVXLCDM]+)"\/>\s*-\1-\s*<br\/>\s*<span\b[^>]*>([\s\S]*?)<\/span>\s*<\/h2>/i;

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function extractBody(xhtml) {
  const match = xhtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) {
    throw new Error("Source chapter file has no XHTML body.");
  }
  return match[1];
}

function cleanChapterMarkup(rawChapter, index) {
  const heading = rawChapter.match(chapterHeadingPattern);
  if (!heading) {
    throw new Error(`Could not parse heading for chapter ${index + 1}.`);
  }

  const romanNumber = heading[1];
  const chapterTitle = heading[2]
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  let content = rawChapter.slice(heading[0].length);
  content = content
    .replace(
      /<span\b[^>]*class="[^"]*x-ebookmaker-pageno[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
      "",
    )
    .replace(/<a\b[^>]*id="[^"]+"[^>]*\/>/gi, "")
    .replace(/<div\b[^>]*\/>/gi, "")
    .replace(/\s+(?:class|id|style)="[^"]*"/gi, "")
    .replace(/<span\b[^>]*>/gi, "")
    .replace(/<\/span>/gi, "")
    .replace(/<br\s*\/?>\s*<\/p>/gi, "</p>")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (/gutenberg|pginternal|x-ebookmaker|<img\b|<a\b[^>]*href=/i.test(content)) {
    throw new Error(`Chapter ${index + 1} still contains excluded source markup.`);
  }

  return {
    romanNumber,
    title: chapterTitle,
    xhtml: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="es" lang="es">
<head>
  <meta charset="utf-8"/>
  <title>Capítulo ${escapeXml(romanNumber)} — ${escapeXml(chapterTitle)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section epub:type="chapter" xmlns:epub="http://www.idpf.org/2007/ops">
    <h1><span class="chapter-number">Capítulo ${escapeXml(romanNumber)}</span>${escapeXml(chapterTitle)}</h1>
    ${content}
  </section>
</body>
</html>
`,
  };
}

function extractChapters(sourceDocuments) {
  const bodies = sourceDocuments.map(extractBody);
  const firstChapterStart = bodies[0].search(
    /<h2\b[^>]*>\s*<a id="I"\/>\s*-I-/i,
  );
  if (firstChapterStart < 0) {
    throw new Error("Could not find the first Marianela chapter.");
  }

  const storyMarkup = `${bodies[0].slice(firstChapterStart)}\n${bodies[1]}`;
  const chapterStarts = [
    ...storyMarkup.matchAll(
      /<h2\b[^>]*>\s*<a id="([IVXLCDM]+)"\/>\s*-\1-/gi,
    ),
  ];

  const chapters = chapterStarts.map((match, index) => {
    const start = match.index;
    const end =
      index + 1 < chapterStarts.length
        ? chapterStarts[index + 1].index
        : storyMarkup.length;
    return cleanChapterMarkup(storyMarkup.slice(start, end), index);
  });

  if (chapters.length !== 22) {
    throw new Error(`Expected 22 Marianela chapters, found ${chapters.length}.`);
  }
  return chapters;
}

function buildContainerXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function buildStyles() {
  return `@charset "UTF-8";
html {
  color: #171b24;
  background: #fffdf7;
}
body {
  font-family: serif;
  line-height: 1.55;
  margin: 5%;
}
h1 {
  color: #132c43;
  font-size: 1.55em;
  font-weight: 600;
  margin: 2.5em 0 1.8em;
  text-align: center;
}
.chapter-number {
  color: #8b5a2b;
  display: block;
  font-size: 0.58em;
  letter-spacing: 0.12em;
  margin-bottom: 0.65em;
  text-transform: uppercase;
}
p {
  margin: 0 0 0.85em;
  orphans: 2;
  widows: 2;
}
.title-page, .edition-page {
  text-align: center;
}
.title-page h1 {
  font-size: 2.1em;
  margin-top: 20%;
}
.author {
  font-size: 1.1em;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.imprint {
  color: #8b5a2b;
  margin-top: 4em;
}
.edition-page {
  margin-top: 18%;
}
.edition-page p {
  margin-left: auto;
  margin-right: auto;
  max-width: 30em;
}
a {
  color: #71451f;
}
`;
}

function buildCoverPage() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="es" lang="es">
<head>
  <meta charset="utf-8"/>
  <title>Cubierta</title>
  <style>html,body{height:100%;margin:0;padding:0;text-align:center}img{height:100%;max-width:100%;object-fit:contain}</style>
</head>
<body>
  <img src="images/cover.jpg" alt="Cubierta de Marianela"/>
</body>
</html>
`;
}

function buildTitlePage() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="es" lang="es">
<head>
  <meta charset="utf-8"/>
  <title>Marianela</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body class="title-page">
  <h1>Marianela</h1>
  <p class="author">Benito Pérez Galdós</p>
  <p class="imprint">Paralingo Classics</p>
</body>
</html>
`;
}

function buildEditionPage() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="es" lang="es">
<head>
  <meta charset="utf-8"/>
  <title>Sobre esta edición</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body class="edition-page">
  <h1>Sobre esta edición</h1>
  <p>Texto original en español de Benito Pérez Galdós, publicado en 1878.</p>
  <p>Fuente digital: Project Gutenberg, libro electrónico 17340. Se eliminaron la cabecera, la licencia, la marca y la cubierta de Project Gutenberg; no se añadieron comentarios ni se modernizó el texto.</p>
  <p><a href="https://www.gutenberg.org/ebooks/17340">Consultar la fuente</a></p>
  <p>Diseño y cubierta de esta edición © 2026 Paralingo.</p>
</body>
</html>
`;
}

function buildNavigation(chapters) {
  const chapterItems = chapters
    .map(
      (chapter, index) =>
        `      <li><a href="chapter-${String(index + 1).padStart(2, "0")}.xhtml">Capítulo ${escapeXml(chapter.romanNumber)} — ${escapeXml(chapter.title)}</a></li>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="es" lang="es">
<head>
  <meta charset="utf-8"/>
  <title>Índice</title>
</head>
<body>
  <nav epub:type="toc" id="toc" role="doc-toc">
    <h1>Índice</h1>
    <ol>
      <li><a href="title.xhtml">Marianela</a></li>
${chapterItems}
      <li><a href="edition.xhtml">Sobre esta edición</a></li>
    </ol>
  </nav>
</body>
</html>
`;
}

function buildPackageDocument(chapters) {
  const modified = "2026-07-26T00:00:00Z";
  const chapterManifest = chapters
    .map(
      (_, index) =>
        `    <item id="chapter-${index + 1}" href="chapter-${String(index + 1).padStart(2, "0")}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join("\n");
  const chapterSpine = chapters
    .map((_, index) => `    <itemref idref="chapter-${index + 1}"/>`)
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="es">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
    <dc:identifier id="book-id">urn:paralingo:book:es:marianela:v1</dc:identifier>
    <dc:title>Marianela</dc:title>
    <dc:creator id="creator">Benito Pérez Galdós</dc:creator>
    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>
    <dc:language>es</dc:language>
    <dc:date>1878</dc:date>
    <dc:publisher>Paralingo</dc:publisher>
    <dc:source>https://www.gutenberg.org/ebooks/17340</dc:source>
    <dc:rights>Original text: public domain where applicable. Cover art and edition design © 2026 Paralingo.</dc:rights>
    <meta property="dcterms:modified">${modified}</meta>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
    <item id="edition" href="edition.xhtml" media-type="application/xhtml+xml"/>
    <item id="styles" href="styles.css" media-type="text/css"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${chapterManifest}
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="title"/>
${chapterSpine}
    <itemref idref="edition"/>
  </spine>
</package>
`;
}

async function main() {
  const [sourceBytes, coverBytes] = await Promise.all([
    readFile(sourcePath),
    readFile(coverPath),
  ]);
  const sourceZip = await JSZip.loadAsync(sourceBytes);
  const sourceDocuments = await Promise.all(
    sourceChapterFiles.map(async (filePath) => {
      const entry = sourceZip.file(filePath);
      if (!entry) {
        throw new Error(`Source EPUB is missing ${filePath}.`);
      }
      return entry.async("string");
    }),
  );
  const chapters = extractChapters(sourceDocuments);
  const wordCountEstimate = chapters.reduce((total, chapter) => {
    const plainText = chapter.xhtml
      .replace(/<[^>]+>/g, " ")
      .replace(/&(?:[a-z]+|#\d+);/gi, " ");
    return total + (plainText.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9]+/g) ?? []).length;
  }, 0);

  const outputZip = new JSZip();
  const addTextFile = (filePath, contents, options = {}) => {
    outputZip.file(filePath, contents, {
      createFolders: false,
      date: archiveDate,
      ...options,
    });
  };
  addTextFile("mimetype", "application/epub+zip", {
    compression: "STORE",
  });
  addTextFile("META-INF/container.xml", buildContainerXml());
  addTextFile("EPUB/styles.css", buildStyles());
  addTextFile("EPUB/images/cover.jpg", coverBytes, {
    binary: true,
  });
  addTextFile("EPUB/cover.xhtml", buildCoverPage());
  addTextFile("EPUB/title.xhtml", buildTitlePage());
  addTextFile("EPUB/edition.xhtml", buildEditionPage());
  addTextFile("EPUB/nav.xhtml", buildNavigation(chapters));
  addTextFile("EPUB/package.opf", buildPackageDocument(chapters));
  chapters.forEach((chapter, index) => {
    addTextFile(
      `EPUB/chapter-${String(index + 1).padStart(2, "0")}.xhtml`,
      chapter.xhtml,
    );
  });

  const epubBytes = await outputZip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    mimeType: "application/epub+zip",
  });
  const checksumSha256 = createHash("sha256").update(epubBytes).digest("hex");

  await mkdir(packagesDirectory, { recursive: true });
  await writeFile(outputPath, epubBytes);
  await writeFile(
    packageRecordPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: "paralingo-es-marianela",
        editionVersion: 1,
        fileName: path.basename(outputPath),
        languageCode: "es",
        locale: "es-ES",
        title: "Marianela",
        author: "Benito Pérez Galdós",
        firstPublicationYear: 1878,
        sourceUrl: "https://www.gutenberg.org/ebooks/17340",
        chapterCount: chapters.length,
        wordCountEstimate,
        sizeBytes: epubBytes.length,
        checksumSha256,
        publicationStatus: "awaiting-final-review",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        outputPath,
        chapterCount: chapters.length,
        wordCountEstimate,
        sizeBytes: epubBytes.length,
        checksumSha256,
      },
      null,
      2,
    ),
  );
}

await main();
