const express = require("express");
const router = express.Router();

const db = require("../db");
const auth = require("../middleware/auth");
const axios = require("axios");




/* ==========================================
   CLASSICS IMPORTER — UNIVERSAL SOURCE ENGINE
   Supported source families:
   - Project Gutenberg
   - Any Wikimedia Wikisource language subdomain
   - Generic public-domain HTML/text as fallback
========================================== */

const WIKISOURCE_LANGUAGE_NAMES = {
    te: "Telugu",
    hi: "Hindi",
    ta: "Tamil",
    kn: "Kannada",
    ml: "Malayalam",
    bn: "Bengali",
    mr: "Marathi",
    gu: "Gujarati",
    pa: "Punjabi",
    or: "Odia",
    sa: "Sanskrit",
    ur: "Urdu",
    ne: "Nepali",
    as: "Assamese",
    en: "English",
    fr: "French",
    de: "German",
    es: "Spanish",
    it: "Italian",
    pt: "Portuguese",
    ru: "Russian",
    ar: "Arabic",
    he: "Hebrew",
    pl: "Polish",
    cs: "Czech",
    hu: "Hungarian",
    ro: "Romanian",
    uk: "Ukrainian",
    vi: "Vietnamese",
    th: "Thai",
    id: "Indonesian"
};

function cleanImportedText(value) {
    let text = String(value || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

    const lines = text.split("\n");
    const cleanedLines = [];
    let insideIllustration = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!insideIllustration && /^\[(?:illustration|image):/i.test(line)) {
            if (/\]\s*$/.test(line)) continue;
            insideIllustration = true;
            continue;
        }

        if (insideIllustration) {
            if (/^chapter\s+[ivxlcdm]+\s*\.?\]?$/i.test(line)) {
                insideIllustration = false;
                cleanedLines.push(rawLine);
                continue;
            }

            if (/^chapter\s+[a-z]+\s*\.?\]?$/i.test(line)) {
                insideIllustration = false;
                cleanedLines.push(rawLine);
                continue;
            }

            if (/\]\s*$/.test(line)) {
                insideIllustration = false;
            }

            continue;
        }

        if (/^\[(?:illustration|image)\]$/i.test(line) || line === "]") {
            continue;
        }

        const withoutInlineImage = rawLine
            .replace(/\[Image:\s*[^\]]*\]/gi, "")
            .replace(/\[Illustration:\s*[^\]]*\]/gi, "");

        cleanedLines.push(withoutInlineImage);
    }

    return cleanedLines.join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function normalizeImportedChapterTitle(value) {
    let title = String(value || "")
        .replace(/\s+/g, " ")
        .trim();

    const chapterMatch = title.match(/^chapter\s*(?:[-.:]\s*)?([ivxlcdm]+)\s*\.?\s*\]?$/i);

    if (chapterMatch) {
        return `Chapter ${chapterMatch[1].toUpperCase()}.`;
    }

    return title
        .replace(/\]\s*$/, "")
        .trim();
}

function htmlToText(html) {
    return cleanImportedText(
        String(html || "")
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
            .replace(/<br\s*\/?\s*>/gi, "\n")
            .replace(/<\/p>/gi, "\n\n")
            .replace(/<\/li>/gi, "\n")
            .replace(/<\/div>/gi, "\n")
            .replace(/<\/h[1-6]>/gi, "\n\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'")
    );
}

function extractMetaFromHtml(html) {
    const titleMatch = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descriptionMatch = String(html || "").match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i
    );
    const ogImageMatch = String(html || "").match(
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i
    );

    return {
        title: titleMatch
            ? htmlToText(titleMatch[1]).replace(/\s+/g, " ").trim()
            : "",
        description: descriptionMatch
            ? htmlToText(descriptionMatch[1]).replace(/\s+/g, " ").trim()
            : "",
        coverImage: ogImageMatch?.[1] || null
    };
}

function detectGutenbergId(url) {
    const match = String(url || "").match(/(?:epub|files|ebooks)\/(\d+)/i);
    if (match) return match[1];

    const match2 = String(url || "").match(/gutenberg\.org\/ebooks\/(\d+)/i);
    return match2 ? match2[1] : null;
}

function getGutenbergCoverUrl(id) {
    if (!id) return null;
    return `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;
}

function extractGutenbergMetadata(html, text, fallbackLanguage = "") {
    const pageText = htmlToText(html);
    const combined = `${pageText}\n${String(text || "")}`;

    const languageMatch = combined.match(/(?:^|\n)Language\s*\|?\s*([^\n]+)/i);
    const language = (languageMatch?.[1] || fallbackLanguage || "English")
        .replace(/\s+/g, " ")
        .trim();

    let publicationYear = null;

    const publicationPatterns = [
        /(?:published|publication date|publication year)[^\d]{0,60}(17\d{2}|18\d{2}|19\d{2}|20\d{2})/i,
        /(?:first published|originally published|published in)[^\d]{0,60}(17\d{2}|18\d{2}|19\d{2}|20\d{2})/i
    ];

    for (const pattern of publicationPatterns) {
        const match = combined.match(pattern);
        if (match) {
            publicationYear = Number(match[1]);
            break;
        }
    }

    if (!publicationYear) {
        const generatedDescriptionMatch = pageText.match(
            /published in\s+(17\d{2}|18\d{2}|19\d{2}|20\d{2})/i
        );

        if (generatedDescriptionMatch) {
            publicationYear = Number(generatedDescriptionMatch[1]);
        }
    }

    const subjectStart = pageText.search(/(?:^|\n)Subject\s*\|?/i);
    const categoryStart = pageText.search(/(?:^|\n)Category\s*\|?/i);

    const subjectText = subjectStart >= 0
        ? pageText.slice(
            subjectStart,
            categoryStart > subjectStart
                ? categoryStart
                : subjectStart + 1800
        )
        : "";

    const categoryParts = [];

    if (/fiction/i.test(subjectText)) categoryParts.push("Novel");
    if (/love stories|romance|courtship/i.test(subjectText)) categoryParts.push("Romance");
    if (/poetry|poems/i.test(subjectText)) categoryParts.push("Poetry");
    if (/drama|plays|theatre|theater/i.test(subjectText)) categoryParts.push("Drama");
    if (/short stor/i.test(subjectText)) categoryParts.push("Short Stories");
    if (/children|juvenile/i.test(subjectText)) categoryParts.push("Children");

    if (!categoryParts.length) categoryParts.push("Classic");
    if (!categoryParts.includes("Classic")) categoryParts.push("Classic");

    const ogDescription = String(html || "").match(
        /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i
    );

    const metaDescription = String(html || "").match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i
    );

    const description = (ogDescription?.[1] || metaDescription?.[1] || "")
        .replace(/\s+/g, " ")
        .trim();

    return {
        language,
        originalLanguage: language,
        publicationYear,
        category: categoryParts.join(", "),
        description
    };
}

function parseGutenbergText(text) {
    let content = cleanImportedText(text);

    const startMarkers = [
        /\*\*\* START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK [^\n]*\*\*\*/i,
        /START OF THE PROJECT GUTENBERG EBOOK[^\n]*/i
    ];

    for (const marker of startMarkers) {
        const match = content.match(marker);

        if (match) {
            content = content.slice(
                match.index + match[0].length
            ).trim();
            break;
        }
    }

    const endMatch = content.match(
        /\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i
    );

    if (endMatch) {
        content = content.slice(0, endMatch.index).trim();
    }

    const lines = content.split("\n");
    const chapters = [];
    let currentTitle = "Introduction";
    let current = [];

    const isChapterHeading = line => {
        const value = line.trim();

        if (!value || value.length > 100) return false;

        return /^(chapter|book|part|volume|section)\s+[0-9ivxlcdm]+\b/i.test(value)
            || /^chapter\s+[a-z]+\b/i.test(value)
            || /^chapter\s*[-.:]/i.test(value)
            || /^\bCHAPTER\b/i.test(value);
    };

    for (const line of lines) {
        if (isChapterHeading(line)) {
            const textBlock = cleanImportedText(current.join("\n"));

            if (textBlock) {
                chapters.push({
                    title: currentTitle,
                    content: textBlock
                });
            }

            currentTitle = normalizeImportedChapterTitle(line);
            current = [];
        } else {
            current.push(line);
        }
    }

    const finalBlock = cleanImportedText(current.join("\n"));

    if (finalBlock) {
        chapters.push({
            title: currentTitle,
            content: finalBlock
        });
    }

    if (!chapters.length) {
        return [{ title: "Chapter 1", content }];
    }

    return chapters.map((chapter, index) => ({
        title: normalizeImportedChapterTitle(
            chapter.title || `Chapter ${index + 1}`
        ),
        content: cleanImportedText(chapter.content)
    }));
}

function parseGenericText(text) {
    const content = cleanImportedText(text);
    const lines = content.split("\n");
    const chapters = [];

    let currentTitle = "Chapter 1";
    let current = [];

    const headingRegex =
        /^(chapter|part|book|section|అధ్యాయం|భాగం|కాండం)\s*[\dIVXivxఅ-హA-Za-z0-9.:\-]*/i;

    for (const line of lines) {
        const trimmed = line.trim();

        if (
            trimmed &&
            trimmed.length <= 120 &&
            headingRegex.test(trimmed)
        ) {
            const block = cleanImportedText(current.join("\n"));

            if (block) {
                chapters.push({
                    title: currentTitle,
                    content: block
                });
            }

            currentTitle = trimmed;
            current = [];
        } else {
            current.push(line);
        }
    }

    const finalBlock = cleanImportedText(current.join("\n"));

    if (finalBlock) {
        chapters.push({
            title: currentTitle,
            content: finalBlock
        });
    }

    return chapters.length
        ? chapters
        : [{ title: "Chapter 1", content }];
}

function detectWikisourceInfo(url) {
    const hostname = String(url.hostname || "").toLowerCase();

    const match = hostname.match(
        /^([a-z0-9-]+)\.wikisource\.org$/i
    );

    if (!match) return null;

    const code = match[1];

    return {
        languageCode: code,
        language: WIKISOURCE_LANGUAGE_NAMES[code] || code,
        apiUrl: `${url.protocol}//${url.hostname}/w/api.php`
    };
}

function getWikisourcePageTitle(url) {
    const marker = "/wiki/";

    if (!url.pathname.includes(marker)) {
        return "";
    }

    return decodeURIComponent(
        url.pathname.slice(
            url.pathname.indexOf(marker) + marker.length
        )
    ).replace(/_/g, " ").trim();
}

function decodeHtmlEntities(value) {
    return String(value || "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">");
}

function extractWikisourceAuthor(wikitext, pageText) {
    const source = `${String(wikitext || "")}\n${String(pageText || "")}`;

    const templatePatterns = [
        /\|\s*(?:author|author_name|writer|creator|రచయిత|రచయిత పేరు)\s*=\s*([^\n|}]+)/i,
        /\|\s*(?:लेखक|लेखक नाम)\s*=\s*([^\n|}]+)/i,
        /\|\s*(?:ஆசிரியர்|எழுத்தாளர்)\s*=\s*([^\n|}]+)/i,
        /\|\s*(?:ಲೇಖಕ|ರಚಯಿತೃ)\s*=\s*([^\n|}]+)/i,
        /\|\s*(?:लेखक|लेखक का नाम)\s*=\s*([^\n|}]+)/i
    ];

    for (const pattern of templatePatterns) {
        const match = source.match(pattern);

        if (match?.[1]) {
            return cleanImportedText(
                match[1]
                    .replace(/\[\[|\]\]/g, "")
                    .replace(/<[^>]+>/g, " ")
            );
        }
    }

    // Common prose form used on Wikisource landing pages:
    // "ఇది పింగళి సూరన ... రచించిన రచన"
    const teluguMatch = pageText.match(
        /ఇది\s+(.{1,120}?)\s+(?:\d+వ\s+శతాబ్దంలో\s+)?రచించిన/i
    );

    if (teluguMatch?.[1]) {
        return cleanImportedText(teluguMatch[1])
            .replace(/[.,،;:]+$/, "")
            .trim();
    }

    const englishMatch = pageText.match(
        /(?:written|created|composed)\s+by\s+([A-Z][^.\n]{1,100})/i
    );

    if (englishMatch?.[1]) {
        return cleanImportedText(englishMatch[1])
            .replace(/[.,;:]+$/, "")
            .trim();
    }

    return "";
}

function extractWikisourceYear(pageTitle, wikitext, pageText) {
    const combined = `${pageTitle}\n${wikitext}\n${pageText}`;

    const patterns = [
        /(?:published|publication|edition|year)[^\d]{0,40}(1[5-9]\d{2}|20\d{2})/i,
        /\((1[5-9]\d{2}|20\d{2})\)/,
        /(?:క్రీ\.?\s*శ\.?|సంవత్సరం)[^\d]{0,30}(1[5-9]\d{2}|20\d{2})/i
    ];

    for (const pattern of patterns) {
        const match = combined.match(pattern);

        if (match) {
            return Number(match[1]);
        }
    }

    return null;
}

function inferWikisourceCategory(pageText) {
    const value = String(pageText || "").toLowerCase();

    if (/poem|poetry|కావ్యం|పద్య|కవిత/.test(value)) {
        return "Poetry, Classic";
    }

    if (/novel|నవల/.test(value)) {
        return "Novel, Classic";
    }

    if (/drama|play|నాటకం/.test(value)) {
        return "Drama, Classic";
    }

    return "Classic";
}

function extractWikisourceSubpages(wikitext, mainTitle) {
    const results = [];
    const seen = new Set();

    const normalizedMain = mainTitle.replace(/_/g, " ").trim();
    const regex = /\[\[\s*([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

    let match;

    while ((match = regex.exec(String(wikitext || "")))) {
        const target = decodeHtmlEntities(match[1])
            .replace(/_/g, " ")
            .trim();

        if (!target) continue;

        if (!target.startsWith(`${normalizedMain}/`)) continue;

        if (target.includes(":")) continue;

        if (!seen.has(target)) {
            seen.add(target);
            results.push(target);
        }
    }

    return results;
}

async function fetchWikisourceApi(apiUrl, params) {
    const response = await axios.get(apiUrl, {
        timeout: 20000,
        responseType: "json",
        maxContentLength: 12 * 1024 * 1024,
        params: {
            ...params,
            format: "json",
            formatversion: 2
        },
        headers: {
            "User-Agent": "MyLikith-Classics-Importer/1.0"
        }
    });

    if (!response.data || response.data.error) {
        throw new Error(
            response.data?.error?.info ||
            "Wikisource API returned an error."
        );
    }

    return response.data;
}

async function getWikisourceImageUrl(apiUrl, filename) {
    if (!filename) return null;

    try {
        const data = await fetchWikisourceApi(apiUrl, {
            action: "query",
            prop: "imageinfo",
            titles: `File:${filename}`,
            iiprop: "url",
            iiurlwidth: 600
        });

        const pages = data.query?.pages || [];

        for (const page of pages) {
            const info = page.imageinfo?.[0];

            if (info?.thumburl || info?.url) {
                return info.thumburl || info.url;
            }
        }
    } catch (error) {
        console.warn(
            "Wikisource image lookup failed:",
            error.message
        );
    }

    return null;
}

function chooseWikisourceImage(images) {
    const usable = (images || [])
        .map(value => String(value || "").trim())
        .filter(Boolean)
        .filter(value => !/logo|icon|button|wikimedia|commons/i.test(value));

    if (!usable.length) return null;

    const preferred = usable.find(value =>
        /cover|front|title|book/i.test(value)
    );

    return preferred || usable[0];
}

function cleanWikisourceChapterText(text, mainTitle) {
    let cleaned = cleanImportedText(text);

    const parentLine = new RegExp(
        `^\\s*<\\s*${String(mainTitle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
        "iu"
    );

    cleaned = cleaned
        .split("\n")
        .filter(line => {
            const trimmed = line.trim();

            if (!trimmed) return true;
            if (parentLine.test(trimmed)) return false;

            // Common Wikisource navigation/redirect lines.
            if (/^\(\s*.+?\s+నుండి\s+మళ్ళించబడింది\s*\)$/i.test(trimmed)) {
                return false;
            }

            if (/^<\s*.+>\s*$/.test(trimmed)) {
                return false;
            }

            return true;
        })
        .join("\n");

    return cleanImportedText(cleaned);
}

async function fetchWikisourceSource(sourceUrl, url, info) {
    const pageTitle = getWikisourcePageTitle(url);

    if (!pageTitle) {
        throw new Error(
            "For Wikisource, use a page URL such as https://te.wikisource.org/wiki/Book_Title."
        );
    }

    const mainData = await fetchWikisourceApi(info.apiUrl, {
        action: "parse",
        page: pageTitle,
        prop: "wikitext|text|images"
    });

    const parse = mainData.parse;

    if (!parse) {
        throw new Error("Unable to read the Wikisource page.");
    }

    const wikitext = parse.wikitext || "";
    const mainHtml = parse.text || "";
    const mainText = htmlToText(mainHtml);

    const pageMeta = await axios.get(sourceUrl, {
        timeout: 20000,
        responseType: "text",
        maxContentLength: 10 * 1024 * 1024,
        headers: {
            "User-Agent": "MyLikith-Classics-Importer/1.0"
        }
    }).then(response => extractMetaFromHtml(String(response.data || "")))
      .catch(() => ({}));

    const subpages = extractWikisourceSubpages(
        wikitext,
        pageTitle
    );

    // Wikisource has two common structures:
    // 1. A work landing page with chapter/subpage links.
    // 2. A single page containing the actual text.
    // Page: scan sources are intentionally not treated as chapters because
    // importing hundreds of OCR pages as individual reader chapters would
    // produce a poor MyLikith experience.
    const pageLinks = (wikitext.match(/\[\[\s*Page:/gi) || []).length;

    if (!subpages.length && pageLinks > 0) {
        throw new Error(
            "This Wikisource source is a scanned Page: edition. Please use a Wikisource work page with readable subpages rather than a Page: scan URL."
        );
    }

    const chapters = [];

    if (subpages.length) {
        const batchSize = 6;

        for (let i = 0; i < subpages.length; i += batchSize) {
            const batch = subpages.slice(i, i + batchSize);

            const results = await Promise.all(
                batch.map(async subpageTitle => {
                    const data = await fetchWikisourceApi(
                        info.apiUrl,
                        {
                            action: "parse",
                            page: subpageTitle,
                            prop: "text"
                        }
                    );

                    const html = data.parse?.text || "";
                    const content = cleanWikisourceChapterText(
                        htmlToText(html),
                        pageTitle
                    );

                    return {
                        title: subpageTitle.slice(
                            pageTitle.length + 1
                        ).trim(),
                        content
                    };
                })
            );

            chapters.push(...results);
        }
    } else {
        const content = cleanWikisourceChapterText(
            mainText,
            pageTitle
        );

        const parsed = parseGenericText(content);

        chapters.push(...parsed);
    }

    const firstDescription = pageMeta.description ||
        cleanImportedText(mainText).split("\n").find(line => line.length > 30) ||
        `Imported from ${new URL(sourceUrl).hostname}.`;

    const author = extractWikisourceAuthor(
        wikitext,
        mainText
    );

    const publicationYear = extractWikisourceYear(
        pageTitle,
        wikitext,
        mainText
    );

    let coverImage = pageMeta.coverImage || null;

    if (!coverImage) {
        const filename = chooseWikisourceImage(
            parse.images || []
        );

        if (filename) {
            coverImage = await getWikisourceImageUrl(
                info.apiUrl,
                filename
            );
        }
    }

    const title = pageTitle
        .replace(/\s*\(\d{4}\)\s*$/, "")
        .trim();

    return {
        sourceName: `Wikisource — ${info.language}`,
        sourceUrl,
        detectedFormat: subpages.length
            ? `Wikisource work with ${subpages.length} subpages`
            : "Wikisource page",
        title,
        author,
        description: firstDescription,
        coverImage,
        language: info.language,
        originalLanguage: info.language,
        publicationYear,
        category: inferWikisourceCategory(mainText),
        chapters
    };
}

async function fetchImportSource(sourceUrl) {
    let url;

    try {
        url = new URL(sourceUrl);
    } catch {
        throw new Error("Please enter a valid source URL.");
    }

    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error(
            "Only HTTP and HTTPS source URLs are supported."
        );
    }

    const isGutenberg =
        /(?:^|\.)gutenberg\.org$/i.test(url.hostname) ||
        /\.gutenberg\.org$/i.test(url.hostname);

    if (isGutenberg) {
        const id = detectGutenbergId(url.toString());

        if (id) {
            const textUrl =
                `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`;

            try {
                const response = await axios.get(textUrl, {
                    timeout: 20000,
                    responseType: "text",
                    maxContentLength: 15 * 1024 * 1024
                });

                const gutenbergText = String(response.data || "");

                const titleMatch =
                    gutenbergText.match(/^Title:\s*(.+)$/mi);

                const authorMatch =
                    gutenbergText.match(/^Author:\s*(.+)$/mi);

                let metadata = {
                    language: "English",
                    originalLanguage: "English",
                    publicationYear: null,
                    category: "Classic",
                    description: ""
                };

                try {
                    const pageResponse = await axios.get(
                        `https://www.gutenberg.org/ebooks/${id}`,
                        {
                            timeout: 20000,
                            responseType: "text",
                            maxContentLength: 8 * 1024 * 1024,
                            headers: {
                                "User-Agent":
                                    "MyLikith-Classics-Importer/1.0"
                            }
                        }
                    );

                    metadata = extractGutenbergMetadata(
                        String(pageResponse.data || ""),
                        gutenbergText
                    );
                } catch (metadataError) {
                    console.warn(
                        "Gutenberg metadata fetch failed:",
                        metadataError.message
                    );
                }

                const chapters =
                    parseGutenbergText(gutenbergText);

                return {
                    sourceName: "Project Gutenberg",
                    sourceUrl,
                    detectedFormat: "Project Gutenberg text",
                    title: titleMatch
                        ? titleMatch[1].trim()
                        : "",
                    author: authorMatch
                        ? authorMatch[1].trim()
                        : "",
                    description:
                        metadata.description ||
                        "Imported from Project Gutenberg.",
                    coverImage:
                        getGutenbergCoverUrl(id),
                    language: metadata.language,
                    originalLanguage:
                        metadata.originalLanguage,
                    publicationYear:
                        metadata.publicationYear,
                    category:
                        metadata.category,
                    chapters
                };
            } catch (error) {
                console.error(
                    "Gutenberg text fetch error:",
                    error.message
                );
            }
        }
    }

    const wikisourceInfo =
        detectWikisourceInfo(url);

    if (wikisourceInfo) {
        return fetchWikisourceSource(
            sourceUrl,
            url,
            wikisourceInfo
        );
    }

    const response = await axios.get(
        url.toString(),
        {
            timeout: 20000,
            responseType: "text",
            maxContentLength: 15 * 1024 * 1024,
            headers: {
                "User-Agent":
                    "MyLikith-Classics-Importer/1.0"
            }
        }
    );

    const contentType =
        String(response.headers["content-type"] || "")
            .toLowerCase();

    const raw = String(response.data || "");

    const isHtml =
        contentType.includes("text/html") ||
        /<html[\s>]/i.test(raw);

    const meta =
        isHtml
            ? extractMetaFromHtml(raw)
            : {};

    const text =
        isHtml
            ? htmlToText(raw)
            : raw;

    return {
        sourceName:
            url.hostname.replace(/^www\./i, ""),
        sourceUrl,
        detectedFormat:
            isHtml ? "HTML" : "Plain text",
        title:
            meta.title || "",
        description:
            meta.description ||
            `Imported from ${url.hostname}.`,
        coverImage:
            meta.coverImage || null,
        chapters:
            isHtml
                ? parseGenericText(text)
                : parseGenericText(raw)
    };
}


/* ==========================================
   ADMIN AUTHENTICATION
========================================== */

router.use(auth);

router.use((req, res, next) => {

    if (req.user.role !== "admin") {

        return res.status(403).json({
            success: false,
            message: "Admin access required."
        });

    }

    next();

});



/* ==========================================
   CLASSICS IMPORTER - FETCH SOURCE
   POST /api/admin/classics/import/preview
========================================== */

router.post("/import/preview", async (req, res) => {

    try {
        const { source_url } = req.body;

        if (!source_url || !String(source_url).trim()) {
            return res.status(400).json({
                success: false,
                message: "Source URL is required."
            });
        }

        const imported = await fetchImportSource(String(source_url).trim());

        if (!imported.chapters.length) {
            return res.status(422).json({
                success: false,
                message: "No readable chapters were found at this source."
            });
        }

        res.json({
            success: true,
            source: {
                name: imported.sourceName,
                url: imported.sourceUrl,
                format: imported.detectedFormat
            },
            suggested: {
                title: imported.title || "",
                author: imported.author || "",
                description: imported.description || "",
                cover_image: imported.coverImage || null,
                language: imported.language || "",
                original_language: imported.originalLanguage || imported.language || "",
                publication_year: imported.publicationYear || null,
                category: imported.category || "Classic"
            },
            chapters: imported.chapters.map((chapter, index) => ({
                chapter_number: index + 1,
                title: normalizeImportedChapterTitle(chapter.title || `Chapter ${index + 1}`),
                content: cleanImportedText(chapter.content)
            }))
        });

    } catch (err) {
        console.error("Classics importer PREVIEW error:", err);

        res.status(422).json({
            success: false,
            message: err.message || "Unable to import this source."
        });
    }

});


/* ==========================================
   CLASSICS IMPORTER - IMPORT
   POST /api/admin/classics/import
========================================== */

router.post("/import", async (req, res) => {

    const client = await db.connect();

    try {
        const {
            title,
            author_name,
            original_language,
            language,
            description,
            cover_image,
            publication_year,
            source_name,
            source_url,
            license,
            category,
            is_featured,
            is_published,
            public_domain_verified,
            chapters
        } = req.body;

        if (!public_domain_verified) {
            return res.status(400).json({
                success: false,
                message: "Please confirm that you have verified the work is public domain or otherwise legally redistributable."
            });
        }

        if (!title || !author_name || !language || !source_url) {
            return res.status(400).json({
                success: false,
                message: "Title, author, language and source URL are required."
            });
        }

        if (!Array.isArray(chapters) || !chapters.length) {
            return res.status(400).json({
                success: false,
                message: "At least one chapter is required."
            });
        }

        const existing = await db.query(`
            SELECT id, title
            FROM classics
            WHERE source_url = $1
               OR (LOWER(title) = LOWER($2) AND LOWER(author_name) = LOWER($3))
            LIMIT 1
        `, [source_url, title, author_name]);

        if (existing.rows.length) {
            return res.status(409).json({
                success: false,
                message: `This Classic already exists: ${existing.rows[0].title}`,
                classic_id: existing.rows[0].id
            });
        }

        const connection = client;

        await client.query("BEGIN");

        const classicResult = await connection.query(`
            INSERT INTO classics (
                title,
                author_name,
                original_language,
                language,
                description,
                cover_image,
                publication_year,
                source_name,
                source_url,
                license,
                category,
                is_featured,
                is_published
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            RETURNING *
        `, [
            title.trim(),
            author_name.trim(),
            original_language?.trim() || null,
            language.trim(),
            description?.trim() || null,
            cover_image?.trim() || null,
            publication_year ? Number(publication_year) : null,
            source_name?.trim() || null,
            source_url.trim(),
            license?.trim() || "Public Domain",
            category?.trim() || null,
            Boolean(is_featured),
            is_published !== false
        ]);

        const classic = classicResult.rows[0];

        for (let index = 0; index < chapters.length; index++) {
            const chapter = chapters[index];
            const content = cleanImportedText(chapter.content);

            if (!content) continue;

            await connection.query(`
                INSERT INTO classic_chapters (
                    classic_id,
                    chapter_number,
                    title,
                    content
                )
                VALUES ($1,$2,$3,$4)
            `, [
                classic.id,
                Number(chapter.chapter_number) || index + 1,
                normalizeImportedChapterTitle(chapter.title || `Chapter ${index + 1}`),
                content
            ]);
        }

        await client.query("COMMIT");

        res.status(201).json({
            success: true,
            message: `Classic imported successfully with ${chapters.length} chapters.`,
            classic
        });

    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) {}

        console.error("Classics importer IMPORT error:", err);

        res.status(500).json({
            success: false,
            message: "Unable to import Classic."
        });

    } finally {
        client.release();
    }

});


/* ==========================================
   GET ALL CLASSICS
   GET /api/admin/classics
========================================== */

router.get("/", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT
                id,
                title,
                author_name,
                original_language,
                language,
                description,
                cover_image,
                publication_year,
                source_name,
                source_url,
                license,
                category,
                is_featured,
                is_published,
                view_count,
                created_at,
                updated_at
            FROM classics
            ORDER BY created_at DESC
        `);

        res.json({
            success: true,
            classics: result.rows
        });

    } catch (err) {

        console.error("Admin Classics GET error:", err);

        res.status(500).json({
            success: false,
            message: "Unable to load Classics."
        });

    }

});


/* ==========================================
   GET SINGLE CLASSIC
   GET /api/admin/classics/:id
========================================== */

router.get("/:id", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT
                id,
                title,
                author_name,
                original_language,
                language,
                description,
                cover_image,
                publication_year,
                source_name,
                source_url,
                license,
                category,
                is_featured,
                is_published,
                view_count,
                created_at,
                updated_at
            FROM classics
            WHERE id = $1
        `, [
            req.params.id
        ]);


        if (!result.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Classic not found."
            });

        }


        res.json({
            success: true,
            classic: result.rows[0]
        });

    } catch (err) {

        console.error("Admin Classic GET error:", err);

        res.status(500).json({
            success: false,
            message: "Unable to load Classic."
        });

    }

});


/* ==========================================
   CREATE CLASSIC
   POST /api/admin/classics
========================================== */

router.post("/", async (req, res) => {

    try {

        const {
            title,
            author_name,
            original_language,
            language,
            description,
            cover_image,
            publication_year,
            source_name,
            source_url,
            license,
            category,
            is_featured,
            is_published
        } = req.body;


        if (!title || !author_name || !language) {

            return res.status(400).json({
                success: false,
                message: "Title, author and language are required."
            });

        }


        const result = await db.query(`
            INSERT INTO classics (
                title,
                author_name,
                original_language,
                language,
                description,
                cover_image,
                publication_year,
                source_name,
                source_url,
                license,
                category,
                is_featured,
                is_published
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                $12,
                $13
            )
            RETURNING *
        `, [
            title,
            author_name,
            original_language || null,
            language,
            description || null,
            cover_image || null,
            publication_year || null,
            source_name || null,
            source_url || null,
            license || "Public Domain",
            category || null,
            Boolean(is_featured),
            is_published !== false
        ]);


        res.status(201).json({
            success: true,
            message: "Classic created successfully.",
            classic: result.rows[0]
        });

    } catch (err) {

        console.error("Admin Classic CREATE error:", err);

        res.status(500).json({
            success: false,
            message: "Unable to create Classic."
        });

    }

});


/* ==========================================
   UPDATE CLASSIC
   PUT /api/admin/classics/:id
========================================== */

router.put("/:id", async (req, res) => {

    try {

        const {
            title,
            author_name,
            original_language,
            language,
            description,
            cover_image,
            publication_year,
            source_name,
            source_url,
            license,
            category,
            is_featured,
            is_published
        } = req.body;


        if (!title || !author_name || !language) {

            return res.status(400).json({
                success: false,
                message: "Title, author and language are required."
            });

        }


        const result = await db.query(`
            UPDATE classics
            SET
                title = $1,
                author_name = $2,
                original_language = $3,
                language = $4,
                description = $5,
                cover_image = $6,
                publication_year = $7,
                source_name = $8,
                source_url = $9,
                license = $10,
                category = $11,
                is_featured = $12,
                is_published = $13,
                updated_at = NOW()
            WHERE id = $14
            RETURNING *
        `, [
            title,
            author_name,
            original_language || null,
            language,
            description || null,
            cover_image || null,
            publication_year || null,
            source_name || null,
            source_url || null,
            license || "Public Domain",
            category || null,
            Boolean(is_featured),
            Boolean(is_published),
            req.params.id
        ]);


        if (!result.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Classic not found."
            });

        }


        res.json({
            success: true,
            message: "Classic updated successfully.",
            classic: result.rows[0]
        });

    } catch (err) {

        console.error("Admin Classic UPDATE error:", err);

        res.status(500).json({
            success: false,
            message: "Unable to update Classic."
        });

    }

});


/* ==========================================
   DELETE CLASSIC
   DELETE /api/admin/classics/:id
========================================== */

router.delete("/:id", async (req, res) => {

    try {

        const result = await db.query(`
            DELETE FROM classics
            WHERE id = $1
            RETURNING id, title
        `, [
            req.params.id
        ]);


        if (!result.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Classic not found."
            });

        }


        res.json({
            success: true,
            message: "Classic deleted successfully."
        });

    } catch (err) {

        console.error("Admin Classic DELETE error:", err);

        res.status(500).json({
            success: false,
            message: "Unable to delete Classic."
        });

    }

});


/* ==========================================
   GET CHAPTERS
   GET /api/admin/classics/:id/chapters
========================================== */

router.get("/:id/chapters", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT
                id,
                classic_id,
                chapter_number,
                title,
                content,
                created_at,
                updated_at
            FROM classic_chapters
            WHERE classic_id = $1
            ORDER BY chapter_number ASC
        `, [
            req.params.id
        ]);


        res.json({
            success: true,
            chapters: result.rows
        });

    } catch (err) {

        console.error("Admin Classic chapters GET error:", err);

        res.status(500).json({
            success: false,
            message: "Unable to load chapters."
        });

    }

});


/* ==========================================
   CREATE CHAPTER
   POST /api/admin/classics/:id/chapters
========================================== */

router.post("/:id/chapters", async (req, res) => {

    try {

        const {
            chapter_number,
            title,
            content
        } = req.body;


        if (
            !chapter_number ||
            !content
        ) {

            return res.status(400).json({
                success: false,
                message: "Chapter number and content are required."
            });

        }


        const classic = await db.query(`
            SELECT id
            FROM classics
            WHERE id = $1
        `, [
            req.params.id
        ]);


        if (!classic.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Classic not found."
            });

        }


        const result = await db.query(`
            INSERT INTO classic_chapters (
                classic_id,
                chapter_number,
                title,
                content
            )
            VALUES (
                $1,
                $2,
                $3,
                $4
            )
            RETURNING *
        `, [
            req.params.id,
            chapter_number,
            title || `Chapter ${chapter_number}`,
            content
        ]);


        res.status(201).json({
            success: true,
            message: "Chapter created successfully.",
            chapter: result.rows[0]
        });

    } catch (err) {

        console.error("Admin Classic chapter CREATE error:", err);

        if (err.code === "23505") {

            return res.status(409).json({
                success: false,
                message: "That chapter number already exists."
            });

        }

        res.status(500).json({
            success: false,
            message: "Unable to create chapter."
        });

    }

});


/* ==========================================
   UPDATE CHAPTER
   PUT /api/admin/classics/:id/chapters/:chapterId
========================================== */

router.put(
    "/:id/chapters/:chapterId",
    async (req, res) => {

        try {

            const {
                chapter_number,
                title,
                content
            } = req.body;


            if (
                !chapter_number ||
                !content
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Chapter number and content are required."
                });

            }


            const result = await db.query(`
                UPDATE classic_chapters
                SET
                    chapter_number = $1,
                    title = $2,
                    content = $3,
                    updated_at = NOW()
                WHERE
                    id = $4
                    AND classic_id = $5
                RETURNING *
            `, [
                chapter_number,
                title || `Chapter ${chapter_number}`,
                content,
                req.params.chapterId,
                req.params.id
            ]);


            if (!result.rows.length) {

                return res.status(404).json({
                    success: false,
                    message: "Chapter not found."
                });

            }


            res.json({
                success: true,
                message: "Chapter updated successfully.",
                chapter: result.rows[0]
            });

        } catch (err) {

            console.error("Admin Classic chapter UPDATE error:", err);

            if (err.code === "23505") {

                return res.status(409).json({
                    success: false,
                    message: "That chapter number already exists."
                });

            }

            res.status(500).json({
                success: false,
                message: "Unable to update chapter."
            });

        }

    }
);


/* ==========================================
   DELETE CHAPTER
   DELETE /api/admin/classics/:id/chapters/:chapterId
========================================== */

router.delete(
    "/:id/chapters/:chapterId",
    async (req, res) => {

        try {

            const result = await db.query(`
                DELETE FROM classic_chapters
                WHERE
                    id = $1
                    AND classic_id = $2
                RETURNING id
            `, [
                req.params.chapterId,
                req.params.id
            ]);


            if (!result.rows.length) {

                return res.status(404).json({
                    success: false,
                    message: "Chapter not found."
                });

            }


            res.json({
                success: true,
                message: "Chapter deleted successfully."
            });

        } catch (err) {

            console.error("Admin Classic chapter DELETE error:", err);

            res.status(500).json({
                success: false,
                message: "Unable to delete chapter."
            });

        }

    }
);


module.exports = router;