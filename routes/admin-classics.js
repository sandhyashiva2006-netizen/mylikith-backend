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

function getImportedChapterNumber(title) {
    const value = String(title || "")
        .replace(/[०-९]/g, d => String("०१२३४५६७८९".indexOf(d)))
        .replace(/[০-৯]/g, d => String("০১২৩৪৫৬৭৮৯".indexOf(d)))
        .replace(/[౦-౯]/g, d => String("౦౧౨౩౪౫౬౭౮౯".indexOf(d)))
        .trim()
        .toLowerCase();

    // Arabic / Indic digits
    const digitMatch = value.match(
        /(?:chapter|part|book|section|volume|అధ్యాయం|భాగం|కాండం|পরিচ্ছেদ|অধ্যায়|अध्याय|भाग|खंड|खंड)\s*[-.:]?\s*(\d+)/
    );

    if (digitMatch) {
        return Number(digitMatch[1]);
    }

    // Roman numerals
    const romanMatch = value.match(
        /(?:chapter|part|book|section|volume)\s*[-.:]?\s*([ivxlcdm]+)\b/i
    );

    if (romanMatch) {
        const roman = romanMatch[1].toUpperCase();

        const romanValues = {
            I: 1,
            V: 5,
            X: 10,
            L: 50,
            C: 100,
            D: 500,
            M: 1000
        };

        let total = 0;
        let previous = 0;

        for (let i = roman.length - 1; i >= 0; i--) {
            const current = romanValues[roman[i]] || 0;

            if (current < previous) {
                total -= current;
            } else {
                total += current;
            }

            previous = current;
        }

        if (total > 0) {
            return total;
        }
    }

    /*
     * Bengali
     */
    const bengaliNumbers = {
        "প্রথম": 1,
        "দ্বিতীয়": 2,
        "দ্বিতীয়": 2,
        "তৃতীয়": 3,
        "তৃতীয়": 3,
        "চতুর্থ": 4,
        "পঞ্চম": 5,
        "ষষ্ঠ": 6,
        "সপ্তম": 7,
        "অষ্টম": 8,
        "নবম": 9,
        "দশম": 10,
        "একাদশ": 11,
        "দ্বাদশ": 12,
        "ত্রয়োদশ": 13,
        "ত্রয়োদশ": 13,
        "চতুর্দশ": 14,
        "পঞ্চদশ": 15,
        "ষোড়শ": 16,
        "ষোড়শ": 16,
        "সপ্তদশ": 17,
        "অষ্টাদশ": 18,
        "ঊনবিংশ": 19,
        "উনবিংশ": 19,
        "বিংশ": 20
    };

    /*
     * Hindi
     */
    const hindiNumbers = {
        "प्रथम": 1,
        "पहला": 1,
        "पहली": 1,
        "द्वितीय": 2,
        "दूसरा": 2,
        "दूसरी": 2,
        "तृतीय": 3,
        "तीसरा": 3,
        "तीसरी": 3,
        "चतुर्थ": 4,
        "चौथा": 4,
        "चौथी": 4,
        "पंचम": 5,
        "पाँचवाँ": 5,
        "पांचवां": 5,
        "षष्ठ": 6,
        "छठा": 6,
        "छठी": 6,
        "सप्तम": 7,
        "सातवाँ": 7,
        "सातवां": 7,
        "अष्टम": 8,
        "आठवाँ": 8,
        "आठवां": 8,
        "नवम": 9,
        "नौवाँ": 9,
        "नौवां": 9,
        "दशम": 10,
        "दसवाँ": 10,
        "दसवां": 10,
        "एकादश": 11,
        "ग्यारहवाँ": 11,
        "द्वादश": 12,
        "बारहवाँ": 12,
        "त्रयोदश": 13,
        "तेरहवाँ": 13,
        "चतुर्दश": 14,
        "चौदहवाँ": 14,
        "पञ्चदश": 15,
        "पंचदश": 15,
        "पंद्रहवाँ": 15,
        "षोडश": 16,
        "सोलहवाँ": 16,
        "सप्तदश": 17,
        "सत्रहवाँ": 17,
        "अष्टादश": 18,
        "अठारहवाँ": 18,
        "एकोनविंश": 19,
        "उन्नीसवाँ": 19,
        "विंश": 20,
        "बीसवाँ": 20
    };

    /*
     * Telugu
     */
    const teluguNumbers = {
        "మొదటి": 1,
        "ప్రథమ": 1,
        "రెండవ": 2,
        "రెండవది": 2,
        "ద్వితీయ": 2,
        "మూడవ": 3,
        "తృతీయ": 3,
        "నాల్గవ": 4,
        "నాలుగవ": 4,
        "చతుర్థ": 4,
        "ఐదవ": 5,
        "పంచమ": 5,
        "ఆరవ": 6,
        "షష్ఠ": 6,
        "ఏడవ": 7,
        "సప్తమ": 7,
        "ఎనిమిదవ": 8,
        "అష్టమ": 8,
        "తొమ్మిదవ": 9,
        "నవమ": 9,
        "పదవ": 10,
        "దశమ": 10,
        "పదకొండవ": 11,
        "ఏకాదశ": 11,
        "పన్నెండవ": 12,
        "ద్వాదశ": 12,
        "పదమూడవ": 13,
        "త్రయోదశ": 13,
        "పద్నాలుగవ": 14,
        "చతుర్దశ": 14,
        "పదిహేనవ": 15,
        "పంచదశ": 15,
        "పదహారవ": 16,
        "షోడశ": 16,
        "పదిహేడవ": 17,
        "సప్తదశ": 17,
        "పద్దెనిమిదవ": 18,
        "అష్టాదశ": 18,
        "పంతొమ్మిదవ": 19,
        "ఏకోనవింశతి": 19,
        "ఇరవయ్యవ": 20,
        "వింశతి": 20
    };

    const numberWords = {
        ...bengaliNumbers,
        ...hindiNumbers,
        ...teluguNumbers
    };

    const matchingWords = Object.keys(numberWords)
        .sort((a, b) => b.length - a.length);

    for (const word of matchingWords) {
        if (value.includes(word.toLowerCase())) {
            return numberWords[word];
        }
    }

    return null;
}


function sortImportedChapters(chapters) {
    return (Array.isArray(chapters) ? chapters : [])
        .map((chapter, index) => ({
            ...chapter,
            __originalIndex: index,
            __chapterNumber: getImportedChapterNumber(chapter.title)
        }))
        .sort((a, b) => {

            const aNumber = a.__chapterNumber;
            const bNumber = b.__chapterNumber;

            /*
             * Keep introductions/prefaces before numbered chapters.
             */
            if (aNumber === null && bNumber !== null) {
                const aTitle = String(a.title || "").toLowerCase();

                if (
                    /^(introduction|preface|foreword|prologue|ప్రస్తావన|ముఖవాక్యం|परिचय|भूमिका)/i.test(aTitle)
                ) {
                    return -1;
                }

                return 1;
            }

            if (aNumber !== null && bNumber === null) {
                const bTitle = String(b.title || "").toLowerCase();

                if (
                    /^(introduction|preface|foreword|prologue|ప్రస్తావన|ముఖవాక్యం|परिचय|भूमिका)/i.test(bTitle)
                ) {
                    return 1;
                }

                return -1;
            }

            if (aNumber !== null && bNumber !== null) {
                return aNumber - bNumber;
            }

            return a.__originalIndex - b.__originalIndex;
        })
        .map(({ __originalIndex, __chapterNumber, ...chapter }) => chapter);
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

    const importedNumber = getImportedChapterNumber(value);

    if (Number.isFinite(importedNumber)) {
        return importedNumber;
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

function isBadWikisourceAuthorValue(value) {
    const v = String(value || "").replace(/\s+/g, " ").trim();
    if (!v) return true;
    if (v.length > 160) return true;
    return /^(?:public\s+domain|public domain public domain|false(?:\s+false)?|true(?:\s+true)?|image|license|लाइसेंस|सार्वजनिक\s+डोमेन|सार्वजनिक डोमेन सार्वजनिक डोमेन|पब्लिक\s+डोमेन)$/iu.test(v)
        || /^(?:public\s+domain\s+public\s+domain)\b/iu.test(v);
}

function isBadWikisourceCoverUrl(url) {
    const v = String(url || "").toLowerCase();
    if (!v) return true;
    return /pd[-_]?icon|public[_-]?domain|commons-logo|wikimedia-button|edit-clear|no[_-]?image|placeholder|wikimedia-logo/.test(v);
}

function sanitizeWikisourceAuthor(value) {
    const v = decodeWikisourceTitle(String(value || "")).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    return isBadWikisourceAuthorValue(v) ? "" : v;
}

async function getWikisourcePageImageTitles(apiUrl, pageTitle) {
    const titles = [];
    let imcontinue = null;

    try {
        do {
            const params = {
                action: "query",
                prop: "images",
                titles: pageTitle,
                imlimit: "max"
            };
            if (imcontinue) params.imcontinue = imcontinue;

            const data = await wikisourceApi(apiUrl, params);
            const pages = data.query?.pages || {};
            const page = Array.isArray(pages) ? pages[0] : Object.values(pages)[0];
            for (const image of (page?.images || [])) {
                if (image?.title) titles.push(decodeWikisourceTitle(image.title));
            }
            imcontinue = data.continue?.imcontinue || null;
        } while (imcontinue);
    } catch (error) {
        console.warn(`Wikisource image-list detection failed for ${pageTitle}:`, error.message);
    }

    return [...new Set(titles)];
}

function normalizeWikisourceFileStem(value) {
    return decodeWikisourceTitle(value)
        .replace(/^File\\s*:\\s*/i, "")
        .replace(/\\.(?:pdf|djvu|jpg|jpeg|png|webp|tif|tiff)$/i, "")
        .replace(/[\\s_\\-–—]+/gu, "")
        .replace(/[^\\p{L}\\p{N}]/gu, "")
        .toLowerCase();
}

function isBadWikisourceImageTitle(value) {
    const v = decodeWikisourceTitle(value).toLowerCase();
    if (!v) return true;
    return /pd[-_]?icon|public[_-]?domain|commons-logo|wikimedia-button|edit-clear|no[_-]?image|placeholder|wikimedia-logo|cc-by|creative commons/.test(v);
}

function extractAuthorFromWikisourceImageInfo(imageInfo) {
    const meta = imageInfo?.extmetadata || {};
    const candidates = [
        meta.Artist?.value,
        meta.Author?.value,
        meta.Creator?.value
    ];

    for (const value of candidates) {
        const candidate = sanitizeWikisourceAuthor(String(value || "")
            .replace(/<br\s*\/?>(?=\S)/gi, " ")
            .replace(/<[^>]+>/g, " "));
        if (candidate) return candidate;
    }
    return "";
}

async function getWikisourceProofreadNamespaces(apiUrl) {
    try {
        const data = await wikisourceApi(apiUrl, {
            action: "query",
            meta: "siteinfo",
            siprop: "namespaces|namespacealiases"
        });

        const namespaces = data.query?.namespaces || {};
        const aliases = data.query?.namespacealiases || [];

        const findNamespace = canonical => {
            const ns = Object.values(namespaces).find(item =>
                String(item?.canonical || "").toLowerCase() === canonical.toLowerCase()
            );

            if (ns) {
                return ns['*'] || ns.canonical || canonical;
            }

            const alias = aliases.find(item =>
                String(item?.alias || "").toLowerCase() === canonical.toLowerCase()
            );

            return alias?.alias || canonical;
        };

        return {
            page: findNamespace("Page"),
            index: findNamespace("Index")
        };
    } catch (error) {
        console.warn(
            "Wikisource ProofreadPage namespace detection failed:",
            error.message
        );

        return {
            page: "Page",
            index: "Index"
        };
    }
}

async function resolveWikisourceIndexCoverPage(apiUrl, fileTitle) {
    try {
        const cleanFile = String(fileTitle || "")
            .replace(/^(?:File|Image|चित्र|फाइल)\s*:/iu, "")
            .trim();

        if (!cleanFile) return null;

        const namespaces =
    await getWikisourceProofreadNamespaces(apiUrl);

const namespacePrefixes = [
    namespaces.page,
    "Page"
];

        const indexTitle = `${namespaces.index}:${cleanFile}`;

        const data = await wikisourceApi(apiUrl, {
            action: "parse",
            page: indexTitle,
            prop: "wikitext",
            contentformat: "application/json",
            redirects: 1
        });

        const raw = String(data.parse?.wikitext || "").trim();

        if (!raw) return null;

        let fields;

        try {
            const parsed = JSON.parse(raw);
            fields = parsed?.fields || null;
        } catch {
            return null;
        }

        if (!fields) return null;

        const imageField = String(
            fields.Image ??
            fields.image ??
            ""
        ).trim();

        if (!imageField) return null;

        /*
         * Image can be:
         *
         * 1. A filename:
         *    File:cover.jpg
         *
         * 2. A full image specification
         *
         * 3. A physical page number in a PDF/DjVu.
         */

        if (!/^\d+$/u.test(imageField)) {

            const fileName = imageField
                .replace(
                    /^\[\[\s*(?:File|Image|चित्र|फाइल)\s*:/iu,
                    ""
                )
                .replace(/\]\].*$/u, "")
                .trim();

            if (!fileName) return null;

            const imageTitle =
                /^(?:File|Image|चित्र|फाइल)\s*:/iu.test(imageField)
                    ? imageField
                    : `File:${fileName}`;

            try {

                const info = await wikisourceApi(
                    apiUrl,
                    {
                        action: "query",
                        prop: "imageinfo",
                        titles: imageTitle,
                        iiprop: "url|mime",
                        iiurlwidth: 1400
                    }
                );

                const pages =
                    info.query?.pages || {};

                const page =
                    Array.isArray(pages)
                        ? pages[0]
                        : Object.values(pages)[0];

                const ii =
                    page?.imageinfo?.[0];

                const candidate =
                    ii?.thumburl ||
                    ii?.url ||
                    null;

                if (
                    candidate &&
                    !isBadWikisourceCoverUrl(candidate)
                ) {
                    return candidate;
                }

            } catch (error) {
                console.warn(
                    `Wikisource Index image lookup failed for ${imageTitle}:`,
                    error.message
                );
            }

            return null;
        }

        /*
         * Numeric Image field.
         *
         * ProofreadPage defines Image as the page number
         * to use for the Index cover. This is an official
         * ProofreadPage feature.
         */

        const pageNumber = Number(imageField);

        if (!Number.isFinite(pageNumber)) {
            return null;
        }

        const pageTitle =
            `${namespaces.page}:${cleanFile}/${pageNumber}`;

        try {

            const imageData = await wikisourceApi(
                apiUrl,
                {
                    action: "query",
                    prop: "imageforpage",
                    titles: pageTitle
                }
            );

            const pages =
                imageData.query?.pages || {};

            const page =
                Array.isArray(pages)
                    ? pages[0]
                    : Object.values(pages)[0];

            const image =
                page?.imageforpage?.thumbnail ||
                page?.imageforpage?.source ||
                null;

            if (
                image &&
                !isBadWikisourceCoverUrl(image)
            ) {
                return image.startsWith("//")
                    ? `https:${image}`
                    : image;
            }

        } catch (error) {

            console.warn(
                `Wikisource imageforpage failed for ${pageTitle}:`,
                error.message
            );

        }

        /*
         * Fallback: use pageimages on the actual Page:
         * page, not the Index page.
         */

        try {

            const pageData = await wikisourceApi(
                apiUrl,
                {
                    action: "query",
                    prop: "pageimages",
                    piprop: "thumbnail|original",
                    pithumbsize: 1400,
                    titles: pageTitle
                }
            );

            const pages =
                pageData.query?.pages || {};

            const page =
                Array.isArray(pages)
                    ? pages[0]
                    : Object.values(pages)[0];

            const image =
                page?.original?.source ||
                page?.thumbnail?.source ||
                null;

            if (
                image &&
                !isBadWikisourceCoverUrl(image)
            ) {
                return image;
            }

        } catch (error) {

            console.warn(
                `Wikisource PageImages cover fallback failed for ${pageTitle}:`,
                error.message
            );

        }

    } catch (error) {

        console.warn(
            `Wikisource Index cover resolution failed for ${fileTitle}:`,
            error.message
        );

    }

    return null;
}

async function resolveWikisourceNamedCoverPage(apiUrl, fileTitle) {
    // Wikisource proofread books may expose a dedicated cover page in the
    // Index/TOC, while the PDF's own thumbnail is only a library scan sheet.
    // Prefer that explicit cover page. This is intentionally independent of
    // pageimages on the work page, which may return unrelated images.
    try {
        const cleanFile = String(fileTitle || "")
            .replace(/^(?:File|Image|चित्र|फाइल)\s*:/iu, "")
            .trim();
        if (!cleanFile) return null;

        const baseName = cleanFile.replace(/\.(?:pdf|djvu)$/iu, "");
       const namespaces = await getWikisourceProofreadNamespaces(apiUrl);
       const coverSuffixes = [
            "आवरण-पृष्ठ", "आवरण पृष्ठ", "मुखपृष्ठ", "मुख पृष्ठ",
            "cover", "cover page", "front cover", "frontispiece",
            "title page", "title-page"
        ];
        const namespacePrefixes = [
    namespaces.page,
    "Page",
    "പേജ്",
    "पृष्ठ"
].filter(Boolean);
        const directCandidates = [];

        for (const ns of namespacePrefixes) {
            for (const suffix of coverSuffixes) {
                directCandidates.push(`${ns}:${cleanFile}/${suffix}`);
                directCandidates.push(`${ns}:${baseName}/${suffix}`);
            }
        }

        // Also inspect the book's Index/TOC. The Hindi Go-daan index, for
        // example, explicitly contains an "आवरण-पृष्ठ" entry.
        const tocCandidates = [
    `${namespaces.index}:${cleanFile}`,
    `${namespaces.index}:${baseName}`,
    `Index:${cleanFile}`,
    `Index:${baseName}`,
    `अनुक्रमणिका:${cleanFile}`,
    `विषयसूची:${cleanFile}`,
    `விஷயசூசி:${cleanFile}`,
    `ഉള്ളടക്കം:${cleanFile}`
].filter(Boolean);

        async function getPageImage(title) {
            const variants = [title, title.replace(/^पृष्ठ:/u, "Page:")];
            for (const candidateTitle of [...new Set(variants)]) {
                try {
                    const data = await wikisourceApi(apiUrl, {
                        action: "query",
                        prop: "pageimages",
                        piprop: "thumbnail|original",
                        pithumbsize: 1400,
                        redirects: 1,
                        titles: candidateTitle
                    });
                    const pages = data.query?.pages || {};
                    const page = Array.isArray(pages) ? pages[0] : Object.values(pages)[0];
                    const image = page?.original?.source || page?.thumbnail?.source || null;
                    if (image && !isBadWikisourceCoverUrl(image)) return image;
                } catch (error) {
                    console.warn(`Wikisource cover pageimages failed for ${candidateTitle}:`, error.message);
                }

                // Some Proofread Page pages do not expose pageimages. Parse the
                // rendered page and take the actual scan image instead.
                try {
                    const data = await wikisourceApi(apiUrl, {
                        action: "parse",
                        page: candidateTitle,
                        prop: "text",
                        redirects: 1
                    });
                    const html = String(data.parse?.text || "");
                    const image = extractWikisourceCoverFromHtml(html);
                    if (image) return image;
                } catch (error) {
                    // Candidate page may simply not exist; continue.
                }
            }
            return null;
        }

        // 1. Directly try the canonical cover-page names.
        for (const title of directCandidates) {
            const image = await getPageImage(title);
            if (image) return image;
        }

        // 2. Read the Index/TOC and discover the exact page title linked as
        // "Cover", "आवरण-पृष्ठ", etc. This handles books whose cover page name
        // is not predictable from the filename.
        for (const tocTitle of [...new Set(tocCandidates)]) {
            try {
                const data = await wikisourceApi(apiUrl, {
                    action: "parse",
                    page: tocTitle,
                    prop: "wikitext|links",
                    redirects: 1
                });
                const wikitext = String(data.parse?.wikitext || "");
                const linked = [];
                const seen = new Set();
                const linkRegex = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/gu;
                let match;
                while ((match = linkRegex.exec(wikitext)) !== null) {
                    const target = decodeWikisourceTitle(match[1] || "").trim();
                    const label = decodeWikisourceTitle(match[2] || "").trim();
                    if (!target) continue;
                    const combined = `${target} ${label}`.toLowerCase();
                    if (!/(आवरण|मुखपृष्ठ|cover|front cover|frontispiece|title page|title-page)/iu.test(combined)) continue;
                    if (!/(?:^|:)(?:page|पृष्ठ):/iu.test(target) && !target.includes(`${baseName}/`)) continue;
                    const key = target.toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    linked.push(target);
                }

                for (const target of linked) {
                    const image = await getPageImage(target);
                    if (image) return image;
                }
            } catch (error) {
                console.warn(`Wikisource TOC cover discovery failed for ${tocTitle}:`, error.message);
            }
        }
    } catch (error) {
        console.warn(`Wikisource named cover-page discovery failed for ${fileTitle}:`, error.message);
    }
    return null;
}

async function fetchWikisourceFilePagePreview(apiUrl, fileTitle) {
    try {
        const host = new URL(apiUrl).hostname;
        const title = String(fileTitle || "").replace(/^File\s*:/i, "").replace(/^चित्र\s*:/iu, "").trim();
        if (!title) return null;

        const filePageUrl = `https://${host}/wiki/${encodeURIComponent(`चित्र:${title}`)}`;
        const response = await axios.get(filePageUrl, {
            timeout: 30000,
            responseType: "text",
            maxContentLength: 10 * 1024 * 1024,
            headers: { "User-Agent": "MyLikith-Classics-Importer/1.0" }
        });
        const html = String(response.data || "");

        // For PDF-backed Wikisource files the browser page contains a real
        // first-page thumbnail even though the underlying file MIME is PDF.
        // Prefer that thumbnail over the raw PDF URL because MyLikith cover
        // fields are rendered as <img>.
        const candidates = [];
        const imgRegex = /<img\b[^>]*?(?:src|data-src)=["']([^"']+)["'][^>]*>/giu;
        let match;
        while ((match = imgRegex.exec(html)) !== null) {
            let src = String(match[1] || "").trim();
            if (src.startsWith("//")) src = `https:${src}`;
            else if (src.startsWith("/")) src = `https://${host}${src}`;
            if (!/^https?:\/\/upload\.wikimedia\.org\//i.test(src)) continue;
            if (isBadWikisourceCoverUrl(src)) continue;
            const lower = src.toLowerCase();
            if (/\/thumb\//.test(lower) && /(?:\.pdf|page1-|\.jpg|\.jpeg|\.png|\.webp)/.test(lower)) {
                candidates.push(src);
            }
        }

        // Some skins expose the preview as a linked image rather than an img
        // src. Accept the same Wikimedia thumbnail pattern from hrefs.
        const hrefRegex = /href=["']([^"']+)["']/giu;
        while ((match = hrefRegex.exec(html)) !== null) {
            let href = String(match[1] || "").trim();
            if (href.startsWith("//")) href = `https:${href}`;
            if (!/^https?:\/\/upload\.wikimedia\.org\//i.test(href)) continue;
            if (isBadWikisourceCoverUrl(href)) continue;
            const lower = href.toLowerCase();
            if (/\/thumb\//.test(lower) && /(?:\.pdf|page1-|\.jpg|\.jpeg|\.png|\.webp)/.test(lower)) {
                candidates.push(href);
            }
        }

        return candidates[0] || null;
    } catch (error) {
        console.warn(`Wikisource file-page preview detection failed for ${fileTitle}:`, error.message);
        return null;
    }
}

async function inspectFileForWikisourceCover(apiUrl, fileTitle) {
    try {
        const data = await wikisourceApi(apiUrl, {
            action: "query",
            prop: "imageinfo",
            titles: fileTitle,
            iiprop: "url|mime|extmetadata",
            iiextmetadatafilter:
                "ImageDescription|ObjectName|Categories",
            iiurlwidth: 1400
        });

        const pages = data.query?.pages || {};

        const page = Array.isArray(pages)
            ? pages[0]
            : Object.values(pages)[0];

        const info = page?.imageinfo?.[0];

        if (!info) return null;

        const mime =
            String(info.mime || "").toLowerCase();

        if (!mime.startsWith("image/")) {
            return null;
        }

        const meta =
            info.extmetadata || {};

        const description =
            String(
                meta.ImageDescription?.value || ""
            )
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();

        const objectName =
            String(
                meta.ObjectName?.value || ""
            )
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();

        const searchable =
            `${fileTitle} ${description} ${objectName}`;

        if (
            /title\s*page|title-page|front\s*cover|
             book\s*cover|cover\s*page|frontispiece|
             ശീർഷക\s*താൾ|ശീർഷക\s*പേജ്|മുഖപ്പുറം|
             मुखपृष्ठ|शीर्षक\s*पृष्ठ|आवरण|
             தலைப்பு\s*பக்கம்|முகப்பு|
             ముఖచిత్రం|శీర్షిక\s*పేజీ|
             പ്രഥമ\s*പതിപ്പ്|ആദ്യ\s*പതിപ്പ്/iu
                .test(searchable)
        ) {
            return (
                info.thumburl ||
                info.url ||
                null
            );
        }

        return null;

    } catch (error) {
        console.warn(
            `Wikisource cover file inspection failed for ${fileTitle}:`,
            error.message
        );

        return null;
    }
}

async function resolveWikisourceCoverAndAuthorFromPageImages(apiUrl, pageTitle) {
    let coverImage = null;
    let author = "";

    const checked = new Set();

    /*
     * Wikimedia/Wikisource can use a completely different filename from the
     * actual Wikisource work title.
     *
     * Example:
     *
     *   Work:  മാർത്താണ്ഡവർമ്മ
     *   File:  MARTANDA VARMA 1891.jpeg
     *
     * Therefore filename similarity must NEVER be the primary requirement.
     */

    async function inspectImageFile(fileTitle) {
        const cleanTitle = decodeWikisourceTitle(fileTitle);

        if (!cleanTitle) return null;

        const key = cleanTitle.toLowerCase();

        if (checked.has(key)) return null;

        checked.add(key);

        try {
            const normalizedFileTitle =
                /^(?:file|image|चित्र|फाइल|പ്രമാണം)\s*:/iu.test(cleanTitle)
                    ? cleanTitle
                    : `File:${cleanTitle}`;

            const data = await wikisourceApi(apiUrl, {
                action: "query",
                prop: "imageinfo",
                titles: normalizedFileTitle,
                iiprop: "url|mime|size|extmetadata",
                iiextmetadatafilter:
                    "Artist|Author|Creator|ImageDescription|DateTimeOriginal|ObjectName|Categories",
                iiurlwidth: 1400
            });

            const pages = data.query?.pages || {};

            const page = Array.isArray(pages)
                ? pages[0]
                : Object.values(pages)[0];

            const info = page?.imageinfo?.[0];

            if (!info) return null;

            const mime = String(info.mime || "").toLowerCase();

            if (!mime.startsWith("image/")) {
                return null;
            }

            const meta = info.extmetadata || {};

            const description = String(
                meta.ImageDescription?.value || ""
            )
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();

            const objectName = String(
                meta.ObjectName?.value || ""
            )
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();

            const categories = String(
                meta.Categories?.value || ""
            )
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();

            const searchable = [
                cleanTitle,
                description,
                objectName,
                categories
            ].join(" ");

            const lower = searchable.toLowerCase();

            let score = 0;

            /*
             * VERY strong evidence.
             *
             * This is the important part for:
             *
             * MARTANDA VARMA 1891.jpeg
             */
            if (
                /\btitle\s*page\b/i.test(lower) ||
                /\btitle-page\b/i.test(lower)
            ) {
                score += 1000;
            }

            if (
                /\bfront\s*cover\b/i.test(lower) ||
                /\bbook\s*cover\b/i.test(lower) ||
                /\bcover\s*page\b/i.test(lower) ||
                /\bfrontispiece\b/i.test(lower)
            ) {
                score += 1000;
            }

            /*
             * Localized title-page / cover terminology.
             */
            if (
                /ശീർഷക\s*താൾ|ശീർഷക\s*പേജ്|മുഖപ്പുറം|മുഖചിത്രം|ആദ്യ\s*പതിപ്പ്/iu
                    .test(searchable)
            ) {
                score += 1000;
            }

            if (
                /मुखपृष्ठ|शीर्षक\s*पृष्ठ|आवरण|प्रथम\s*संस्करण/iu
                    .test(searchable)
            ) {
                score += 1000;
            }

            if (
                /தலைப்பு\s*பக்கம்|முகப்பு|முதல்\s*பதிப்பு/iu
                    .test(searchable)
            ) {
                score += 1000;
            }

            if (
                /ముఖచిత్రం|శీర్షిక\s*పేజీ|మొదటి\s*ముద్రణ/iu
                    .test(searchable)
            ) {
                score += 1000;
            }

            if (
                /প্রচ্ছদ|শিরোনাম\s*পৃষ্ঠা|প্রথম\s*সংস্করণ/iu
                    .test(searchable)
            ) {
                score += 1000;
            }

            /*
             * First-edition evidence.
             */
            if (
                /\bfirst\s+edition\b/i.test(lower) ||
                /\bfirst\s+published\b/i.test(lower)
            ) {
                score += 250;
            }

            /*
             * Filename/title relationship is only secondary evidence.
             */
            const pageStem =
                normalizeWikisourceFileStem(pageTitle);

            const imageStem =
                normalizeWikisourceFileStem(cleanTitle);

            if (pageStem && imageStem === pageStem) {
                score += 150;
            } else if (
                pageStem &&
                (
                    imageStem.includes(pageStem) ||
                    pageStem.includes(imageStem)
                )
            ) {
                score += 80;
            }

            /*
             * Portrait orientation is useful supporting evidence.
             */
            const width = Number(info.width || 0);
            const height = Number(info.height || 0);

            if (
                width > 0 &&
                height > 0 &&
                height > width * 1.15
            ) {
                score += 30;
            }

            /*
             * Reject obvious Wikimedia UI assets.
             */
            if (isBadWikisourceImageTitle(cleanTitle)) {
                score -= 2000;
            }

            if (
    /pd[-_]?icon|public[_-]?domain|commons-logo|wikimedia-logo|edit-clear|no[_-]?image|placeholder/iu
        .test(searchable)
) {
    score -= 2000;
}

            const candidateUrl =
                info.thumburl ||
                info.url ||
                null;

            if (!candidateUrl) return null;

            return {
                title: cleanTitle,
                url: candidateUrl,
                score,
                description
            };

        } catch (error) {
            console.warn(
                `Wikisource image inspection failed for ${cleanTitle}:`,
                error.message
            );

            return null;
        }
    }

    /*
     * ============================================================
     * 1. FIRST PRIORITY:
     *    Images explicitly embedded on the actual work page.
     * ============================================================
     *
     * This is the critical path.
     */
    const imageTitles =
        await getWikisourcePageImageTitles(
            apiUrl,
            pageTitle
        );

    const candidates = [];

    for (const imageTitle of imageTitles) {
        const candidate =
            await inspectImageFile(imageTitle);

        if (candidate) {
            candidates.push(candidate);
        }
    }

    /*
     * Pick the strongest semantic candidate.
     */
    candidates.sort(
        (a, b) => b.score - a.score
    );

    const strongest = candidates[0];

    if (
        strongest &&
        strongest.score >= 500
    ) {
        coverImage = strongest.url;

        console.log(
            `[Classics Cover] Selected Wikisource work-page image: ` +
            `${strongest.title} ` +
            `(score=${strongest.score})`
        );
    }

    /*
     * Get author only from the strongest relevant image metadata.
     */
    if (strongest) {
        try {
            const authorData =
                await wikisourceApi(apiUrl, {
                    action: "query",
                    prop: "imageinfo",
                    titles: strongest.title,
                    iiprop: "extmetadata",
                    iiextmetadatafilter:
                        "Artist|Author|Creator"
                });

            const pages =
                authorData.query?.pages || {};

            const page =
                Array.isArray(pages)
                    ? pages[0]
                    : Object.values(pages)[0];

            const info =
                page?.imageinfo?.[0];

            if (info) {
                author =
                    extractAuthorFromWikisourceImageInfo(info);
            }

        } catch (error) {
            console.warn(
                "Wikisource cover author metadata failed:",
                error.message
            );
        }
    }

    /*
     * ============================================================
     * 2. SECOND PRIORITY:
     *    Exact edition files.
     * ============================================================
     *
     * Only use this if the work page did not provide a strong cover.
     */
    if (!coverImage) {

        const titleVariants = [
            decodeWikisourceTitle(pageTitle),
            decodeWikisourceTitle(pageTitle)
                .replace(/[\s\-_–—]+/gu, ""),
            decodeWikisourceTitle(pageTitle)
                .replace(/[\s\-_–—]+/gu, " ")
                .trim()
        ];

        const exactFiles = [];

        for (const variant of [
            ...new Set(titleVariants)
        ]) {

            for (const ext of [
                "jpg",
                "jpeg",
                "png",
                "webp"
            ]) {

                exactFiles.push(
                    `File:${variant}.${ext}`
                );

                exactFiles.push(
                    `चित्र:${variant}.${ext}`
                );
            }
        }

        for (const fileTitle of exactFiles) {

            const candidate =
                await inspectImageFile(fileTitle);

            if (
                candidate &&
                candidate.score >= 500
            ) {

                coverImage =
                    candidate.url;

                console.log(
                    `[Classics Cover] Selected exact edition image: ` +
                    `${candidate.title} ` +
                    `(score=${candidate.score})`
                );

                break;
            }
        }
    }

    /*
     * ============================================================
     * 3. THIRD PRIORITY:
     *    Proofread Index / named cover page.
     * ============================================================
     */
    if (!coverImage) {

        const exactPdfCandidates = [];

        const variants = [
            decodeWikisourceTitle(pageTitle),
            decodeWikisourceTitle(pageTitle)
                .replace(/[\s\-_–—]+/gu, ""),
            decodeWikisourceTitle(pageTitle)
                .replace(/[\s\-_–—]+/gu, " ")
                .trim()
        ];

        for (const variant of [
            ...new Set(variants)
        ]) {

            exactPdfCandidates.push(
                `File:${variant}.pdf`
            );

            exactPdfCandidates.push(
                `File:${variant}.djvu`
            );

            exactPdfCandidates.push(
                `चित्र:${variant}.pdf`
            );

            exactPdfCandidates.push(
                `चित्र:${variant}.djvu`
            );
        }

        for (const fileTitle of exactPdfCandidates) {

            const candidate =
                await inspectFileForWikisourceCover(
                    apiUrl,
                    fileTitle
                );

            if (candidate) {
                coverImage = candidate;
                break;
            }
        }
    }

    return {
        coverImage,
        author
    };
}

function extractWikisourceAuthorFromWikitext(wikitext) {
    const source = String(wikitext || "");
    const fieldPatterns = [
        /(?:^|\n)\s*\|\s*(?:author|writer|poet|रचनाकार|लेखक|रचयिता|कवि|लेखक का नाम)\s*=\s*([^\n|]+)/iu,
        /(?:^|\n)\s*(?:author|writer|poet|रचनाकार|लेखक|रचयिता|कवि)\s*[:：]\s*([^\n|]+)/iu
    ];
    for (const re of fieldPatterns) {
        const m = source.match(re);
        if (m && m[1]) {
            const value = sanitizeWikisourceAuthor(m[1]);
            if (value) return value;
        }
    }
    return "";
}

function extractWikisourceAuthorHeuristic(text, title) {
    const lines = String(text || "")
        .split("\n")
        .map(line => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);
    const normalize = value => decodeWikisourceTitle(value)
        .replace(/[\s\-–—_:：.,'"“”‘’()\[\]{}]/g, "")
        .toLowerCase();
    const titleKey = normalize(title);
    if (!titleKey) return "";

    const titleIndexes = [];
    for (let i = 0; i < Math.min(lines.length, 120); i++) {
        if (normalize(lines[i]) === titleKey) titleIndexes.push(i);
    }

    // Many Wikisource work pages render a simple bibliographic block as:
    // title -> author -> publisher/edition. Use the second title occurrence
    // because the first occurrence is often the page heading.
    const start = titleIndexes.length >= 2 ? titleIndexes[1] + 1 : -1;
    if (start < 0) return "";

    const blocked = /^(?:लेखक|रचनाकार|कवि|प्रकाशक|मुद्रक|प्रथम संस्करण|वर्तमान संस्करण|प्रकाशन|प्रकाशित|मूल्य|दिनांक|स्रोत|Image|Public domain|सार्वजनिक डोमेन|©|वर्ष|author|writer|publisher|publication|copyright)$/iu;
    for (let i = start; i < Math.min(start + 6, lines.length); i++) {
        const value = lines[i];
        if (!value || blocked.test(value)) continue;
        if (/^(?:19|20)\d{2}$/u.test(value)) continue;
        if (value.length < 2 || value.length > 120) continue;
        if (normalize(value) === titleKey) continue;
        // Avoid obvious metadata sentences/URLs.
        if (/https?:\/\//i.test(value) || /(?:प्रथम संस्करण|वर्तमान संस्करण|रचना-काल|publication|copyright)/iu.test(value)) continue;
        const candidate = sanitizeWikisourceAuthor(value);
        if (candidate) return candidate;
    }
    return "";
}

function extractWikisourceAuthor(text) {
    const lines = String(text || "")
        .split("\n")
        .map(line => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);

    const patterns = [
        /^(?:author|written by|poet|writer)\s*[:\-]\s*(.+)$/i,
        /^(?:रचनाकार|लेखक|रचयिता|कवि)\s*[:\-]\s*(.+)$/u,
        /^(?:రచయిత|రచించినవారు|రచించిన వారు|కవి)\s*[:\-]?\s*(.+)$/iu,
        /^(?:रचनाकार|लेखक|रचयिता|कवि)\s+(.+)$/u,
        /^(?:రచయిత|రచించినవారు|రచించిన వారు|కవి)\s+(.+)$/iu
    ];

    for (let i = 0; i < Math.min(lines.length, 100); i++) {
        const line = lines[i];
        if (/^(?:author|written by|poet|writer|रचनाकार|लेखक|रचयिता|कवि|రచయిత|రచించినవారు|రచించిన వారు|కవి)$/iu.test(line)) {
            const next = lines[i + 1] || "";
            const candidate = sanitizeWikisourceAuthor(next);
            if (candidate && !/^(?:प्रथम संस्करण|वर्तमान संस्करण|publication|published|copyright|©)$/iu.test(candidate)) {
                return candidate;
            }
        }
        for (const pattern of patterns) {
            const match = line.match(pattern);
            if (!match || !match[1]) continue;
            const candidate = sanitizeWikisourceAuthor(match[1]);
            if (candidate) return candidate;
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

function extractWikisourceImageTitlesFromWikitext(wikitext) {
    const source = String(wikitext || "");
    const titles = [];
    const seen = new Set();
    const re = /\[\[(?:File|Image|चित्र|फाइल)\s*:\s*([^|\]\n]+)(?:\|[^\]]*)?\]\]/giu;
    let match;
    while ((match = re.exec(source)) !== null) {
        const name = decodeWikisourceTitle(match[1]).trim();
        if (!name) continue;
        const lower = name.toLowerCase();
        if (
            lower.includes("pd-icon") ||
            lower.includes("public_domain") ||
            lower.includes("commons-logo") ||
            lower.includes("wikimedia-button") ||
            lower.includes("edit-clear") ||
            lower.includes("no_image")
        ) continue;
        const key = lower;
        if (seen.has(key)) continue;
        seen.add(key);
        titles.push(name);
    }
    return titles;
}

async function resolveWikisourceImageFromWikitext(apiUrl, wikitext) {
    const imageTitles = extractWikisourceImageTitlesFromWikitext(wikitext);
    for (const imageName of imageTitles) {
        try {
            const title = /^(?:file|image|चित्र|फाइल)\s*:/iu.test(imageName)
                ? imageName
                : `File:${imageName}`;
            const data = await wikisourceApi(apiUrl, {
                action: "query",
                prop: "imageinfo",
                titles: title,
                iiprop: "url|mime|size",
                iiurlwidth: 1200
            });
            const pages = data.query?.pages || {};
            const page = Array.isArray(pages) ? pages[0] : Object.values(pages)[0];
            const info = page?.imageinfo?.[0];
            if (!info?.url) continue;
            const mime = String(info.mime || "").toLowerCase();
            // Prefer a real image/cover file, but allow PDF files because
            // Wikisource commonly stores the edition cover as a PDF scan.
            if (mime.startsWith("image/") || mime === "application/pdf") {
                return info.thumburl || info.url;
            }
        } catch (error) {
            console.warn(`Wikisource imageinfo detection failed for ${imageName}:`, error.message);
        }
    }
    return null;
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

        if (!isBadWikisourceCoverUrl(href)) candidates.push(href);
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

        if (!isBadWikisourceCoverUrl(src)) candidates.push(src);
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

async function resolveWikisourceCoverByTitle(info, pageTitle) {
    const raw = decodeWikisourceTitle(pageTitle).trim();
    if (!raw) return null;
    const variants = new Set();
    const compact = raw.replace(/[\s\-_–—]+/gu, "");
    const spaced = raw.replace(/[\s\-_–—]+/gu, " ").trim();
    const candidates = [
        `${raw}.pdf`, `${spaced}.pdf`, `${compact}.pdf`,
        `${raw}.jpg`, `${raw}.jpeg`, `${raw}.png`,
        `${spaced}.jpg`, `${spaced}.jpeg`, `${spaced}.png`,
        `${compact}.jpg`, `${compact}.jpeg`, `${compact}.png`
    ];
    for (const name of candidates) variants.add(`File:${name}`);
    for (const fileTitle of variants) {
        try {
            const data = await wikisourceApi(info.apiUrl, {
                action: "query",
                prop: "imageinfo",
                titles: fileTitle,
                iiprop: "url|mime|size",
                iiurlwidth: 1400
            });
            const pages = data.query?.pages || {};
            const page = Array.isArray(pages) ? pages[0] : Object.values(pages)[0];
            const ii = page?.imageinfo?.[0];
            const candidate = ii?.thumburl || ii?.url || null;
            if (!candidate || isBadWikisourceCoverUrl(candidate)) continue;
            const mime = String(ii?.mime || "").toLowerCase();
            if (mime.startsWith("image/") || mime === "application/pdf") return candidate;
        } catch (error) {
            // Candidate filenames are optional; keep trying the other variants.
        }
    }
    return null;
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
                const candidate = page?.original?.source || page?.thumbnail?.source || null;
                coverImage = isBadWikisourceCoverUrl(candidate) ? null : candidate;
            } catch (imageError) {
                console.warn(`Wikisource PageImages detection failed for ${pageTitle}:`, imageError.message);
            }
            if (!coverImage) coverImage = extractWikisourceCoverFromHtml(html);
            if (!coverImage) {
                coverImage = await resolveWikisourceImageFromWikitext(apiUrl, data.parse?.wikitext || "");
            }
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

function isPureWikisourceNumberSuffix(suffix) {
    const value = normalizeWikisourceNumeral(suffix).trim();
    return /^\d{1,3}[.)]?$/u.test(value);
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

function normalizeWikisourceNumeral(value) {
    const raw = decodeWikisourceTitle(value).trim();
    const devanagari = "०१२३४५६७८९";
    const telugu = "౦౧౨౩౪౫౬౭౮౯";
    let out = "";
    for (const ch of raw) {
        const d = devanagari.indexOf(ch);
        if (d >= 0) { out += String(d); continue; }
        const t = telugu.indexOf(ch);
        if (t >= 0) { out += String(t); continue; }
        out += ch;
    }
    return out;
}

function sortWikisourceChapterTitles(titles, info) {
    const ordinal = value => {
        const v = normalizeWikisourceNumeral(value).trim();
        const numeric = v.match(/(?:chapter|part|section|book|volume|act|canto|प्रकरण|अध्याय|भाग|खंड|खण्ड|अंक|प्रकरणము|ప్రకరణం|భాగము|భాగం)\s*[-.:#]?\s*(\d{1,3})/iu);
        if (numeric) return Number(numeric[1]);

        const bare = v.match(/^(\d{1,3})[.)]?$/u);
        if (bare) return Number(bare[1]);

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

        const hindi = v.match(/^([^\s]+)\s+(?:अध्याय|भाग|खंड|खण्ड|अंक)$/iu);
        if (hindi) return normalizeWikisourceOrdinalNumber(hindi[1]);

        const telugu = v.match(/^([^\s]+)\s+(?:ప్రకరణము|ప్రకరణం|భాగము|భాగం)$/iu);
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


async function extractWikisourcePrefixSubpageTitles(info) {
    const titles = [];
    const prefix = `${info.title}/`;
    let apcontinue = null;

    try {
        do {
            const params = {
                action: "query",
                list: "allpages",
                apprefix: prefix,
                apnamespace: 0,
                aplimit: "max"
            };
            if (apcontinue) params.apcontinue = apcontinue;

            const data = await wikisourceApi(info.apiUrl, params);
            for (const page of (data.query?.allpages || [])) {
                const title = decodeWikisourceTitle(page.title);
                if (!title.startsWith(prefix)) continue;
                const suffix = title.slice(prefix.length).trim();
                if (!suffix || suffix.includes("/")) continue;
                if (isWikisourceNonChapterSubpage(suffix)) continue;
                if (!isLikelyWikisourceChapterSuffix(suffix)) continue;
                titles.push(title);
            }
            apcontinue = data.continue?.apcontinue || null;
        } while (apcontinue);
    } catch (error) {
        console.warn("Wikisource allpages prefix discovery failed:", error.message);
    }
    return dedupeWikisourceChapterTitles(titles, info);
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

    // 3b. Some Wikisource books, especially Hindi/Devanagari editions, have
    // real numbered chapter subpages but no usable TOC links on the main page.
    // MediaWiki allpages with the work-title prefix is the reliable fallback.
    // It can discover children such as "गो-दान/१" ... "गो-दान/३६" while the
    // direct-subpage filter excludes scan pages such as "पृष्ठ:...".
    if (!tocTitles.length && chapterTitles.length <= 1) {
        const prefixTitles = await extractWikisourcePrefixSubpageTitles(info);
        const numericTitles = prefixTitles.filter(title => isPureWikisourceNumberSuffix(title.slice(`${info.title}/`.length)));
        // When the source uses a pure numbered-subpage family (for example
        // गो-दान/१ ... गो-दान/३६), only those numbered pages are chapters.
        // The category may also expose scan/helper pages, so never import the
        // entire prefix result blindly.
        const candidates = numericTitles.length >= 2 && numericTitles.length >= Math.ceil(prefixTitles.length * 0.75)
            ? numericTitles
            : prefixTitles;
        for (const title of candidates) add(title);
    }

    // The same Wikisource chapter can be discovered through the TOC, parsed
    // links, rendered HTML, the links API, and prefix discovery. Normalize
    // Unicode/whitespace before deciding whether two candidates are the same page.
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

    // Wikisource pages frequently render author information through templates
    // and file metadata rather than a simple visible "Author:" line. Prefer
    // structured wikitext, then file metadata, then visible-text heuristics.
    let author = sanitizeWikisourceAuthor(extractWikisourceAuthorFromWikitext(mainPage.wikitext))
        || sanitizeWikisourceAuthor(extractWikisourceAuthor(metadataText))
        || sanitizeWikisourceAuthor(extractWikisourceAuthorHeuristic(metadataText, title));

    const publicationYear = extractWikisourcePublicationYear(metadataText);
    const description = metadataText
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 8)
        .join(" ")
        .slice(0, 700);

    // IMPORTANT: For Wikisource, never trust the generic pageimages cover that
    // was collected while fetching the work page. Wikisource frequently returns
    // the Public Domain icon or another unrelated image there. The dedicated
    // file resolver below must be the ONLY authority for the book cover.
    // Otherwise an already-set pageimages URL prevents the real edition-file
    // cover (for example "गोदान.pdf") from ever being selected.
    mainPage.coverImage = null;

   const fileMetadata = await resolveWikisourceCoverAndAuthorFromPageImages(info.apiUrl, title);

if (!author && fileMetadata.author) {
    author = fileMetadata.author;
}

if (fileMetadata.coverImage) {
    mainPage.coverImage = fileMetadata.coverImage;
}
   
   
    // These are secondary fallbacks only. They are used after the exact edition
    // file resolver has had a chance to find the real cover.
    if (!mainPage.coverImage) {
        mainPage.coverImage = await resolveWikisourceImageFromWikitext(info.apiUrl, mainPage.wikitext);
    }
    if (!mainPage.coverImage) {
        mainPage.coverImage = await resolveWikisourceCoverByTitle(info, title);
    }

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
