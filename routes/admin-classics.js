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

async function fetchWikisourcePage(apiUrl, title) {
    const data = await wikisourceApi(apiUrl, {
        action: "parse",
        page: title,
        prop: "text",
        redirects: 1
    });

    const html = data.parse?.text || "";
    const pageTitle = data.parse?.title || title;

    let coverImage = null;
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

    if (!coverImage) {
        coverImage = extractWikisourceCoverFromHtml(html);
    }

    return {
        title: pageTitle,
        html,
        text: cleanWikisourceHtml(html),
        coverImage
    };
}

function extractWikisourceSubpageTitlesFromHtml(html, info) {
    const source = String(html || "");
    const prefix = `${info.title}/`;
    const chapterTitles = [];
    const seen = new Set();
    const baseUrl = `https://${info.host}/wiki/${encodeURIComponent(info.title)}`;

    const add = value => {
        let title = String(value || "").trim().replace(/_/g, " ");
        if (!title) return;

        try {
            title = decodeURIComponent(title);
        } catch (_) {}

        title = title.replace(/_/g, " ").trim();
        if (!title.startsWith(prefix)) return;

        const suffix = title.slice(prefix.length).trim();
        if (!suffix || suffix.includes("/")) return;

        const key = title.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        chapterTitles.push(title);
    };

    const hrefRegex = /href=["']([^"']+)["']/gi;
    let match;

    while ((match = hrefRegex.exec(source)) !== null) {
        const href = String(match[1] || "").trim();
        if (!href || href.startsWith("#") || /^javascript:/i.test(href)) continue;

        try {
            const resolved = new URL(href, baseUrl);
            if (resolved.hostname !== info.host) continue;

            let title = "";
            if (resolved.pathname.startsWith("/wiki/")) {
                title = resolved.pathname.slice("/wiki/".length);
            } else if (resolved.pathname === "/w/index.php") {
                title = resolved.searchParams.get("title") || "";
            }

            if (title) add(title);
        } catch (_) {
            // Ignore malformed links.
        }
    }

    return chapterTitles;
}

async function fetchWikisourceChapters(info) {
    const mainPage = await fetchWikisourcePage(info.apiUrl, info.title);
    const prefix = `${info.title}/`;
    const chapterTitles = [];
    const seen = new Set();

    const addChapterTitle = value => {
        let title = String(value || "").replace(/_/g, " ").trim();
        try { title = decodeURIComponent(title); } catch (_) {}
        title = title.replace(/_/g, " ").trim();
        if (!title || !title.startsWith(prefix)) return;

        const suffix = title.slice(prefix.length).trim();
        if (!suffix || suffix.includes("/")) return;

        const key = title.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        chapterTitles.push(title);
    };

    // Primary: actual links in the rendered page, preserving the author's
    // intended chapter order. Resolve relative links as well as /wiki/ links.
    for (const title of extractWikisourceSubpageTitlesFromHtml(mainPage.html, info)) {
        addChapterTitle(title);
    }

    // Secondary: MediaWiki links API, with pagination.
    if (!chapterTitles.length) {
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
                for (const link of (page.links || [])) addChapterTitle(link.title);
            }
            plcontinue = linksData.continue?.plcontinue || null;
        } while (plcontinue);
    }

    // Tertiary: enumerate the subpage namespace by prefix. This is a robust
    // fallback for Wikisource templates whose links are not exposed normally.
    if (!chapterTitles.length) {
        let gapcontinue = null;
        do {
            const params = {
                action: "query",
                generator: "allpages",
                gapnamespace: 0,
                gapprefix: prefix,
                gaplimit: "max"
            };
            if (gapcontinue) params.gapcontinue = gapcontinue;

            const pagesData = await wikisourceApi(info.apiUrl, params);
            const pages = pagesData.query?.pages || {};
            const pageList = Array.isArray(pages) ? pages : Object.values(pages);
            for (const page of pageList) addChapterTitle(page.title);
            gapcontinue = pagesData.continue?.gapcontinue || null;
        } while (gapcontinue);
    }

    const chapters = [];
    for (const title of chapterTitles) {
        try {
            const page = await fetchWikisourcePage(info.apiUrl, title);
            if (!page.text || page.text.length < 20) continue;

            chapters.push({
                title: normalizeWikisourceChapterTitle(info.title, page.title),
                content: page.text
            });
        } catch (error) {
            console.warn(`Wikisource chapter fetch failed for ${title}:`, error.message);
        }
    }

    if (!chapters.length) {
        return {
            mainPage,
            chapters: parseGenericText(mainPage.text)
        };
    }

    return { mainPage, chapters };
}

async function fetchWikisourceSource(sourceUrl, info) {
    const { mainPage, chapters } = await fetchWikisourceChapters(info);

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