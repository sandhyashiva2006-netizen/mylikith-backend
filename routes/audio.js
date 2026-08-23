const express = require("express");
const router = express.Router();
const db = require("../db");

/*
=========================================================
GET AUDIO NOVELS
/api/audio
=========================================================
*/

router.get("/", async (req, res) => {
    try {
        const {
            search = "",
            language = "",
            category = "",
            premium,
            featured,
            sort = "latest",
            page = 1,
            limit = 20
        } = req.query;

        const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
        const limitNumber = Math.min(
            Math.max(parseInt(limit, 10) || 20, 1),
            50
        );

        const offset = (pageNumber - 1) * limitNumber;

        const conditions = [
    "an.publish_status = 'published'",
    "an.visibility = 'public'"
];	

        const values = [];
        let parameterIndex = 1;

        if (search.trim()) {
            conditions.push(`
                (
                    an.title ILIKE $${parameterIndex}
                    OR an.description ILIKE $${parameterIndex}
                )
            `);

            values.push(`%${search.trim()}%`);
            parameterIndex++;
        }

        if (language.trim()) {
            conditions.push(
                `an.language = $${parameterIndex}`
            );

            values.push(language.trim());
            parameterIndex++;
        }

        if (category.trim()) {
            conditions.push(`
                (
                    an.category = $${parameterIndex}
                    OR $${parameterIndex} = ANY(an.categories)
                )
            `);

            values.push(category.trim());
            parameterIndex++;
        }

        if (premium !== undefined) {
            const premiumValue =
                String(premium).toLowerCase() === "true";

            conditions.push(
                `an.premium_only = $${parameterIndex}`
            );

            values.push(premiumValue);
            parameterIndex++;
        }

        if (featured !== undefined) {
            const featuredValue =
                String(featured).toLowerCase() === "true";

            conditions.push(
                `an.featured = $${parameterIndex}`
            );

            values.push(featuredValue);
            parameterIndex++;
        }

        let orderBy = "an.created_at DESC";

        switch (String(sort).toLowerCase()) {
            case "popular":
                orderBy = "an.views DESC, an.created_at DESC";
                break;

            case "rating":
                orderBy = "an.rating DESC, an.created_at DESC";
                break;

            case "likes":
                orderBy = "an.likes DESC, an.created_at DESC";
                break;

            case "oldest":
                orderBy = "an.created_at ASC";
                break;

            case "latest":
            default:
                orderBy = "an.created_at DESC";
                break;
        }

        const whereClause =
            conditions.length
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

        const countResult = await db.query(
            `
            SELECT COUNT(*)::int AS total
            FROM audio_novels an
            ${whereClause}
            `,
            values
        );

        const total =
            countResult.rows[0]?.total || 0;

        const queryValues = [
            ...values,
            limitNumber,
            offset
        ];

        const result = await db.query(
            `
            SELECT
                an.id,
                an.title,
                an.description,
                an.cover_url,
                an.language,
                an.category,
                an.categories,
                an.content_type,
                an.status,
                an.publish_status,
                an.visibility,
                an.premium_only,
                an.featured,
                an.views,
                an.likes,
                an.rating,
                an.release_date,
                an.created_by,
                an.created_at,
                an.updated_at,

                u.name AS writer_name,
u.profile_image AS writer_profile_image

            FROM audio_novels an

            LEFT JOIN users u
                ON u.id = an.created_by

            ${whereClause}

            ORDER BY ${orderBy}

            LIMIT $${parameterIndex}
            OFFSET $${parameterIndex + 1}
            `,
            queryValues
        );

        return res.json({
            success: true,
            audio: result.rows,
            pagination: {
                page: pageNumber,
                limit: limitNumber,
                total,
                totalPages:
                    total > 0
                        ? Math.ceil(total / limitNumber)
                        : 0
            }
        });

    } catch (error) {

        console.error(
            "GET /api/audio error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to load audio novels."
        });
    }
});


/*
=========================================================
FEATURED AUDIO
/api/audio/featured
=========================================================
*/

router.get("/featured", async (req, res) => {
    try {

        const result = await db.query(`
            SELECT
                an.id,
                an.title,
                an.description,
                an.cover_url,
                an.language,
                an.category,
                an.categories,
                an.premium_only,
                an.featured,
                an.views,
                an.likes,
                an.rating,
                an.release_date,
                an.created_by,
                an.created_at,

                u.name AS writer_name,
u.profile_image AS writer_profile_image

            FROM audio_novels an

            LEFT JOIN users u
                ON u.id = an.created_by

            WHERE
    an.publish_status = 'published'
    AND an.visibility = 'public'
    AND an.featured = TRUE

            ORDER BY
                an.created_at DESC

            LIMIT 20
        `);

        return res.json({
            success: true,
            audio: result.rows
        });

    } catch (error) {

        console.error(
            "GET /api/audio/featured error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to load featured audio."
        });
    }
});


/*
=========================================================
LANGUAGES
/api/audio/languages
=========================================================
*/

router.get("/languages", async (req, res) => {
    try {

        const result = await db.query(`
            SELECT DISTINCT language
            FROM audio_novels
            WHERE
                status = 'published'
                AND language IS NOT NULL
                AND TRIM(language) <> ''
            ORDER BY language ASC
        `);

        return res.json({
            success: true,
            languages:
                result.rows.map(
                    row => row.language
                )
        });

    } catch (error) {

        console.error(
            "GET /api/audio/languages error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to load audio languages."
        });
    }
});


/*
=========================================================
CATEGORIES
/api/audio/categories
=========================================================
*/

router.get("/categories", async (req, res) => {
    try {

        const result = await db.query(`
            SELECT DISTINCT category
            FROM audio_novels
            WHERE
                status = 'published'
                AND category IS NOT NULL
                AND TRIM(category) <> ''
            ORDER BY category ASC
        `);

        return res.json({
            success: true,
            categories:
                result.rows.map(
                    row => row.category
                )
        });

    } catch (error) {

        console.error(
            "GET /api/audio/categories error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to load audio categories."
        });
    }
});


/*
=========================================================
GET SINGLE AUDIO NOVEL
/api/audio/:id
=========================================================
*/

router.get("/:id", async (req, res) => {
    try {

        const audioId =
            parseInt(req.params.id, 10);

        if (
            !Number.isInteger(audioId) ||
            audioId <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid audio ID."
            });
        }

        const result = await db.query(`
            SELECT
                an.id,
                an.title,
                an.description,
                an.cover_url,
                an.language,
                an.category,
                an.categories,
                an.content_type,
                an.status,
                an.publish_status,
                an.visibility,
                an.premium_only,
                an.featured,
                an.views,
                an.likes,
                an.rating,
                an.release_date,
                an.created_by,
                an.created_at,
                an.updated_at,

                u.name AS writer_name,
u.profile_image AS writer_profile_image

            FROM audio_novels an

            LEFT JOIN users u
                ON u.id = an.created_by

            WHERE
    an.id = $1
    AND an.publish_status = 'published'
    AND an.visibility = 'public'
        `, [audioId]);

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Audio novel not found."
            });
        }

        return res.json({
            success: true,
            audio: result.rows[0]
        });

    } catch (error) {

        console.error(
            "GET /api/audio/:id error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to load audio novel."
        });
    }
});


/*
=========================================================
GET AUDIO CHAPTERS
/api/audio/:id/chapters
=========================================================
*/

router.get("/:id/chapters", async (req, res) => {
    try {

        const audioId =
            parseInt(req.params.id, 10);

        if (
            !Number.isInteger(audioId) ||
            audioId <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid audio ID."
            });
        }

        const novelCheck =
            await db.query(`
                SELECT id
FROM audio_novels
WHERE
    id = $1
    AND publish_status = 'published'
    AND visibility = 'public'
            `, [audioId]);

        if (!novelCheck.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Audio novel not found."
            });
        }

        const result = await db.query(`
            SELECT
                id,
                audio_novel_id,
                chapter_no,
                title,

                audio_provider,
                audio_mime_type,
                audio_original_name,
                audio_size_bytes,
                audio_duration_seconds,
                audio_status,

                is_premium,
                coins_required,
                early_access,

                is_draft,
                is_published,
                publish_at,

                created_at,
                updated_at

            FROM audio_chapters

            WHERE
                audio_novel_id = $1
                AND is_published = TRUE
                AND is_draft = FALSE

            ORDER BY chapter_no ASC
        `, [audioId]);

        return res.json({
            success: true,
            chapters: result.rows
        });

    } catch (error) {

        console.error(
            "GET /api/audio/:id/chapters error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to load audio chapters."
        });
    }
});


/*
=========================================================
GET SINGLE AUDIO CHAPTER
/api/audio/chapter/:chapterId
=========================================================
*/

router.get("/chapter/:chapterId", async (req, res) => {
    try {

        const chapterId =
            parseInt(
                req.params.chapterId,
                10
            );

        if (
            !Number.isInteger(chapterId) ||
            chapterId <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid chapter ID."
            });
        }

        const result = await db.query(`
            SELECT
                ac.id,
                ac.audio_novel_id,
                ac.chapter_no,
                ac.title,

                ac.audio_provider,
                ac.audio_mime_type,
                ac.audio_size_bytes,
                ac.audio_duration_seconds,
                ac.audio_status,

                ac.is_premium,
                ac.coins_required,
                ac.early_access,

                ac.is_draft,
                ac.is_published,
                ac.publish_at,

                ac.created_at,
                ac.updated_at,

                an.title AS audio_novel_title,
                an.cover_url AS audio_novel_cover_url,
                an.status AS audio_novel_status

            FROM audio_chapters ac

            JOIN audio_novels an
                ON an.id = ac.audio_novel_id

            WHERE
                ac.id = $1
                AND ac.is_published = TRUE
                AND ac.is_draft = FALSE
                AND an.publish_status = 'published'
AND an.visibility = 'public'
        `, [chapterId]);

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Audio chapter not found."
            });
        }

        return res.json({
            success: true,
            chapter: result.rows[0]
        });

    } catch (error) {

        console.error(
            "GET /api/audio/chapter/:chapterId error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to load audio chapter."
        });
    }
});


/*
=========================================================
INCREMENT AUDIO NOVEL VIEW
POST /api/audio/:id/view
=========================================================
*/

router.post("/:id/view", async (req, res) => {
    try {

        const audioId =
            parseInt(req.params.id, 10);

        if (
            !Number.isInteger(audioId) ||
            audioId <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid audio ID."
            });
        }

        const result = await db.query(`
            UPDATE audio_novels

            SET
                views = COALESCE(views, 0) + 1,
                updated_at = NOW()

            WHERE
    id = $1
    AND publish_status = 'published'
    AND visibility = 'public'

            RETURNING
                id,
                views
        `, [audioId]);

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Audio novel not found."
            });
        }

        return res.json({
            success: true,
            views: result.rows[0].views
        });

    } catch (error) {

        console.error(
            "POST /api/audio/:id/view error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to update audio views."
        });
    }
});


module.exports = router;