const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

const MAX_LIMIT = 50;

function parsePositiveInt(value, fallback = null) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : fallback;
}

function publicAudioNovelColumns(alias = "an") {
    return `
        ${alias}.id,
        ${alias}.title,
        ${alias}.description,
        ${alias}.cover_url,
        ${alias}.language,
        ${alias}.category,
        ${alias}.categories,
        ${alias}.content_type,
        ${alias}.status,
        ${alias}.premium_only,
        ${alias}.featured,
        ${alias}.views,
        ${alias}.likes,
        ${alias}.rating,
        ${alias}.rating_count,
        ${alias}.release_date,
        ${alias}.created_at,
        ${alias}.updated_at,
        u.id AS author_id,
        u.name AS author_name,
        u.profile_image AS author_profile_image,
        wp.pen_name AS author_pen_name
    `;
}

/* =========================================================
   GET AUDIO DISCOVERY
   GET /api/audio

   Query params:
   search, language, category, premium, featured,
   sort=latest|popular|rating, page, limit
========================================================= */
router.get("/", async (req, res) => {
    try {
        const {
            search = "",
            language = "",
            category = "",
            premium,
            featured,
            sort = "latest"
        } = req.query;

        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(
            parsePositiveInt(req.query.limit, 20),
            MAX_LIMIT
        );
        const offset = (page - 1) * limit;

        const conditions = [
            "an.publish_status = 'published'",
            "an.visibility = 'public'"
        ];
        const values = [];

        if (search.trim()) {
            values.push(`%${search.trim()}%`);
            conditions.push(`(
                an.title ILIKE $${values.length}
                OR COALESCE(an.description, '') ILIKE $${values.length}
                OR COALESCE(u.name, '') ILIKE $${values.length}
                OR COALESCE(wp.pen_name, '') ILIKE $${values.length}
            )`);
        }

        if (language.trim()) {
            values.push(language.trim());
            conditions.push(`an.language = $${values.length}`);
        }

        if (category.trim()) {
            values.push(category.trim());
            conditions.push(`(
                an.category = $${values.length}
                OR $${values.length} = ANY(an.categories)
            )`);
        }

        if (premium !== undefined) {
            const premiumValue = String(premium).toLowerCase();
            if (premiumValue === "true" || premiumValue === "1") {
                conditions.push("an.premium_only = TRUE");
            } else if (premiumValue === "false" || premiumValue === "0") {
                conditions.push("an.premium_only = FALSE");
            }
        }

        if (featured !== undefined) {
            const featuredValue = String(featured).toLowerCase();
            if (featuredValue === "true" || featuredValue === "1") {
                conditions.push("an.featured = TRUE");
            }
        }

        const orderBy = {
            latest: "an.release_date DESC NULLS LAST, an.created_at DESC",
            popular: "an.views DESC, an.likes DESC, an.created_at DESC",
            rating: "an.rating DESC, an.rating_count DESC, an.created_at DESC"
        }[String(sort).toLowerCase()] ||
        "an.release_date DESC NULLS LAST, an.created_at DESC";

        values.push(limit);
        const limitParam = values.length;
        values.push(offset);
        const offsetParam = values.length;

        const countConditions = [...conditions];

        const result = await db.query(`
            SELECT
                ${publicAudioNovelColumns()}
            FROM audio_novels an
            LEFT JOIN users u
                ON u.id = an.created_by
            LEFT JOIN writer_profiles wp
                ON wp.user_id = an.created_by
            WHERE ${conditions.join(" AND ")}
            ORDER BY ${orderBy}
            LIMIT $${limitParam}
            OFFSET $${offsetParam}
        `, values);

        const countResult = await db.query(`
            SELECT COUNT(*)::INTEGER AS total
            FROM audio_novels an
            LEFT JOIN users u
                ON u.id = an.created_by
            LEFT JOIN writer_profiles wp
                ON wp.user_id = an.created_by
            WHERE ${countConditions.join(" AND ")}
        `, values.slice(0, values.length - 2));

        const total = countResult.rows[0]?.total || 0;

        res.json({
            success: true,
            audio: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (err) {
        console.error("Audio discovery error:", err);
        res.status(500).json({
            success: false,
            message: "Unable to load MyLikith Audio."
        });
    }
});

/* =========================================================
   GET FEATURED AUDIO
   GET /api/audio/featured
========================================================= */
router.get("/featured", async (req, res) => {
    try {
        const limit = Math.min(
            parsePositiveInt(req.query.limit, 10),
            MAX_LIMIT
        );

        const result = await db.query(`
            SELECT
                ${publicAudioNovelColumns()}
            FROM audio_novels an
            LEFT JOIN users u
                ON u.id = an.created_by
            LEFT JOIN writer_profiles wp
                ON wp.user_id = an.created_by
            WHERE
                an.publish_status = 'published'
                AND an.visibility = 'public'
                AND an.featured = TRUE
            ORDER BY
                an.release_date DESC NULLS LAST,
                an.created_at DESC
            LIMIT $1
        `, [limit]);

        res.json({
            success: true,
            audio: result.rows
        });

    } catch (err) {
        console.error("Featured Audio error:", err);
        res.status(500).json({
            success: false,
            message: "Unable to load featured Audio."
        });
    }
});

/* =========================================================
   GET AUDIO LANGUAGES
   GET /api/audio/languages
========================================================= */
router.get("/languages", async (req, res) => {
    try {
        const result = await db.query(`
            SELECT language, COUNT(*)::INTEGER AS count
            FROM audio_novels
            WHERE
                publish_status = 'published'
                AND visibility = 'public'
                AND language IS NOT NULL
                AND btrim(language) <> ''
            GROUP BY language
            ORDER BY language ASC
        `);

        res.json({ success: true, languages: result.rows });
    } catch (err) {
        console.error("Audio languages error:", err);
        res.status(500).json({
            success: false,
            message: "Unable to load Audio languages."
        });
    }
});

/* =========================================================
   GET AUDIO CATEGORIES
   GET /api/audio/categories
========================================================= */
router.get("/categories", async (req, res) => {
    try {
        const result = await db.query(`
            SELECT category, COUNT(*)::INTEGER AS count
            FROM audio_novels
            WHERE
                publish_status = 'published'
                AND visibility = 'public'
                AND category IS NOT NULL
                AND btrim(category) <> ''
            GROUP BY category
            ORDER BY category ASC
        `);

        res.json({ success: true, categories: result.rows });
    } catch (err) {
        console.error("Audio categories error:", err);
        res.status(500).json({
            success: false,
            message: "Unable to load Audio categories."
        });
    }
});

/* =========================================================
   GET AUDIO NOVEL DETAIL
   GET /api/audio/:id
========================================================= */
router.get("/:id", async (req, res) => {
    try {
        const audioId = parsePositiveInt(req.params.id);

        if (!audioId) {
            return res.status(400).json({
                success: false,
                message: "Invalid Audio ID."
            });
        }

        const result = await db.query(`
            SELECT
                ${publicAudioNovelColumns()}
            FROM audio_novels an
            LEFT JOIN users u
                ON u.id = an.created_by
            LEFT JOIN writer_profiles wp
                ON wp.user_id = an.created_by
            WHERE
                an.id = $1
                AND an.publish_status = 'published'
                AND an.visibility = 'public'
        `, [audioId]);

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Audio not found."
            });
        }

        const chapterSummary = await db.query(`
            SELECT
                COUNT(*) FILTER (
                    WHERE is_published = TRUE
                    AND is_draft = FALSE
                    AND (publish_at IS NULL OR publish_at <= NOW())
                )::INTEGER AS published_chapters,
                COALESCE(SUM(audio_duration_seconds) FILTER (
                    WHERE is_published = TRUE
                    AND is_draft = FALSE
                    AND (publish_at IS NULL OR publish_at <= NOW())
                ), 0)::BIGINT AS total_duration_seconds
            FROM audio_chapters
            WHERE audio_novel_id = $1
        `, [audioId]);

        res.json({
            success: true,
            audio: result.rows[0],
            summary: chapterSummary.rows[0]
        });

    } catch (err) {
        console.error("Audio detail error:", err);
        res.status(500).json({
            success: false,
            message: "Unable to load Audio."
        });
    }
});

/* =========================================================
   GET AUDIO NOVEL CHAPTERS
   GET /api/audio/:id/chapters
========================================================= */
router.get("/:id/chapters", async (req, res) => {
    try {
        const audioId = parsePositiveInt(req.params.id);

        if (!audioId) {
            return res.status(400).json({
                success: false,
                message: "Invalid Audio ID."
            });
        }

        const audio = await db.query(`
            SELECT id, title, premium_only
            FROM audio_novels
            WHERE
                id = $1
                AND publish_status = 'published'
                AND visibility = 'public'
        `, [audioId]);

        if (!audio.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Audio not found."
            });
        }

        const chapters = await db.query(`
            SELECT
                id,
                audio_novel_id,
                chapter_no,
                title,
                audio_mime_type,
                audio_size_bytes,
                audio_duration_seconds,
                audio_status,
                is_premium,
                coins_required,
                early_access,
                is_draft,
                is_published,
                publish_at,
                views,
                likes,
                rating,
                rating_count,
                created_at,
                updated_at
            FROM audio_chapters
            WHERE
                audio_novel_id = $1
                AND is_draft = FALSE
                AND is_published = TRUE
                AND (publish_at IS NULL OR publish_at <= NOW())
            ORDER BY chapter_no ASC
        `, [audioId]);

        res.json({
            success: true,
            audio: audio.rows[0],
            chapters: chapters.rows
        });

    } catch (err) {
        console.error("Audio chapters error:", err);
        res.status(500).json({
            success: false,
            message: "Unable to load Audio chapters."
        });
    }
});

/* =========================================================
   GET SINGLE AUDIO CHAPTER
   GET /api/audio/chapter/:chapterId

   Metadata only. Playback URL/access control is Phase 4.
========================================================= */
router.get("/chapter/:chapterId", async (req, res) => {
    try {
        const chapterId = parsePositiveInt(req.params.chapterId);

        if (!chapterId) {
            return res.status(400).json({
                success: false,
                message: "Invalid Audio chapter ID."
            });
        }

        const result = await db.query(`
            SELECT
                ac.id,
                ac.audio_novel_id,
                ac.chapter_no,
                ac.title,
                ac.audio_mime_type,
                ac.audio_size_bytes,
                ac.audio_duration_seconds,
                ac.audio_status,
                ac.is_premium,
                ac.coins_required,
                ac.early_access,
                ac.views,
                ac.likes,
                ac.rating,
                ac.rating_count,
                ac.created_at,
                ac.updated_at,
                an.title AS audio_title,
                an.cover_url,
                an.language,
                an.category,
                an.premium_only,
                u.id AS author_id,
                u.name AS author_name,
                u.profile_image AS author_profile_image,
                wp.pen_name AS author_pen_name
            FROM audio_chapters ac
            JOIN audio_novels an
                ON an.id = ac.audio_novel_id
            LEFT JOIN users u
                ON u.id = an.created_by
            LEFT JOIN writer_profiles wp
                ON wp.user_id = an.created_by
            WHERE
                ac.id = $1
                AND ac.is_draft = FALSE
                AND ac.is_published = TRUE
                AND (ac.publish_at IS NULL OR ac.publish_at <= NOW())
                AND an.publish_status = 'published'
                AND an.visibility = 'public'
        `, [chapterId]);

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Audio chapter not found."
            });
        }

        res.json({
            success: true,
            chapter: result.rows[0]
        });

    } catch (err) {
        console.error("Audio chapter error:", err);
        res.status(500).json({
            success: false,
            message: "Unable to load Audio chapter."
        });
    }
});

/* =========================================================
   RECORD AUDIO NOVEL VIEW
   POST /api/audio/:id/view
========================================================= */
router.post("/:id/view", async (req, res) => {
    try {
        const audioId = parsePositiveInt(req.params.id);

        if (!audioId) {
            return res.status(400).json({
                success: false,
                message: "Invalid Audio ID."
            });
        }

        const result = await db.query(`
            UPDATE audio_novels
            SET
                views = views + 1,
                updated_at = NOW()
            WHERE
                id = $1
                AND publish_status = 'published'
                AND visibility = 'public'
            RETURNING views
        `, [audioId]);

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Audio not found."
            });
        }

        res.json({
            success: true,
            views: result.rows[0].views
        });

    } catch (err) {
        console.error("Audio view error:", err);
        res.status(500).json({
            success: false,
            message: "Unable to record Audio view."
        });
    }
});

module.exports = router;
