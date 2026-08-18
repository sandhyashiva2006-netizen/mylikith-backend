const express = require("express");
const router = express.Router();

const db = require("../db");
const auth = require("../middleware/auth");
const axios = require("axios");




/* ==========================================
   CLASSICS IMPORTER HELPERS
========================================== */

function cleanImportedText(value) {
    let text = String(value || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

    // Project Gutenberg plain-text editions often contain illustration/image
    // descriptions that are useful for the source file but not for a clean
    // MyLikith reading experience. Remove complete illustration blocks while
    // keeping ordinary bracketed literary text untouched.
    const lines = text.split("\n");
    const cleanedLines = [];
    let insideIllustration = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!insideIllustration && /^\[(?:illustration|image):/i.test(line)) {
            // Single-line form: [Illustration: ...]
            if (/\]\s*$/.test(line)) {
                continue;
            }

            insideIllustration = true;
            continue;
        }

        if (insideIllustration) {
            // Some Gutenberg illustration blocks are malformed in plain text:
            // the closing ] is missing until a following chapter heading, e.g.
            // "Chapter I.]". Do not swallow a real chapter heading.
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

        // Gutenberg sometimes leaves a standalone image/illustration marker
        // or a lone closing bracket after an illustration block. These are
        // source-format artifacts, not part of the literary text.
        if (/^\[(?:illustration|image)\]$/i.test(line) || line === "]") {
            continue;
        }

        // Remove common inline Gutenberg image markers without touching
        // normal prose.
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

    // Fix source artifacts such as: "Chapter I.]" or "CHAPTER II."
    // while preserving the chapter's Roman numeral.
    const chapterMatch = title.match(/^chapter\s*(?:[-.:]\s*)?([ivxlcdm]+|\d{1,3})\s*\.?\s*\]?\s*(.*)$/i);
    if (chapterMatch) {
        const numeral = chapterMatch[1].match(/^\d+$/) ? chapterMatch[1] : chapterMatch[1].toUpperCase();
        const tail = String(chapterMatch[2] || "").replace(/^[-–—:.)\s]+/, "").trim();
        return tail ? `Chapter ${numeral}. ${tail}` : `Chapter ${numeral}.`;
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
            .replace(/<br\s*\/?\s*>/gi, "\n")
            .replace(/<\/p>/gi, "\n\n")
            .replace(/<\/div>/gi, "\n")
            .replace(/<\/h[1-6]>/gi, "\n\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'")
            .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
            .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    );
}

function extractMetaFromHtml(html) {
    const titleMatch = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descriptionMatch = String(html || "").match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);

    return {
        title: titleMatch ? htmlToText(titleMatch[1]).replace(/\s+/g, " ").trim() : "",
        description: descriptionMatch ? htmlToText(descriptionMatch[1]).replace(/\s+/g, " ").trim() : ""
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

    // Project Gutenberg's current book page commonly includes an
    // automatically generated description containing "published in YYYY".
    if (!publicationYear) {
        const generatedDescriptionMatch = pageText.match(/published in\s+(17\d{2}|18\d{2}|19\d{2}|20\d{2})/i);
        if (generatedDescriptionMatch) {
            publicationYear = Number(generatedDescriptionMatch[1]);
        }
    }

    const subjectStart = pageText.search(/(?:^|\n)Subject\s*\|?/i);
    const categoryStart = pageText.search(/(?:^|\n)Category\s*\|?/i);
    const subjectText = subjectStart >= 0
        ? pageText.slice(subjectStart, categoryStart > subjectStart ? categoryStart : subjectStart + 1800)
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

    let description = "";
    const ogDescription = String(html || "").match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
    const metaDescription = String(html || "").match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
    description = (ogDescription?.[1] || metaDescription?.[1] || "")
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
            content = content.slice(match.index + match[0].length).trim();
            break;
        }
    }

    const endMatch = content.match(/\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i);
    if (endMatch) content = content.slice(0, endMatch.index).trim();

    const lines = content.split("\n");
    const rawChapters = [];
    let currentTitle = "Introduction";
    let current = [];

    const isChapterHeading = line => {
        const value = line.trim().replace(/[\u200B\uFEFF]/g, "");
        if (!value || value.length > 100) return false;

        return /^(?:chapter|book|part|volume|section)\s+(?:[0-9]{1,3}|[ivxlcdm]+|[a-z]+)(?:\s*[.)\-:]?\s*.*)?$/i.test(value)
            || /^chapter\s*[-.:]\s*(?:[0-9]{1,3}|[ivxlcdm]+|[a-z]+)(?:\s*[.)\-:]?\s*.*)?$/i.test(value)
            || /^chapter\s+[ivxlcdm]+\s*\.?\]?(?:\s+.*)?$/i.test(value)
            || /^chapter\s+[a-z]+\s*\.?\]?(?:\s+.*)?$/i.test(value);
    };

    for (const line of lines) {
        if (isChapterHeading(line)) {
            const textBlock = cleanImportedText(current.join("\n"));
            rawChapters.push({
                title: currentTitle,
                content: textBlock
            });
            currentTitle = normalizeImportedChapterTitle(line);
            current = [];
        } else {
            current.push(line);
        }
    }

    const finalBlock = cleanImportedText(current.join("\n"));
    rawChapters.push({ title: currentTitle, content: finalBlock });

    // Gutenberg editions commonly contain a table of contents before the
    // real chapters. The TOC can contain the same "CHAPTER 1", "CHAPTER 14",
    // etc. headings and would otherwise become tiny fake chapters. Collapse
    // duplicate chapter titles by retaining the largest content block.
    const grouped = new Map();
    const introductionBlocks = [];

    const chapterNumber = title => {
        const value = String(title || "").trim();
        const arabic = value.match(/^(?:chapter|book|part|volume|section)\s+(\d+)/i);
        if (arabic) return Number(arabic[1]);

        const roman = value.match(/^(?:chapter|book|part|volume|section)\s+([ivxlcdm]+)/i);
        if (roman) {
            const values = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
            let total = 0, previous = 0;
            for (const ch of roman[1].toLowerCase().split("").reverse()) {
                const n = values[ch] || 0;
                total += n < previous ? -n : n;
                previous = n;
            }
            return total;
        }
        return null;
    };

    for (const chapter of rawChapters) {
        const title = normalizeImportedChapterTitle(chapter.title || "Introduction");
        const body = cleanImportedText(chapter.content);
        const number = chapterNumber(title);

        if (number == null) {
            if (body) introductionBlocks.push({ title, content: body });
            continue;
        }

        const key = `chapter-${number}`;
        const existing = grouped.get(key);
        if (!existing || body.length > existing.content.length) {
            grouped.set(key, { title, content: body, number });
        }
    }

    const chapters = [];

    // Keep meaningful front matter as Introduction only when it contains real
    // text. Very small TOC fragments are discarded.
    const introText = introductionBlocks
        .map(item => item.content)
        .filter(text => text.length >= 80)
        .join("\n\n")
        .trim();

    if (introText) chapters.push({ title: "Introduction", content: introText });

    const numbered = [...grouped.values()]
        .filter(chapter => chapter.content.length >= 20)
        .sort((a, b) => a.number - b.number);

    chapters.push(...numbered.map(chapter => ({
        title: chapter.title,
        content: chapter.content
    })));

    // Some Gutenberg editions use bare Roman numerals (I, II, III...) or
    // bare Arabic numbers as chapter headings. If the normal parser found
    // only one enormous block, make a conservative second pass for those
    // heading styles. This prevents an entire novel from becoming one chapter.
    if (chapters.length <= 1 && content.length > 20000) {
        const fallbackLines = content.split("\n");
        const fallback = [];
        let fallbackTitle = "Introduction";
        let fallbackBody = [];

        const isBareChapter = (line, index) => {
            const value = line.trim();
            if (!value || value.length > 20) return false;
            if (index > 0 && fallbackLines[index - 1].trim() !== "") return false;
            if (index + 1 < fallbackLines.length && fallbackLines[index + 1].trim() === "") return false;
            return /^[IVXLCDM]{1,12}[.)]?$/.test(value) || /^\d{1,3}[.)]?$/.test(value);
        };

        for (let i = 0; i < fallbackLines.length; i++) {
            const line = fallbackLines[i];
            if (isBareChapter(line, i)) {
                const body = cleanImportedText(fallbackBody.join("\n"));
                if (body.length >= 50) fallback.push({ title: fallbackTitle, content: body });
                fallbackTitle = `Chapter ${line.trim().replace(/[.)]$/, "")}`;
                fallbackBody = [];
            } else {
                fallbackBody.push(line);
            }
        }

        const finalFallbackBody = cleanImportedText(fallbackBody.join("\n"));
        if (finalFallbackBody.length >= 50) {
            fallback.push({ title: fallbackTitle, content: finalFallbackBody });
        }

        const realFallback = fallback.filter(item => item.content.length >= 50);
        if (realFallback.length >= 2) {
            const fallbackMap = new Map();
            for (const item of realFallback) {
                const key = item.title.toLowerCase();
                const existing = fallbackMap.get(key);
                if (!existing || item.content.length > existing.content.length) {
                    fallbackMap.set(key, item);
                }
            }

            const chapterItems = [...fallbackMap.values()].filter(item => item.title !== "Introduction");
            const intro = [...fallbackMap.values()].find(item => item.title === "Introduction" && item.content.length < 5000);

            const fallbackNumber = title => {
                const value = String(title || "").replace(/^Chapter\s+/i, "").trim();
                if (/^\d+$/.test(value)) return Number(value);
                if (/^[IVXLCDM]+$/i.test(value)) {
                    const values = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
                    let total = 0, previous = 0;
                    for (const ch of value.toLowerCase().split("").reverse()) {
                        const n = values[ch] || 0;
                        total += n < previous ? -n : n;
                        previous = n;
                    }
                    return total;
                }
                return Number.MAX_SAFE_INTEGER;
            };

            chapterItems.sort((a, b) => fallbackNumber(a.title) - fallbackNumber(b.title));
            chapters.length = 0;
            if (intro) chapters.push(intro);
            chapters.push(...chapterItems);
        }
    }

    if (!chapters.length) {
        return [{ title: "Chapter 1", content }];
    }

    return chapters.map((chapter, index) => ({
        title: normalizeImportedChapterTitle(chapter.title || `Chapter ${index + 1}`),
        content: cleanImportedText(chapter.content)
    }));
}

function parseGenericText(text) {
    const content = cleanImportedText(text);
    const lines = content.split("\n");
    const chapters = [];
    let currentTitle = "Chapter 1";
    let current = [];

    const headingRegex = /^(chapter|part|book|section|అధ్యాయం|భాగం|కాండం)\s*[\dIVXivxఅ-హA-Za-z0-9.:\-]*/i;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && trimmed.length <= 120 && headingRegex.test(trimmed)) {
            const block = cleanImportedText(current.join("\n"));
            if (block) {
                chapters.push({ title: currentTitle, content: block });
            }
            currentTitle = trimmed;
            current = [];
        } else {
            current.push(line);
        }
    }

    const finalBlock = cleanImportedText(current.join("\n"));
    if (finalBlock) {
        chapters.push({ title: currentTitle, content: finalBlock });
    }

    return chapters.length
        ? chapters
        : [{ title: "Chapter 1", content }];
}

function detectWikisourceInfo(sourceUrl) {
    const url = new URL(sourceUrl);
    const host = url.hostname.toLowerCase();

    if (!host.endsWith(".wikisource.org")) return null;

    const languageCode = host.split(".")[0];
    let title = "";

    if (url.pathname.startsWith("/wiki/")) {
        title = decodeURIComponent(url.pathname.slice("/wiki/".length));
    } else if (url.pathname === "/w/index.php") {
        title = String(url.searchParams.get("title") || "");
    }

    title = title.replace(/_/g, " ").trim();

    if (!title) {
        throw new Error("The Wikisource URL must point to a specific work page.");
    }

    const languageNames = {
        en: "English",
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
        as: "Assamese",
        ne: "Nepali",
        mai: "Maithili",
        bho: "Bhojpuri",
        ar: "Arabic",
        fr: "French",
        de: "German",
        es: "Spanish",
        it: "Italian",
        pt: "Portuguese",
        ru: "Russian",
        zh: "Chinese"
    };

    return {
        languageCode,
        host,
        language: languageNames[languageCode] || languageCode.toUpperCase(),
        title,
        apiUrl: `https://${host}/w/api.php`,
        sourceName: `Wikisource — ${languageNames[languageCode] || languageCode.toUpperCase()}`
    };
}

async function wikisourceApi(apiUrl, params) {
    const response = await axios.get(apiUrl, {
        params: {
            ...params,
            format: "json",
            formatversion: 2
        },
        timeout: 20000,
        responseType: "json",
        maxContentLength: 12 * 1024 * 1024,
        headers: {
            "User-Agent": "MyLikith-Classics-Importer/1.0"
        }
    });

    if (!response.data || response.data.error) {
        throw new Error(response.data?.error?.info || "Wikisource API request failed.");
    }

    return response.data;
}

function extractFirstImageFromHtml(html) {
    const source = String(html || "");
    const match = source.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
    if (!match) return null;

    let src = match[1].trim();
    if (src.startsWith("//")) src = `https:${src}`;
    if (src.startsWith("/")) src = `https://upload.wikimedia.org${src}`;

    return /^https?:\/\//i.test(src) ? src : null;
}

function extractWikisourceAuthor(text) {
    const lines = String(text || "")
        .split("\n")
        .map(line => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);

    const patterns = [
        /^(?:author|written by|poet|writer)\s*[:\-]\s*(.+)$/i,
        /^(?:రచయిత|రచించినవారు|రచించిన వారు|కవి)\s*[:\-]?\s*(.+)$/i,
        /^(?:రచయిత|రచించినవారు|రచించిన వారు|కవి)\s+(.+)$/i
    ];

    for (const line of lines.slice(0, 80)) {
        for (const pattern of patterns) {
            const match = line.match(pattern);
            if (match && match[1].trim().length <= 160) {
                return match[1].trim();
            }
        }
    }

    return "";
}

function extractWikisourcePublicationYear(text) {
    const source = String(text || "");
    const patterns = [
        /(?:published|publication|first published|printed|edition)[^\d]{0,80}(1[5-9]\d{2}|20\d{2})/i,
        /(?:ప్రచురణ|ముద్రణ|ప్రచురించబడిన|సంవత్సరం)[^\d]{0,80}(1[5-9]\d{2}|20\d{2})/i,
        /\b(1[5-9]\d{2}|20\d{2})\b/
    ];

    for (const pattern of patterns) {
        const match = source.match(pattern);
        if (match) return Number(match[1]);
    }

    return null;
}

function cleanWikisourceHtml(html) {
    let source = String(html || "");

    source = source
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<table[\s\S]*?<\/table>/gi, "")
        .replace(/<div[^>]*class=["'][^"']*(?:mw-editsection|navbox|metadata|catlinks)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
        .replace(/<sup[^>]*class=["'][^"']*reference[^"']*["'][^>]*>[\s\S]*?<\/sup>/gi, "")
        .replace(/<ol[^>]*class=["'][^"']*references[^"']*["'][^>]*>[\s\S]*?<\/ol>/gi, "")
        .replace(/<span[^>]*class=["'][^"']*mw-editsection[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "");

    return htmlToText(source)
        .replace(/\n[ \t]*Image[ \t]*\n/gi, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function normalizeWikisourceChapterTitle(mainTitle, linkedTitle) {
    let title = String(linkedTitle || "").trim();
    const prefix = `${mainTitle}/`;

    if (title.startsWith(prefix)) {
        title = title.slice(prefix.length);
    }

    return title.replace(/_/g, " ").replace(/\s+/g, " ").trim() || "Chapter";
}

function extractWikisourceCoverFromHtml(html) {
    const source = String(html || "");
    const candidates = [];
    const hrefRegex = /href=["']([^"']+)["']/gi;
    let match;

    while ((match = hrefRegex.exec(source)) !== null) {
        let href = String(match[1] || "").trim();
        if (!href) continue;
        if (href.startsWith("//")) href = `https:${href}`;
        if (!/^https?:\/\/upload\.wikimedia\.org\//i.test(href)) continue;

        const lower = href.toLowerCase();
        if (
            lower.includes("pd-icon") ||
            lower.includes("public_domain") ||
            lower.includes("wikimedia-button") ||
            lower.includes("commons-logo") ||
            lower.includes("edit-clear")
        ) continue;

        candidates.push(href);
    }

    // Also inspect image src values, but never blindly use the first image.
    const srcRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    while ((match = srcRegex.exec(source)) !== null) {
        let src = String(match[1] || "").trim();
        if (src.startsWith("//")) src = `https:${src}`;
        if (!/^https?:\/\/upload\.wikimedia\.org\//i.test(src)) continue;

        const lower = src.toLowerCase();
        if (
            lower.includes("pd-icon") ||
            lower.includes("public_domain") ||
            lower.includes("wikimedia-button") ||
            lower.includes("commons-logo") ||
            lower.includes("edit-clear")
        ) continue;

        candidates.push(src);
    }

    return candidates[0] || null;
}


function wikisourcePageUrl(info, title) {
    return `https://${info.host}/wiki/${encodeURIComponent(title).replace(/%2F/g, "/")}`;
}

function extractElementHtmlByMarker(html, markerType, markerValue) {
    const source = String(html || "");
    const openRegex = markerType === "id"
        ? new RegExp(`<([a-z0-9]+)\b[^>]*\bid=["']${markerValue}["'][^>]*>`, "i")
        : new RegExp(`<([a-z0-9]+)\b[^>]*\bclass=["'][^"']*\b${markerValue}\b[^"']*["'][^>]*>`, "i");
    const match = source.match(openRegex);
    if (!match || match.index == null) return source;

    const tag = match[1].toLowerCase();
    const start = match.index;
    const tagRegex = new RegExp(`<\\/?${tag}\b[^>]*>`, "gi");
    tagRegex.lastIndex = start;
    let depth = 0;
    let first = true;
    let token;
    while ((token = tagRegex.exec(source)) !== null) {
        const raw = token[0];
        if (/^<\//.test(raw)) {
            depth--;
            if (depth === 0) {
                return source.slice(start, tagRegex.lastIndex);
            }
        } else if (!/\/\s*>$/.test(raw)) {
            depth++;
            first = false;
        }
    }
    return source.slice(start);
}

async function fetchWikisourceDirectHtml(info, title, options = {}) {
    const includeCover = options.includeCover !== false;
    const url = wikisourcePageUrl(info, title);
    const response = await axios.get(url, {
        timeout: 30000,
        responseType: "text",
        maxContentLength: 20 * 1024 * 1024,
        headers: {
            "User-Agent": "MyLikith-Classics-Importer/1.0"
        }
    });

    const rawHtml = String(response.data || "");
    const contentHtml = extractElementHtmlByMarker(rawHtml, "id", "mw-content-text") || rawHtml;
    const parserHtml = extractElementHtmlByMarker(contentHtml, "class", "mw-parser-output") || contentHtml;
    const text = cleanWikisourceHtml(parserHtml);

    let coverImage = null;
    if (includeCover) {
        coverImage = extractWikisourceCoverFromHtml(parserHtml) || extractFirstImageFromHtml(parserHtml);
    }

    return {
        title,
        html: parserHtml,
        wikitext: "",
        text,
        coverImage,
        parsedLinks: []
    };
}

async function fetchWikisourcePage(apiUrl, title, options = {}) {
    const includeCover = options.includeCover !== false;

    try {
        const data = await wikisourceApi(apiUrl, {
            action: "parse",
            page: title,
            prop: "text|links|wikitext",
            redirects: 1
        });

        const html = data.parse?.text || "";
        const pageTitle = data.parse?.title || title;

        let coverImage = null;
        if (includeCover) {
            try {
                const imageData = await wikisourceApi(apiUrl, {
                    action: "query",
                    prop: "pageimages",
                    piprop: "thumbnail|original",
                    pithumbsize: 1000,
                    titles: pageTitle
                });
                const pages = imageData.query?.pages || {};
                const page = Array.isArray(pages) ? pages[0] : Object.values(pages)[0];
                coverImage = page?.original?.source || page?.thumbnail?.source || null;
            } catch (imageError) {
                console.warn(`Wikisource PageImages detection failed for ${pageTitle}:`, imageError.message);
            }
            if (!coverImage) coverImage = extractWikisourceCoverFromHtml(html);
        }

        return {
            title: pageTitle,
            html,
            wikitext: data.parse?.wikitext || "",
            text: cleanWikisourceHtml(html),
            coverImage,
            parsedLinks: Array.isArray(data.parse?.links) ? data.parse.links : []
        };
    } catch (apiError) {
        console.warn(`Wikisource API fetch failed for ${title}; trying direct page HTML:`, apiError.message);
        return fetchWikisourceDirectHtml({
            host: new URL(apiUrl).hostname
        }, title, { includeCover });
    }
}



function decodeWikisourceTitle(value) {
    let text = String(value || "").trim();

    // Decode URL encoding repeatedly when Wikisource returns encoded titles.
    for (let i = 0; i < 3; i++) {
        try {
            const decoded = decodeURIComponent(text);
            if (decoded === text) break;
            text = decoded;
        } catch {
            break;
        }
    }

    // Decode the small set of HTML entities that commonly occur in page
    // titles/links. Numeric entities are handled generically.
    text = text
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#(\d+);/g, (_, n) => {
            try { return String.fromCodePoint(Number(n)); } catch { return _; }
        })
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
            try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; }
        });

    return text.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function extractWikisourceSubpageTitlesFromParsedLinks(parsedLinks, info) {
    const titles = [];
    const seen = new Set();
    for (const link of Array.isArray(parsedLinks) ? parsedLinks : []) {
        const title = decodeWikisourceTitle(typeof link === "string" ? link : link?.title);
        if (!title) continue;
        const prefix = `${info.title}/`;
        if (!title.startsWith(prefix)) continue;
        const suffix = title.slice(prefix.length).trim();
        if (!suffix || suffix.includes("/")) continue;
        if (isWikisourceNonChapterSubpage(suffix)) continue;
        const key = title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        titles.push(title);
    }
    return titles;
}

function extractWikisourceSubpageTitlesFromHtml(html, info) {
    const source = String(html || "");
    const titles = [];
    const seen = new Set();
    const hrefRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
    let match;

    while ((match = hrefRegex.exec(source)) !== null) {
        let href = String(match[1] || "").trim();
        if (!href || href.startsWith("#") || /^javascript:/i.test(href)) continue;

        let title = "";
        try {
            const base = `https://${info.host}`;
            const absolute = new URL(href, base);
            if (absolute.pathname.startsWith("/wiki/")) {
                title = decodeWikisourceTitle(absolute.pathname.slice("/wiki/".length));
            } else if (absolute.pathname === "/w/index.php") {
                title = decodeWikisourceTitle(absolute.searchParams.get("title") || "");
            }
        } catch {
            continue;
        }

        if (!title) continue;
        const prefix = `${info.title}/`;
        if (!title.startsWith(prefix)) continue;
        const suffix = title.slice(prefix.length).trim();
        if (!suffix || suffix.includes("/")) continue;
        if (isWikisourceNonChapterSubpage(suffix)) continue;

        const key = title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        titles.push(title);
    }

    return titles;
}

function isWikisourceNonChapterSubpage(value) {
    const v = decodeWikisourceTitle(value).toLowerCase().trim();
    if (!v) return true;

    const excluded = [
        "toc", "table of contents", "contents", "preface", "foreword", "introduction",
        "front matter", "copyright", "license", "notes", "references", "bibliography",
        "author", "author portrait", "illustrations", "images", "index", "appendix",
        "విషయసూచిక", "పూర్తివిషయసూచిక", "ప్రవేశిక", "అవతారిక", "ముందుమాట", "కృతజ్ఞతలు",
        "సంపాదకీయభూమిక", "సంపాదకీయ భూమిక", "భూమిక", "రచయిత చిత్రపటం", "ఆంధ్రమహాజనులకు విజ్ఞప్తి", "ప్రకటనలు", "ఇతర మూల ప్రతులు",
        "వికీసోర్స్ కూర్పు ముందుమాట", "ఇవీచూడండి"
    ];

    return excluded.some(item => v === item || v.startsWith(`${item} `));
}


function extractWikisourceTocSubpageTitlesFromWikitext(wikitext, info) {
    const source = String(wikitext || "");
    const lines = source.split(/\r?\n/);
    const headingRe = /^(={2,6})\s*(.*?)\s*\1\s*$/u;
    let tocStart = -1;
    let tocLevel = 0;

    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(headingRe);
        if (!m) continue;
        const heading = decodeWikisourceTitle(m[2]).toLowerCase();
        if (
            heading === "విషయసూచిక" ||
            heading.includes("విషయసూచిక") ||
            heading === "table of contents" ||
            heading === "contents" ||
            heading === "toc" ||
            heading.includes("table of contents") ||
            heading === "विषय सूची" ||
            heading === "अनुक्रमणिका" ||
            heading === "সূচিপত্র" ||
            heading === "தலைப்புகளின் பட்டியல்" ||
            heading === "பொருளடக்கம்" ||
            heading === "ಪರಿವಿಡಿ" ||
            heading === "ವಿಷಯ ಸೂಚಿ"
        ) {
            tocStart = i + 1;
            tocLevel = m[1].length;
            break;
        }
    }

    if (tocStart < 0) return [];

    const tocLines = [];
    for (let i = tocStart; i < lines.length; i++) {
        const m = lines[i].match(headingRe);
        if (m && m[1].length <= tocLevel) break;
        tocLines.push(lines[i]);
    }

    const prefix = `${info.title}/`;
    const titles = [];
    const seen = new Set();
    const linkRegex = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

    for (const line of tocLines) {
        let match;
        while ((match = linkRegex.exec(line)) !== null) {
            const title = decodeWikisourceTitle(match[1]);
            if (!title.startsWith(prefix)) continue;
            const suffix = title.slice(prefix.length).trim();
            if (!suffix || suffix.includes("/")) continue;
            if (isWikisourceNonChapterSubpage(suffix)) continue;
            const key = canonicalWikisourceChapterKey(title);
            if (seen.has(key)) continue;
            seen.add(key);
            titles.push(title);
        }
    }

    return titles;
}

function extractWikisourceSubpageTitlesFromWikitext(wikitext, info) {
    const source = String(wikitext || "");
    const prefix = `${info.title}/`;
    const titles = [];
    const seen = new Set();

    // Wikisource TOCs are normally explicit wikilinks. Reading the raw
    // wikitext preserves their source order and avoids API/link-result
    // truncation or reordering. We intentionally inspect every direct
    // subpage link, then let the chapter classifier remove navigation pages.
    const linkRegex = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
    let match;

    while ((match = linkRegex.exec(source)) !== null) {
        const title = decodeWikisourceTitle(match[1]);
        if (!title.startsWith(prefix)) continue;

        const suffix = title.slice(prefix.length).trim();
        if (!suffix || suffix.includes("/")) continue;
        if (isWikisourceNonChapterSubpage(suffix)) continue;
        if (!isLikelyWikisourceChapterSuffix(suffix)) continue;

        const key = title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        titles.push(title);
    }

    return titles;
}

function normalizeWikisourceOrdinalNumber(value) {
    const v = decodeWikisourceTitle(value).trim().toLowerCase();
    const map = {
        "మొదటి": 1, "ప్రథమ": 1,
        "రెండవ": 2, "రెండవది": 2, "ద్వితీయ": 2,
        "మూడవ": 3, "తృతీయ": 3,
        "నాలుగవ": 4, "నాలుగో": 4, "చతుర్థ": 4,
        "ఐదవ": 5, "పంచమ": 5,
        "ఆరవ": 6, "షష్ఠ": 6,
        "ఏడవ": 7, "సప్తమ": 7,
        "ఎనిమిదవ": 8, "అష్టమ": 8,
        "తొమ్మిదవ": 9, "నవమ": 9,
        "పదవ": 10, "దశమ": 10,
        "పదకొండవ": 11, "పదునొకొండవ": 11, "ఏకాదశ": 11,
        "పన్నెండవ": 12, "పండ్రెండవ": 12, "ద్వాదశ": 12,
        "పదమూడవ": 13, "పదుమూడవ": 13, "త్రయోదశ": 13,
        "పదునాలుగవ": 14, "చతుర్దశ": 14,
        "పదునైదవ": 15, "పంచదశ": 15,
        "పదునాఱవ": 16, "పదహారవ": 16, "షోడశ": 16,
        "పదిహేడవ": 17, "సప్తదశ": 17,
        "పద్దెనిమిదవ": 18, "అష్టాదశ": 18,
        "పందొమ్మిదవ": 19, "ఏకోనవింశ": 19,
        "ఇరవయ్యవ": 20, "వింశ": 20
    };
    return map[v] || null;
}

function isLikelyWikisourceChapterSuffix(suffix) {
    const value = decodeWikisourceTitle(suffix);
    if (!value) return false;
    if (isWikisourceNonChapterSubpage(value)) return false;

    // Direct first-level subpages on a Wikisource work page are candidates.
    // Named sections such as Telugu literary chapter titles often do not
    // contain words like "chapter" or "part", so do not reject them merely
    // because their title is descriptive.
    return true;
}


function isStrongWikisourceChapterTitle(suffix) {
    const v = decodeWikisourceTitle(suffix).trim();
    if (!v) return false;

    if (/(?:chapter|part|section|book|volume|act|canto)\s*[-.:#]?\s*(?:\d{1,3}|[IVXLCDM]{1,12})(?:\b|\.)/i.test(v)) return true;
    if (/^(?:[\p{L}]+)\s+(?:ప్రకరణము|ప్రకరణం|భాగము|భాగం)$/u.test(v)) return true;
    if (/^(?:అధ్యాయం|అధ్యాయము|భాగం|భాగము|కాండము|కాండం)\s*(?:[-.:#]?\s*)?(?:\d{1,3}|[IVXLCDM]{1,12})/iu.test(v)) return true;
    if (/^(?:అధ్యాయ|भाग|अध्याय|प्रकरण|खंड|खण्ड|अंक|பகுதி|அத்தியாயம்|பிரிவு|ಅಧ್ಯಾಯ|ಭಾಗ)\s*[-.:#]?\s*[\dIVXLCDM०-९]+/iu.test(v)) return true;
    return false;
}

function refineWikisourceChapterTitles(titles, info) {
    if (!titles.length) return titles;
    const suffixes = titles.map(title => title.slice(`${info.title}/`.length));
    const strong = suffixes.filter(isStrongWikisourceChapterTitle);

    // If the work has a clearly numbered/ordinal chapter family, use that
    // family as the authoritative set. This prevents front-matter subpages
    // such as "Wikisource notes" from becoming a chapter while still allowing
    // genuinely named sections for works that have no numbered chapter family.
    if (strong.length >= 2 && strong.length >= Math.ceil(suffixes.length * 0.5)) {
        const strongSet = new Set(strong.map(value => decodeWikisourceTitle(value).toLowerCase()));
        return titles.filter(title => strongSet.has(decodeWikisourceTitle(title.slice(`${info.title}/`.length)).toLowerCase()));
    }

    return titles;
}


function canonicalWikisourceChapterKey(value) {
    let text = decodeWikisourceTitle(value);
    try { text = text.normalize("NFKC"); } catch {}
    return text
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/[\u2010-\u2015]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function canonicalWikisourceChapterContentKey(value) {
    return String(value || "")
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function dedupeWikisourceChapterTitles(titles, info) {
    const seen = new Set();
    const result = [];
    for (const title of titles) {
        const suffix = normalizeWikisourceChapterTitle(info.title, title);
        const key = canonicalWikisourceChapterKey(suffix);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(title);
    }
    return result;
}

function sortWikisourceChapterTitles(titles, info) {
    const ordinal = value => {
        const v = decodeWikisourceTitle(value).trim();
        const numeric = v.match(/(?:chapter|part|section|book|volume|act|canto|ప్రకరణము|ప్రకరణం|భాగము|భాగం)\s*[-.:#]?\s*(\d{1,3})/i);
        if (numeric) return Number(numeric[1]);

        const roman = v.match(/(?:chapter|part|section|book|volume|act|canto)\s*[-.:#]?\s*([IVXLCDM]{1,10})\b/i);
        if (roman) {
            const map = {I:1,V:5,X:10,L:50,C:100,D:500,M:1000};
            let total=0, prev=0;
            for (const ch of roman[1].toUpperCase().split("").reverse()) {
                const n=map[ch] || 0;
                if (n < prev) total -= n; else { total += n; prev=n; }
            }
            return total || null;
        }

        const telugu = v.match(/^([^\s]+)\s+(?:ప్రకరణము|ప్రకరణం|భాగము|భాగం)$/i);
        if (telugu) return normalizeWikisourceOrdinalNumber(telugu[1]);
        return null;
    };

    const withIndex = titles.map((title, index) => ({ title, index, n: ordinal(title.slice(info.title.length + 1)) }));
    const recognized = withIndex.filter(item => Number.isFinite(item.n));

    if (recognized.length >= Math.max(2, Math.ceil(withIndex.length * 0.5))) {
        return withIndex
            .sort((a, b) => {
                if (a.n == null && b.n == null) return a.index - b.index;
                if (a.n == null) return 1;
                if (b.n == null) return -1;
                return a.n - b.n || a.index - b.index;
            })
            .map(item => item.title);
    }

    // Otherwise preserve the source TOC order exactly.
    return titles;
}

async function fetchWikisourceChapterWithRetry(info, title, attempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            // Prefer the normal public Wikisource page for chapter content.
            // This avoids API throttling/partial parse responses on large works.
            const page = await fetchWikisourceDirectHtml(info, title, { includeCover: false });
            if (!page.text || page.text.trim().length < 20) {
                throw new Error("Chapter page returned no usable text.");
            }
            return page;
        } catch (directError) {
            lastError = directError;
            try {
                const page = await fetchWikisourcePage(info.apiUrl, title, { includeCover: false });
                if (!page.text || page.text.trim().length < 20) {
                    throw new Error("Chapter page returned no usable text.");
                }
                return page;
            } catch (apiError) {
                lastError = apiError;
            }
        }

        if (attempt < attempts) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    throw lastError || new Error("Chapter fetch failed.");
}


async function fetchWikisourceChapters(info) {
    const mainPage = await fetchWikisourcePage(info.apiUrl, info.title, { includeCover: true });
    const chapterTitles = [];
    const seen = new Set();

    const add = value => {
        const title = decodeWikisourceTitle(value);
        const prefix = `${info.title}/`;
        if (!title.startsWith(prefix)) return;
        const suffix = title.slice(prefix.length).trim();
        if (!suffix || suffix.includes("/")) return;
        if (isWikisourceNonChapterSubpage(suffix)) return;
        if (!isLikelyWikisourceChapterSuffix(suffix)) return;
        const key = title.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        chapterTitles.push(title);
    };

    // 1. If the work has an explicit Table of Contents section, it is the
    // authoritative chapter list. Do NOT merge broad subpage discovery into
    // a TOC-backed work: Wikisource often contains alternate editions, scans,
    // front matter, and helper subpages that share the same parent title.
    const tocTitles = extractWikisourceTocSubpageTitlesFromWikitext(mainPage.wikitext, info);
    if (tocTitles.length) {
        for (const title of tocTitles) add(title);
    } else {
        // 2. No explicit TOC was found, so fall back to parsed links and
        // rendered HTML as broader discovery sources.
        for (const title of extractWikisourceSubpageTitlesFromWikitext(mainPage.wikitext, info)) add(title);
        for (const title of extractWikisourceSubpageTitlesFromParsedLinks(mainPage.parsedLinks, info)) add(title);
        for (const title of extractWikisourceSubpageTitlesFromHtml(mainPage.html, info)) add(title);
    }

    // 3. Complete query=links is only a fallback when no explicit TOC was
    // found. With a TOC, broad link discovery must never add extra subpages.
    if (!tocTitles.length) try {
        let plcontinue = null;
        do {
            const params = {
                action: "query",
                prop: "links",
                titles: info.title,
                plnamespace: 0,
                pllimit: "max"
            };
            if (plcontinue) params.plcontinue = plcontinue;

            const linksData = await wikisourceApi(info.apiUrl, params);
            const pages = linksData.query?.pages || {};
            const pageList = Array.isArray(pages) ? pages : Object.values(pages);
            for (const page of pageList) {
                for (const link of (page.links || [])) add(link.title);
            }
            plcontinue = linksData.continue?.plcontinue || null;
        } while (plcontinue);
    } catch (linkDiscoveryError) {
        console.warn("Wikisource query=links discovery failed; continuing with page TOC links:", linkDiscoveryError.message);
    }

    // The same Wikisource chapter can be discovered through the TOC, parsed
    // links, rendered HTML, and the links API. Normalize Unicode/whitespace
    // before deciding whether two candidates are the same page.
    const uniqueTitles = dedupeWikisourceChapterTitles(chapterTitles, info);
    const refinedTitles = refineWikisourceChapterTitles(uniqueTitles, info);
    const orderedTitles = sortWikisourceChapterTitles(refinedTitles, info);

    // Fetch sequentially with a small delay. Wikisource can throttle bursts of
    // API/page requests, especially when a work contains many long chapters.
    // Sequential fetching is slower but substantially more reliable for a
    // production importer and avoids the exact "6 fetched, 11 failed" pattern.
    const chapters = [];
    const failed = [];
    const fetchedPageKeys = new Set();
    const fetchedContentKeys = new Set();
    for (let i = 0; i < orderedTitles.length; i++) {
        const title = orderedTitles[i];
        try {
            const page = await fetchWikisourceChapterWithRetry(info, title, 3);
            const canonicalTitle = normalizeWikisourceChapterTitle(info.title, page.title || title);
            const pageKey = canonicalWikisourceChapterKey(canonicalTitle);
            const contentKey = canonicalWikisourceChapterContentKey(page.text);

            // A redirect/alias can cause two different discovered URLs to
            // resolve to the same Wikisource page. Never create that chapter
            // twice. A long identical body is also treated as a duplicate
            // safety net for mirrored/aliased subpages.
            if (pageKey && fetchedPageKeys.has(pageKey)) {
                continue;
            }
            if (contentKey.length >= 500 && fetchedContentKeys.has(contentKey)) {
                continue;
            }

            if (pageKey) fetchedPageKeys.add(pageKey);
            if (contentKey.length >= 500) fetchedContentKeys.add(contentKey);
            chapters.push({
                title: canonicalTitle,
                content: page.text
            });
        } catch (error) {
            failed.push({ title, error: error?.message || "Unknown error" });
        }

        if (i < orderedTitles.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 650));
        }
    }

    if (orderedTitles.length && failed.length) {
        console.warn(`Wikisource chapter fetch: ${orderedTitles.length} discovered, ${chapters.length} fetched, ${failed.length} failed.`, failed);
    }

    if (!chapters.length) {
        return { mainPage, chapters: parseGenericText(mainPage.text), discoveredCount: chapterTitles.length, refinedCount: orderedTitles.length, failed };
    }

    return { mainPage, chapters, discoveredCount: chapterTitles.length, refinedCount: orderedTitles.length, failed };
}

async function fetchWikisourceSource(sourceUrl, info) {
    // Reject category and index pages early. They are discovery/scan pages,
    // not individual literary works and should never be imported as a book.
    try {
        const infoData = await wikisourceApi(info.apiUrl, {
            action: "query",
            prop: "info",
            titles: info.title
        });
        const pages = infoData.query?.pages || {};
        const page = Array.isArray(pages) ? pages[0] : Object.values(pages)[0];
        const namespace = Number(page?.ns);
        if (namespace === 14) {
            throw new Error("This is a Wikisource category page, not a book. Open an individual book/work and paste that URL.");
        }
        if (namespace === 106) {
            throw new Error("This is a Wikisource scan/index page. Please use the individual work page when a clean text version is available.");
        }
    } catch (error) {
        if (/category page|scan\/index page/i.test(error.message || "")) throw error;
        console.warn("Wikisource namespace detection failed:", error.message);
    }

    const { mainPage, chapters, discoveredCount = chapters.length, refinedCount = chapters.length, failed = [] } = await fetchWikisourceChapters(info);

    const metadataText = mainPage.text;
    const title = mainPage.title || info.title;
    const author = extractWikisourceAuthor(metadataText);
    const publicationYear = extractWikisourcePublicationYear(metadataText);
    const description = metadataText
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 8)
        .join(" ")
        .slice(0, 700);

    return {
        sourceName: info.sourceName,
        sourceUrl,
        detectedFormat: "Wikisource",
        title,
        author,
        description: description || `Imported from ${info.sourceName}.`,
        coverImage: mainPage.coverImage,
        language: info.language,
        originalLanguage: info.language,
        publicationYear,
        category: "Classic",
        chapters,
        diagnostics: {
            discoveredChapters: discoveredCount,
            candidateChapters: refinedCount,
            fetchedChapters: chapters.length,
            failedChapters: failed
        }
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
        throw new Error("Only HTTP and HTTPS source URLs are supported.");
    }

    const wikisourceInfo = detectWikisourceInfo(sourceUrl);
    if (wikisourceInfo) {
        return fetchWikisourceSource(sourceUrl, wikisourceInfo);
    }

    const isGutenberg = /(?:^|\.)gutenberg\.org$/i.test(url.hostname) || /\.gutenberg\.org$/i.test(url.hostname);

    if (isGutenberg) {
        const id = detectGutenbergId(url.toString());
        if (id) {
            const textUrl = `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`;
            try {
                const response = await axios.get(textUrl, {
                    timeout: 20000,
                    responseType: "text",
                    maxContentLength: 15 * 1024 * 1024
                });
                const gutenbergText = String(response.data || "");
                const titleMatch = gutenbergText.match(/^Title:\s*(.+)$/mi);
                const authorMatch = gutenbergText.match(/^Author:\s*(.+)$/mi);
                let metadata = {
                    language: "English",
                    originalLanguage: "English",
                    publicationYear: null,
                    category: "Classic",
                    description: ""
                };

                try {
                    const pageResponse = await axios.get(`https://www.gutenberg.org/ebooks/${id}`, {
                        timeout: 20000,
                        responseType: "text",
                        maxContentLength: 8 * 1024 * 1024,
                        headers: {
                            "User-Agent": "MyLikith-Classics-Importer/1.0"
                        }
                    });
                    metadata = extractGutenbergMetadata(String(pageResponse.data || ""), gutenbergText);
                } catch (metadataError) {
                    console.warn("Gutenberg metadata fetch failed:", metadataError.message);
                }

                const chapters = parseGutenbergText(gutenbergText);
                return {
                    sourceName: "Project Gutenberg",
                    sourceUrl,
                    detectedFormat: "Project Gutenberg text",
                    title: titleMatch ? titleMatch[1].trim() : "",
                    author: authorMatch ? authorMatch[1].trim() : "",
                    description: metadata.description || "Imported from Project Gutenberg.",
                    coverImage: getGutenbergCoverUrl(id),
                    language: metadata.language,
                    originalLanguage: metadata.originalLanguage,
                    publicationYear: metadata.publicationYear,
                    category: metadata.category,
                    chapters
                };
            } catch (error) {
                console.error("Gutenberg text fetch error:", error.message);
            }
        }
    }

    const response = await axios.get(url.toString(), {
        timeout: 20000,
        responseType: "text",
        maxContentLength: 15 * 1024 * 1024,
        headers: {
            "User-Agent": "MyLikith-Classics-Importer/1.0"
        }
    });

    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    const raw = String(response.data || "");
    const isHtml = contentType.includes("text/html") || /<html[\s>]/i.test(raw);
    const meta = isHtml ? extractMetaFromHtml(raw) : {};
    const text = isHtml ? htmlToText(raw) : raw;

    return {
        sourceName: url.hostname.replace(/^www\./i, ""),
        sourceUrl,
        detectedFormat: isHtml ? "HTML" : "Plain text",
        title: meta.title || "",
        description: meta.description || `Imported from ${url.hostname}.`,
        coverImage: null,
        chapters: isHtml ? parseGenericText(text) : parseGenericText(raw)
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

        if (imported.diagnostics && imported.diagnostics.discoveredChapters > imported.diagnostics.fetchedChapters) {
            const failedCount = imported.diagnostics.discoveredChapters - imported.diagnostics.fetchedChapters;
            const failedTitles = (imported.diagnostics.failedChapters || []).slice(0, 5).map(item => item.title).join(", ");
            throw new Error(`Wikisource detected ${imported.diagnostics.discoveredChapters} chapters but only ${imported.diagnostics.fetchedChapters} could be fetched. ${failedCount} chapter(s) failed${failedTitles ? `: ${failedTitles}` : ""}. Import was stopped to prevent missing chapters.`);
        }

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
            diagnostics: imported.diagnostics || null,
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
