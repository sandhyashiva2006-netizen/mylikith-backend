const express = require("express");
const router = express.Router();

const db = require("../db");
const auth = require("../middleware/auth");
const axios = require("axios");




/* ==========================================
   CLASSICS IMPORTER HELPERS
========================================== */

function cleanImportedText(value) {
    return String(value || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/\n{3,}/g, "\n\n")
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
            currentTitle = line.trim();
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
        title: chapter.title || `Chapter ${index + 1}`,
        content: chapter.content
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
                const chapters = parseGutenbergText(gutenbergText);
                return {
                    sourceName: "Project Gutenberg",
                    sourceUrl,
                    detectedFormat: "Project Gutenberg text",
                    title: titleMatch ? titleMatch[1].trim() : "",
                    author: authorMatch ? authorMatch[1].trim() : "",
                    description: "Imported from Project Gutenberg.",
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
                description: imported.description || ""
            },
            chapters: imported.chapters.map((chapter, index) => ({
                chapter_number: index + 1,
                title: chapter.title || `Chapter ${index + 1}`,
                content: chapter.content
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
                String(chapter.title || `Chapter ${index + 1}`).trim(),
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