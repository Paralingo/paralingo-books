import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

const publicBooksDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const archiveDate = new Date("2026-07-27T00:00:00Z");

const editions = {
  contos: {
    id: "paralingo-pt-contos-para-a-infancia",
    languageCode: "pt",
    locale: "pt-PT",
    title: "Contos para a infância",
    author: "Guerra Junqueiro",
    fullAuthor: "Abílio Manuel Guerra Junqueiro",
    firstPublicationYear: 1877,
    sourceUrl: "https://www.gutenberg.org/ebooks/16429",
    sourcePath: path.join(
      publicBooksDirectory,
      "sources",
      "contos",
      "source.html",
    ),
    coverPath: path.join(
      publicBooksDirectory,
      "assets",
      "contos-para-a-infancia-cover-v1.jpg",
    ),
    outputName: "paralingo-pt-contos-para-a-infancia-v1.epub",
    chapterLabel: "Conto",
    editionHeading: "Sobre esta edição",
    editionParagraphs: [
      "Seleção em português preparada por Guerra Junqueiro e publicada em 1877.",
      "Esta edição usa a atualização ortográfica disponibilizada no livro eletrónico 16429. Project Gutenberg declara que não reivindica direitos de autor sobre atualizações ortográficas. Foram removidos cabeçalhos, licença, marca, imagens e elementos editoriais do ficheiro de origem; o texto narrativo não foi adaptado nem simplificado pela Paralingo.",
    ],
    parse(source) {
      const modernStart = source.indexOf('<a id="contos">');
      const sourceEnd = source.indexOf(
        "*** END OF THE PROJECT GUTENBERG EBOOK",
        modernStart,
      );
      if (modernStart < 0 || sourceEnd < 0) {
        throw new Error("Could not isolate the modern-spelling Portuguese text.");
      }
      return extractSections(
        source.slice(modernStart, sourceEnd),
        /<h2[^>]*>\s*<a id="id_(\d+)"><\/a>([\s\S]*?)<\/h2>/gi,
        43,
      );
    },
  },
  pinocchio: {
    id: "paralingo-it-pinocchio",
    languageCode: "it",
    locale: "it-IT",
    title: "Le avventure di Pinocchio",
    author: "Carlo Collodi",
    fullAuthor: "Carlo Collodi",
    firstPublicationYear: 1883,
    sourceUrl: "https://www.gutenberg.org/ebooks/52484",
    sourcePath: path.join(
      publicBooksDirectory,
      "sources",
      "pinocchio",
      "source.html",
    ),
    coverPath: path.join(
      publicBooksDirectory,
      "assets",
      "pinocchio-cover-v1.jpg",
    ),
    outputName: "paralingo-it-pinocchio-v1.epub",
    chapterLabel: "Capitolo",
    editionHeading: "Informazioni su questa edizione",
    editionParagraphs: [
      "Testo originale italiano di Carlo Collodi, pubblicato in volume nel 1883.",
      "Fonte digitale: Project Gutenberg, libro elettronico 52484. Sono stati rimossi intestazioni, licenza, marchio, illustrazioni, copertina e apparati editoriali della fonte; il testo narrativo non è stato modernizzato né semplificato.",
    ],
    parse(source) {
      const storyStart = source.indexOf('<h2 id="capI">');
      const indexStart = source.indexOf('id="indice"', storyStart);
      if (storyStart < 0 || indexStart < 0) {
        throw new Error("Could not isolate the Italian story text.");
      }
      return extractSections(
        source.slice(storyStart, indexStart),
        /<h2 id="cap([IVXLCDM]+)">([\s\S]*?)<\/h2>/gi,
        36,
      );
    },
  },
};

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function stripMarkup(value) {
  return decodeEntities(
    value
      .replace(/<span\b[^>]*class="[^"]*(?:pagenum|caption)[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "")
      .replace(/<div\b[^>]*class="[^"]*(?:figcenter|sbreak)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
      .replace(/<img\b[^>]*>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|blockquote|ul|ol|li)>/gi, "\n\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function paragraphsToXhtml(value) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((paragraph) => `    <p>${escapeXml(paragraph)}</p>`)
    .join("\n");
}

function extractSections(source, headingPattern, expectedCount) {
  const matches = [...source.matchAll(headingPattern)];
  if (matches.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} sections, found ${matches.length}.`);
  }

  return matches.map((match, index) => {
    const headingMarkup = match[2];
    const title =
      stripMarkup(headingMarkup.replace(/^[IVXLCDM]+\.\s*/i, "")) ||
      String(index + 1);
    const bodyStart = match.index + match[0].length;
    const bodyEnd =
      index + 1 < matches.length ? matches[index + 1].index : source.length;
    const text = stripMarkup(source.slice(bodyStart, bodyEnd));
    if (text.length < 40) {
      throw new Error(`Section ${index + 1} has too little readable text.`);
    }
    return { title, text };
  });
}

function buildStyles() {
  return `@charset "UTF-8";
html { color: #171b24; background: #fffdf7; }
body { font-family: serif; line-height: 1.55; margin: 5%; }
h1 { color: #183346; font-size: 1.55em; font-weight: 600; margin: 2.5em 0 1.8em; text-align: center; }
.chapter-number { color: #8b5a2b; display: block; font-size: 0.58em; letter-spacing: 0.12em; margin-bottom: 0.65em; text-transform: uppercase; }
p { margin: 0 0 0.85em; orphans: 2; widows: 2; }
.title-page, .edition-page { text-align: center; }
.title-page h1 { font-size: 2.05em; margin-top: 20%; }
.author { font-size: 1.05em; letter-spacing: 0.08em; text-transform: uppercase; }
.imprint { color: #8b5a2b; margin-top: 4em; }
.edition-page { margin-top: 14%; }
.edition-page p { margin-left: auto; margin-right: auto; max-width: 32em; }
a { color: #71451f; }`;
}

function buildCoverPage(book) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${book.languageCode}" lang="${book.languageCode}">
<head><meta charset="utf-8"/><title>Cover</title><style>html,body{height:100%;margin:0;padding:0;text-align:center}img{height:100%;max-width:100%;object-fit:contain}</style></head>
<body><img src="images/cover.jpg" alt="${escapeXml(book.title)}"/></body>
</html>`;
}

function buildTitlePage(book) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${book.languageCode}" lang="${book.languageCode}">
<head><meta charset="utf-8"/><title>${escapeXml(book.title)}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>
<body class="title-page"><h1>${escapeXml(book.title)}</h1><p class="author">${escapeXml(book.author)}</p><p class="imprint">Paralingo Classics</p></body>
</html>`;
}

function buildEditionPage(book) {
  const paragraphs = book.editionParagraphs
    .map((paragraph) => `  <p>${escapeXml(paragraph)}</p>`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${book.languageCode}" lang="${book.languageCode}">
<head><meta charset="utf-8"/><title>${escapeXml(book.editionHeading)}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>
<body class="edition-page"><h1>${escapeXml(book.editionHeading)}</h1>
${paragraphs}
  <p><a href="${book.sourceUrl}">Source record</a></p>
  <p>Cover and edition design © 2026 Paralingo.</p>
</body>
</html>`;
}

function buildChapter(book, chapter, index) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${book.languageCode}" lang="${book.languageCode}">
<head><meta charset="utf-8"/><title>${escapeXml(chapter.title)}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>
<body><section epub:type="chapter"><h1><span class="chapter-number">${book.chapterLabel} ${index + 1}</span>${escapeXml(chapter.title)}</h1>
${paragraphsToXhtml(chapter.text)}
</section></body>
</html>`;
}

function buildNavigation(book, chapters) {
  const items = chapters
    .map(
      (chapter, index) =>
        `      <li><a href="chapter-${String(index + 1).padStart(2, "0")}.xhtml">${escapeXml(chapter.title)}</a></li>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${book.languageCode}" lang="${book.languageCode}">
<head><meta charset="utf-8"/><title>Contents</title></head>
<body><nav epub:type="toc" id="toc" role="doc-toc"><h1>Contents</h1><ol>
      <li><a href="title.xhtml">${escapeXml(book.title)}</a></li>
${items}
      <li><a href="edition.xhtml">${escapeXml(book.editionHeading)}</a></li>
    </ol></nav></body>
</html>`;
}

function buildPackageDocument(book, chapters) {
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
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${book.languageCode}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
    <dc:identifier id="book-id">urn:paralingo:book:${book.languageCode}:${book.id}:v1</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:creator id="creator">${escapeXml(book.fullAuthor)}</dc:creator>
    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>
    <dc:language>${book.languageCode}</dc:language>
    <dc:date>${book.firstPublicationYear}</dc:date>
    <dc:publisher>Paralingo</dc:publisher>
    <dc:source>${book.sourceUrl}</dc:source>
    <dc:rights>Original literary text: public domain where applicable. Cover art and edition design © 2026 Paralingo.</dc:rights>
    <meta property="dcterms:modified">2026-07-27T00:00:00Z</meta>
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
  <spine><itemref idref="cover"/><itemref idref="title"/>
${chapterSpine}
    <itemref idref="edition"/></spine>
</package>`;
}

async function buildEdition(book) {
  const [source, coverBytes] = await Promise.all([
    readFile(book.sourcePath, "utf8"),
    readFile(book.coverPath),
  ]);
  const chapters = book.parse(source);
  const wordCountEstimate = chapters.reduce(
    (total, chapter) =>
      total +
      (chapter.text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [])
        .length,
    0,
  );

  const zip = new JSZip();
  const add = (filePath, contents, options = {}) =>
    zip.file(filePath, contents, {
      createFolders: false,
      date: archiveDate,
      ...options,
    });
  add("mimetype", "application/epub+zip", { compression: "STORE" });
  add(
    "META-INF/container.xml",
    '<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  add("EPUB/styles.css", buildStyles());
  add("EPUB/images/cover.jpg", coverBytes, { binary: true });
  add("EPUB/cover.xhtml", buildCoverPage(book));
  add("EPUB/title.xhtml", buildTitlePage(book));
  add("EPUB/edition.xhtml", buildEditionPage(book));
  add("EPUB/nav.xhtml", buildNavigation(book, chapters));
  add("EPUB/package.opf", buildPackageDocument(book, chapters));
  chapters.forEach((chapter, index) =>
    add(
      `EPUB/chapter-${String(index + 1).padStart(2, "0")}.xhtml`,
      buildChapter(book, chapter, index),
    ),
  );

  const epubBytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    mimeType: "application/epub+zip",
  });
  const checksumSha256 = createHash("sha256").update(epubBytes).digest("hex");
  const packagesDirectory = path.join(publicBooksDirectory, "packages");
  const outputPath = path.join(packagesDirectory, book.outputName);
  await mkdir(packagesDirectory, { recursive: true });
  await writeFile(outputPath, epubBytes);
  await writeFile(
    path.join(packagesDirectory, `${book.id}-v1.package.json`),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: book.id,
        editionVersion: 1,
        fileName: book.outputName,
        languageCode: book.languageCode,
        locale: book.locale,
        title: book.title,
        author: book.fullAuthor,
        firstPublicationYear: book.firstPublicationYear,
        sourceUrl: book.sourceUrl,
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
  return {
    id: book.id,
    outputPath,
    chapterCount: chapters.length,
    wordCountEstimate,
    sizeBytes: epubBytes.length,
    checksumSha256,
  };
}

const requestedKeys = process.argv.slice(2);
const selectedKeys = requestedKeys.length ? requestedKeys : Object.keys(editions);
const results = [];
for (const key of selectedKeys) {
  const edition = editions[key];
  if (!edition) {
    throw new Error(`Unknown edition key: ${key}`);
  }
  results.push(await buildEdition(edition));
}
console.log(JSON.stringify(results, null, 2));
