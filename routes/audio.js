const express = require("express");
const router = express.Router();
const db = require("../db");

const auth = require("../middleware/auth");

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
CONTINUE LISTENING
GET /api/audio/continue-listening
=========================================================
*/

router.get(
    "/continue-listening",
    auth,
    async (req, res) => {

        try {

            const userId =
                Number(req.user.id);

            const result =
                await db.query(`
                    SELECT
                        p.id,
                        p.chapter_id,
                        p.position_seconds,
                        p.duration_seconds,
                        p.progress_percent,
                        p.completed,
                        p.updated_at,

                        ac.audio_novel_id,
                        ac.chapter_no,
                        ac.title AS chapter_title,
                        ac.audio_duration_seconds,
                        ac.audio_status,

                        an.title AS audio_novel_title,
                        an.cover_url,
                        an.language,
                        an.category

                    FROM audio_chapter_progress p

                    JOIN audio_chapters ac
                        ON ac.id = p.chapter_id

                    JOIN audio_novels an
                        ON an.id = ac.audio_novel_id

                    WHERE
                        p.user_id = $1

                        AND p.completed = FALSE

                        AND an.publish_status = 'published'

                        AND an.visibility = 'public'

                        AND ac.is_draft = FALSE

                        AND ac.is_published = TRUE

                    ORDER BY
                        p.updated_at DESC

                    LIMIT 20
                `, [
                    userId
                ]);

            return res.json({
                success: true,
                listening: result.rows
            });

        } catch (error) {

            console.error(
                "GET continue listening error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to load continue listening."
            });

        }

    }
);


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

/*
=========================================================
AUDIO NOVEL LIKE
GET /api/audio/:id/like
POST /api/audio/:id/like
=========================================================
*/

router.get(
    "/:id/like",
    auth,
    async (req, res) => {
        try {
            const audioId = Number(req.params.id);
            const userId = Number(req.user.id);

            if (!Number.isInteger(audioId) || audioId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid audio ID."
                });
            }

            const result = await db.query(`
                SELECT
                    an.likes,
                    EXISTS (
                        SELECT 1
                        FROM audio_likes al
                        WHERE al.audio_id = an.id
                          AND al.user_id = $2
                    ) AS liked
                FROM audio_novels an
                WHERE
                    an.id = $1
                    AND an.publish_status = 'published'
                    AND an.visibility = 'public'
            `, [audioId, userId]);

            if (!result.rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "Audio novel not found."
                });
            }

            return res.json({
                success: true,
                liked: Boolean(result.rows[0].liked),
                likes: Number(result.rows[0].likes || 0)
            });
        } catch (error) {
            console.error("GET audio novel like error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to load audio novel like status."
            });
        }
    }
);

router.post(
    "/:id/like",
    auth,
    async (req, res) => {
        const client = await db.connect();

        try {
            const audioId = Number(req.params.id);
            const userId = Number(req.user.id);

            if (!Number.isInteger(audioId) || audioId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid audio ID."
                });
            }

            await client.query("BEGIN");

            const novel = await client.query(`
                SELECT id
                FROM audio_novels
                WHERE
                    id = $1
                    AND publish_status = 'published'
                    AND visibility = 'public'
            `, [audioId]);

            if (!novel.rows.length) {
                await client.query("ROLLBACK");
                return res.status(404).json({
                    success: false,
                    message: "Audio novel not found."
                });
            }

            const existing = await client.query(`
                SELECT id
                FROM audio_likes
                WHERE
                    audio_id = $1
                    AND user_id = $2
                LIMIT 1
            `, [audioId, userId]);

            let liked;

            if (existing.rows.length) {
                await client.query(`
                    DELETE FROM audio_likes
                    WHERE id = $1
                `, [existing.rows[0].id]);
                liked = false;
            } else {
                await client.query(`
                    INSERT INTO audio_likes
                    (
                        audio_id,
                        user_id,
                        created_at
                    )
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (audio_id, user_id)
                    DO NOTHING
                `, [audioId, userId]);
                liked = true;
            }

            const count = await client.query(`
                SELECT COUNT(*)::int AS likes
                FROM audio_likes
                WHERE audio_id = $1
            `, [audioId]);

            await client.query(`
                UPDATE audio_novels
                SET
                    likes = $1,
                    updated_at = NOW()
                WHERE id = $2
            `, [Number(count.rows[0].likes || 0), audioId]);

            await client.query("COMMIT");

            return res.json({
                success: true,
                liked,
                likes: Number(count.rows[0].likes || 0)
            });
        } catch (error) {
            await client.query("ROLLBACK");
            console.error("POST audio novel like error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to update audio novel like."
            });
        } finally {
            client.release();
        }
    }
);

/*
=========================================================
AUDIO NOVEL RATING
GET /api/audio/:id/rating
POST /api/audio/:id/rating
=========================================================
*/

router.get(
    "/:id/rating",
    auth,
    async (req, res) => {
        try {
            const audioId = Number(req.params.id);
            const userId = Number(req.user.id);

            if (!Number.isInteger(audioId) || audioId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid audio ID."
                });
            }

            const novel = await db.query(`
                SELECT id
                FROM audio_novels
                WHERE
                    id = $1
                    AND publish_status = 'published'
                    AND visibility = 'public'
            `, [audioId]);

            if (!novel.rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "Audio novel not found."
                });
            }

            const userRating = await db.query(`
                SELECT rating
                FROM audio_ratings
                WHERE
                    audio_id = $1
                    AND user_id = $2
                LIMIT 1
            `, [audioId, userId]);

            const aggregate = await db.query(`
                SELECT
                    ROUND(COALESCE(AVG(rating), 0), 2) AS average_rating,
                    COUNT(*)::int AS rating_count
                FROM audio_ratings
                WHERE audio_id = $1
            `, [audioId]);

            return res.json({
                success: true,
                rating: userRating.rows.length
                    ? Number(userRating.rows[0].rating)
                    : null,
                average_rating: Number(aggregate.rows[0].average_rating || 0),
                rating_count: Number(aggregate.rows[0].rating_count || 0)
            });
        } catch (error) {
            console.error("GET audio novel rating error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to load audio novel rating."
            });
        }
    }
);

router.post(
    "/:id/rating",
    auth,
    async (req, res) => {
        const client = await db.connect();

        try {
            const audioId = Number(req.params.id);
            const userId = Number(req.user.id);
            const rating = Number(req.body.rating);

            if (!Number.isInteger(audioId) || audioId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid audio ID."
                });
            }

            if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
                return res.status(400).json({
                    success: false,
                    message: "Rating must be between 1 and 5."
                });
            }

            await client.query("BEGIN");

            const novel = await client.query(`
                SELECT id
                FROM audio_novels
                WHERE
                    id = $1
                    AND publish_status = 'published'
                    AND visibility = 'public'
            `, [audioId]);

            if (!novel.rows.length) {
                await client.query("ROLLBACK");
                return res.status(404).json({
                    success: false,
                    message: "Audio novel not found."
                });
            }

            await client.query(`
                INSERT INTO audio_ratings
                (
                    audio_id,
                    user_id,
                    rating,
                    created_at,
                    updated_at
                )
                VALUES ($1, $2, $3, NOW(), NOW())
                ON CONFLICT (audio_id, user_id)
                DO UPDATE SET
                    rating = EXCLUDED.rating,
                    updated_at = NOW()
            `, [audioId, userId, rating]);

            const aggregate = await client.query(`
                SELECT
                    ROUND(COALESCE(AVG(rating), 0), 2) AS average_rating,
                    COUNT(*)::int AS rating_count
                FROM audio_ratings
                WHERE audio_id = $1
            `, [audioId]);

            await client.query(`
                UPDATE audio_novels
                SET
                    rating = $1,
                    rating_count = $2,
                    updated_at = NOW()
                WHERE id = $3
            `, [
                Number(aggregate.rows[0].average_rating || 0),
                Number(aggregate.rows[0].rating_count || 0),
                audioId
            ]);

            await client.query("COMMIT");

            return res.json({
                success: true,
                rating,
                average_rating: Number(aggregate.rows[0].average_rating || 0),
                rating_count: Number(aggregate.rows[0].rating_count || 0)
            });
        } catch (error) {
            await client.query("ROLLBACK");
            console.error("POST audio novel rating error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to save audio novel rating."
            });
        } finally {
            client.release();
        }
    }
);

/*
=========================================================
AUDIO NOVEL COMMENTS
GET /api/audio/:id/comments
POST /api/audio/:id/comments
DELETE /api/audio/:id/comments/:commentId
=========================================================
*/

router.get(
    "/:id/comments",
    async (req, res) => {
        try {
            const audioId = Number(req.params.id);

            if (!Number.isInteger(audioId) || audioId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid audio ID."
                });
            }

            const result = await db.query(`
                SELECT
                    c.id,
                    c.audio_novel_id,
                    c.user_id,
                    c.comment,
                    c.created_at,
                    c.updated_at,
                    u.name,
                    u.profile_image
                FROM audio_comments c
                LEFT JOIN users u
                    ON u.id = c.user_id
                JOIN audio_novels an
                    ON an.id = c.audio_novel_id
                WHERE
                    c.audio_novel_id = $1
                    AND an.publish_status = 'published'
                    AND an.visibility = 'public'
                ORDER BY c.created_at DESC
            `, [audioId]);

            return res.json({
                success: true,
                comments: result.rows
            });
        } catch (error) {
            console.error("GET audio novel comments error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to load audio novel comments."
            });
        }
    }
);

router.post(
    "/:id/comments",
    auth,
    async (req, res) => {
        try {
            const audioId = Number(req.params.id);
            const userId = Number(req.user.id);
            const comment = String(req.body.comment || "").trim();

            if (!Number.isInteger(audioId) || audioId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid audio ID."
                });
            }

            if (!comment) {
                return res.status(400).json({
                    success: false,
                    message: "Comment cannot be empty."
                });
            }

            if (comment.length > 2000) {
                return res.status(400).json({
                    success: false,
                    message: "Comment cannot exceed 2000 characters."
                });
            }

            const novel = await db.query(`
                SELECT id
                FROM audio_novels
                WHERE
                    id = $1
                    AND publish_status = 'published'
                    AND visibility = 'public'
            `, [audioId]);

            if (!novel.rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "Audio novel not found."
                });
            }

            const result = await db.query(`
                INSERT INTO audio_comments
                (
                    audio_novel_id,
                    user_id,
                    comment,
                    created_at,
                    updated_at
                )
                VALUES ($1, $2, $3, NOW(), NOW())
                RETURNING
                    id,
                    audio_novel_id,
                    user_id,
                    comment,
                    created_at,
                    updated_at
            `, [audioId, userId, comment]);

            const user = await db.query(`
                SELECT name, profile_image
                FROM users
                WHERE id = $1
            `, [userId]);

            return res.status(201).json({
                success: true,
                comment: {
                    ...result.rows[0],
                    name: user.rows[0]?.name || null,
                    profile_image: user.rows[0]?.profile_image || null
                }
            });
        } catch (error) {
            console.error("POST audio novel comment error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to add audio novel comment."
            });
        }
    }
);

router.delete(
    "/:id/comments/:commentId",
    auth,
    async (req, res) => {
        try {
            const audioId = Number(req.params.id);
            const commentId = Number(req.params.commentId);
            const userId = Number(req.user.id);

            if (
                !Number.isInteger(audioId) ||
                audioId <= 0 ||
                !Number.isInteger(commentId) ||
                commentId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid comment ID."
                });
            }

            const result = await db.query(`
                DELETE FROM audio_comments
                WHERE
                    id = $1
                    AND audio_novel_id = $2
                    AND user_id = $3
                RETURNING id
            `, [commentId, audioId, userId]);

            if (!result.rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "Comment not found or you cannot delete it."
                });
            }

            return res.json({
                success: true,
                message: "Comment deleted successfully."
            });
        } catch (error) {
            console.error("DELETE audio novel comment error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to delete audio novel comment."
            });
        }
    }
);

/*
=========================================================
REPORT AUDIO NOVEL COMMENT
POST /api/audio/novel-comments/:commentId/report
=========================================================
*/

router.post(
    "/novel-comments/:commentId/report",
    auth,
    async (req, res) => {
        try {
            const commentId = Number(req.params.commentId);
            const reporterUserId = Number(req.user.id);
            const reason = String(req.body.reason || "").trim();

            if (!Number.isInteger(commentId) || commentId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid comment ID."
                });
            }

            if (!reason) {
                return res.status(400).json({
                    success: false,
                    message: "Please provide a report reason."
                });
            }

            if (reason.length > 1000) {
                return res.status(400).json({
                    success: false,
                    message: "Report reason cannot exceed 1000 characters."
                });
            }

            const comment = await db.query(`
                SELECT id, user_id
                FROM audio_comments
                WHERE id = $1
                LIMIT 1
            `, [commentId]);

            if (!comment.rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "Comment not found."
                });
            }

            if (Number(comment.rows[0].user_id) === reporterUserId) {
                return res.status(400).json({
                    success: false,
                    message: "You cannot report your own comment."
                });
            }

            const existing = await db.query(`
                SELECT id
                FROM audio_comment_reports
                WHERE
                    comment_id = $1
                    AND reporter_user_id = $2
                LIMIT 1
            `, [commentId, reporterUserId]);

            if (existing.rows.length) {
                return res.status(409).json({
                    success: false,
                    message: "You have already reported this comment."
                });
            }

            const result = await db.query(`
                INSERT INTO audio_comment_reports
                (
                    comment_id,
                    reporter_user_id,
                    reason,
                    status,
                    created_at
                )
                VALUES ($1, $2, $3, 'pending', NOW())
                RETURNING
                    id,
                    comment_id,
                    reporter_user_id,
                    reason,
                    status,
                    created_at
            `, [commentId, reporterUserId, reason]);

            return res.status(201).json({
                success: true,
                report: result.rows[0]
            });
        } catch (error) {
            console.error("POST audio novel comment report error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to report audio novel comment."
            });
        }
    }
);

/*
=========================================================
GET AUDIO CHAPTER PROGRESS
GET /api/audio/chapters/:chapterId/progress
=========================================================
*/

router.get(
    "/chapters/:chapterId/progress",
    auth,
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);

            const userId =
                Number(req.user.id);

            if (
                !Number.isInteger(chapterId) ||
                chapterId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid chapter ID."
                });
            }

            const result =
                await db.query(`
                    SELECT
                        id,
                        user_id,
                        chapter_id,
                        position_seconds,
                        duration_seconds,
                        progress_percent,
                        completed,
                        updated_at

                    FROM audio_chapter_progress

                    WHERE
                        user_id = $1
                        AND chapter_id = $2

                    LIMIT 1
                `, [
                    userId,
                    chapterId
                ]);

            if (!result.rows.length) {

                return res.json({
                    success: true,
                    progress: null
                });

            }

            return res.json({
                success: true,
                progress: result.rows[0]
            });

        } catch (error) {

            console.error(
                "GET audio progress error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to load audio progress."
            });

        }

    }
);


/*
=========================================================
SAVE AUDIO CHAPTER PROGRESS
POST /api/audio/chapters/:chapterId/progress
=========================================================
*/

router.post(
    "/chapters/:chapterId/progress",
    auth,
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);

            const userId =
                Number(req.user.id);

            if (
                !Number.isInteger(chapterId) ||
                chapterId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid chapter ID."
                });
            }

            let position =
                Number(
                    req.body.position_seconds
                );

            let duration =
                Number(
                    req.body.duration_seconds
                );

            if (
                !Number.isFinite(position) ||
                position < 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid position."
                });
            }

            if (
                !Number.isFinite(duration) ||
                duration <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid duration."
                });
            }

            /*
            =================================================
            CLAMP POSITION
            =================================================
            */

            position =
                Math.min(
                    position,
                    duration
                );

            /*
            =================================================
            ROUND VALUES
            =================================================
            */

position = Math.round(position);
duration = Math.round(duration);

            let progressPercent =
                (position / duration) * 100;

            progressPercent =
                Math.min(
                    Math.max(
                        progressPercent,
                        0
                    ),
                    100
                );

            progressPercent =
                Math.round(
                    progressPercent * 100
                ) / 100;

            /*
            =================================================
            COMPLETION
            =================================================
            */

            const completed =
                progressPercent >= 98;

            if (completed) {

                position =
                    duration;

                progressPercent = 100;
            }

            /*
            =================================================
            UPSERT
            =================================================
            */

            const result =
                await db.query(`
                    INSERT INTO audio_chapter_progress
                    (
                        user_id,
                        chapter_id,
                        position_seconds,
                        duration_seconds,
                        progress_percent,
                        completed,
                        updated_at
                    )

                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        NOW()
                    )

                    ON CONFLICT
                        (user_id, chapter_id)

                    DO UPDATE SET
                        position_seconds =
                            EXCLUDED.position_seconds,

                        duration_seconds =
                            EXCLUDED.duration_seconds,

                        progress_percent =
                            EXCLUDED.progress_percent,

                        completed =
                            EXCLUDED.completed,

                        updated_at =
                            NOW()

                    RETURNING
                        id,
                        user_id,
                        chapter_id,
                        position_seconds,
                        duration_seconds,
                        progress_percent,
                        completed,
                        updated_at
                `, [
                    userId,
                    chapterId,
                    position,
                    duration,
                    progressPercent,
                    completed
                ]);

            return res.json({
                success: true,
                progress: result.rows[0]
            });

        } catch (error) {

            console.error(
                "POST audio progress error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to save audio progress."
            });

        }

    }
);

/*
=========================================================
AUDIO CHAPTER LIKE STATUS
GET /api/audio/chapters/:chapterId/like
=========================================================
*/

router.get(
    "/chapters/:chapterId/like",
    auth,
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);

            const userId =
                Number(req.user.id);

            if (
                !Number.isInteger(chapterId) ||
                chapterId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid chapter ID."
                });
            }

            const chapter =
                await db.query(`
                    SELECT id
                    FROM audio_chapters
                    WHERE
                        id = $1
                        AND is_published = TRUE
                        AND is_draft = FALSE
                `, [chapterId]);

            if (!chapter.rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "Audio chapter not found."
                });
            }

            const result =
                await db.query(`
                    SELECT id
                    FROM audio_chapter_likes
                    WHERE
                        user_id = $1
                        AND chapter_id = $2
                    LIMIT 1
                `, [
                    userId,
                    chapterId
                ]);

            const count =
                await db.query(`
                    SELECT COUNT(*)::int AS likes
                    FROM audio_chapter_likes
                    WHERE chapter_id = $1
                `, [chapterId]);

            return res.json({
                success: true,
                liked: result.rows.length > 0,
                likes: count.rows[0].likes
            });

        } catch (error) {

            console.error(
                "GET audio chapter like error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Failed to load audio like status."
            });
        }
    }
);


/*
=========================================================
TOGGLE AUDIO CHAPTER LIKE
POST /api/audio/chapters/:chapterId/like
=========================================================
*/

router.post(
    "/chapters/:chapterId/like",
    auth,
    async (req, res) => {

        const client =
            await db.connect();

        try {

            const chapterId =
                Number(req.params.chapterId);

            const userId =
                Number(req.user.id);

            if (
                !Number.isInteger(chapterId) ||
                chapterId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid chapter ID."
                });
            }

            await client.query("BEGIN");

            const chapter =
                await client.query(`
                    SELECT id
                    FROM audio_chapters
                    WHERE
                        id = $1
                        AND is_published = TRUE
                        AND is_draft = FALSE
                `, [chapterId]);

            if (!chapter.rows.length) {

                await client.query("ROLLBACK");

                return res.status(404).json({
                    success: false,
                    message: "Audio chapter not found."
                });
            }

            const existing =
                await client.query(`
                    SELECT id
                    FROM audio_chapter_likes
                    WHERE
                        user_id = $1
                        AND chapter_id = $2
                    LIMIT 1
                `, [
                    userId,
                    chapterId
                ]);

            let liked;

            if (existing.rows.length) {

                await client.query(`
                    DELETE FROM audio_chapter_likes
                    WHERE
                        user_id = $1
                        AND chapter_id = $2
                `, [
                    userId,
                    chapterId
                ]);

                liked = false;

            } else {

                await client.query(`
                    INSERT INTO audio_chapter_likes
                    (
                        user_id,
                        chapter_id,
                        created_at
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        NOW()
                    )
                    ON CONFLICT (
                        user_id,
                        chapter_id
                    )
                    DO NOTHING
                `, [
                    userId,
                    chapterId
                ]);

                liked = true;
            }

            const count =
                await client.query(`
                    SELECT COUNT(*)::int AS likes
                    FROM audio_chapter_likes
                    WHERE chapter_id = $1
                `, [chapterId]);

            await client.query("COMMIT");

            return res.json({
                success: true,
                liked,
                likes: count.rows[0].likes
            });

        } catch (error) {

            await client.query("ROLLBACK");

            console.error(
                "POST audio chapter like error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Failed to update audio like."
            });

        } finally {

            client.release();
        }
    }
);

/*
=========================================================
GET AUDIO CHAPTER RATING
GET /api/audio/chapters/:chapterId/rating
=========================================================
*/

router.get(
    "/chapters/:chapterId/rating",
    auth,
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);

            const userId =
                Number(req.user.id);

            if (
                !Number.isInteger(chapterId) ||
                chapterId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid chapter ID."
                });
            }

            const chapter =
                await db.query(`
                    SELECT id
                    FROM audio_chapters
                    WHERE
                        id = $1
                        AND is_published = TRUE
                        AND is_draft = FALSE
                `, [chapterId]);

            if (!chapter.rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "Audio chapter not found."
                });
            }

            const userRating =
                await db.query(`
                    SELECT
                        rating
                    FROM audio_chapter_ratings
                    WHERE
                        user_id = $1
                        AND chapter_id = $2
                    LIMIT 1
                `, [
                    userId,
                    chapterId
                ]);

            const aggregate =
                await db.query(`
                    SELECT
                        ROUND(
                            COALESCE(
                                AVG(rating),
                                0
                            ),
                            2
                        ) AS average_rating,
                        COUNT(*)::int AS rating_count
                    FROM audio_chapter_ratings
                    WHERE chapter_id = $1
                `, [chapterId]);

            return res.json({
                success: true,

                rating:
                    userRating.rows.length
                        ? Number(
                            userRating.rows[0].rating
                        )
                        : null,

                average_rating:
                    Number(
                        aggregate.rows[0].average_rating || 0
                    ),

                rating_count:
                    Number(
                        aggregate.rows[0].rating_count || 0
                    )
            });

        } catch (error) {

            console.error(
                "GET audio chapter rating error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Failed to load audio rating."
            });
        }
    }
);


/*
=========================================================
SUBMIT / UPDATE AUDIO CHAPTER RATING
POST /api/audio/chapters/:chapterId/rating
=========================================================
*/

router.post(
    "/chapters/:chapterId/rating",
    auth,
    async (req, res) => {

        const client =
            await db.connect();

        try {

            const chapterId =
                Number(req.params.chapterId);

            const userId =
                Number(req.user.id);

            const rating =
                Number(req.body.rating);

            if (
                !Number.isInteger(chapterId) ||
                chapterId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid chapter ID."
                });
            }

            if (
                !Number.isInteger(rating) ||
                rating < 1 ||
                rating > 5
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Rating must be between 1 and 5."
                });
            }

            await client.query("BEGIN");

            const chapter =
                await client.query(`
                    SELECT id
                    FROM audio_chapters
                    WHERE
                        id = $1
                        AND is_published = TRUE
                        AND is_draft = FALSE
                `, [chapterId]);

            if (!chapter.rows.length) {

                await client.query("ROLLBACK");

                return res.status(404).json({
                    success: false,
                    message: "Audio chapter not found."
                });
            }

            await client.query(`
                INSERT INTO audio_chapter_ratings
                (
                    user_id,
                    chapter_id,
                    rating,
                    created_at,
                    updated_at
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    NOW(),
                    NOW()
                )
                ON CONFLICT (
                    user_id,
                    chapter_id
                )
                DO UPDATE SET
                    rating = EXCLUDED.rating,
                    updated_at = NOW()
            `, [
                userId,
                chapterId,
                rating
            ]);

            const aggregate =
                await client.query(`
                    SELECT
                        ROUND(
                            COALESCE(
                                AVG(rating),
                                0
                            ),
                            2
                        ) AS average_rating,
                        COUNT(*)::int AS rating_count
                    FROM audio_chapter_ratings
                    WHERE chapter_id = $1
                `, [chapterId]);

            await client.query("COMMIT");

            return res.json({
                success: true,
                rating,
                average_rating:
                    Number(
                        aggregate.rows[0].average_rating || 0
                    ),
                rating_count:
                    Number(
                        aggregate.rows[0].rating_count || 0
                    )
            });

        } catch (error) {

            await client.query("ROLLBACK");

            console.error(
                "POST audio chapter rating error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Failed to save audio rating."
            });

        } finally {

            client.release();
        }
    }
);

/*
=========================================================
GET AUDIO CHAPTER COMMENTS
GET /api/audio/chapters/:chapterId/comments
=========================================================
*/

router.get(
    "/chapters/:chapterId/comments",
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);

            if (
                !Number.isInteger(chapterId) ||
                chapterId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid chapter ID."
                });
            }

            const result =
                await db.query(`
                    SELECT
                        c.id,
                        c.chapter_id,
                        c.user_id,
                        c.comment,
                        c.created_at,
                        c.updated_at,
                        u.name
                    FROM audio_chapter_comments c
                    LEFT JOIN users u
                        ON u.id = c.user_id
                    WHERE c.chapter_id = $1
                    ORDER BY c.created_at DESC
                `, [chapterId]);

            return res.json({
                success: true,
                comments: result.rows
            });

        } catch (error) {

            console.error(
                "GET audio chapter comments error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Failed to load audio comments."
            });
        }
    }
);

/*
=========================================================
POST AUDIO CHAPTER COMMENT
POST /api/audio/chapters/:chapterId/comments
=========================================================
*/

router.post(
    "/chapters/:chapterId/comments",
    auth,
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);

            const userId =
                Number(req.user.id);

            const comment =
                String(
                    req.body.comment || ""
                ).trim();

            if (
                !Number.isInteger(chapterId) ||
                chapterId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid chapter ID."
                });
            }

            if (!comment) {
                return res.status(400).json({
                    success: false,
                    message: "Comment cannot be empty."
                });
            }

            if (comment.length > 2000) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Comment cannot exceed 2000 characters."
                });
            }

            const chapter =
                await db.query(`
                    SELECT id
                    FROM audio_chapters
                    WHERE
                        id = $1
                        AND is_published = TRUE
                        AND is_draft = FALSE
                `, [chapterId]);

            if (!chapter.rows.length) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Audio chapter not found."
                });
            }

            const result =
                await db.query(`
                    INSERT INTO audio_chapter_comments
                    (
                        chapter_id,
                        user_id,
                        comment,
                        created_at,
                        updated_at
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        NOW(),
                        NOW()
                    )
                    RETURNING
                        id,
                        chapter_id,
                        user_id,
                        comment,
                        created_at,
                        updated_at
                `, [
                    chapterId,
                    userId,
                    comment
                ]);

            const user =
                await db.query(`
                    SELECT
                        name
                    FROM users
                    WHERE id = $1
                `, [userId]);

            return res.status(201).json({

                success: true,

                comment: {
                    ...result.rows[0],

                    name:
                        user.rows[0]?.name || null
                }

            });

        } catch (error) {

            console.error(
                "POST audio chapter comment error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to add audio comment."
            });
        }
    }
);

/*
=========================================================
DELETE AUDIO CHAPTER COMMENT
DELETE /api/audio/chapters/:chapterId/comments/:commentId
=========================================================
*/

router.delete(
    "/chapters/:chapterId/comments/:commentId",
    auth,
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);

            const commentId =
                Number(req.params.commentId);

            const userId =
                Number(req.user.id);

            if (
                !Number.isInteger(chapterId) ||
                chapterId <= 0 ||
                !Number.isInteger(commentId) ||
                commentId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid comment ID."
                });
            }

            const result =
                await db.query(`
                    DELETE FROM audio_chapter_comments
                    WHERE
                        id = $1
                        AND chapter_id = $2
                        AND user_id = $3
                    RETURNING id
                `, [
                    commentId,
                    chapterId,
                    userId
                ]);

            if (!result.rows.length) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Comment not found or you cannot delete it."
                });
            }

            return res.json({
                success: true,
                message:
                    "Comment deleted successfully."
            });

        } catch (error) {

            console.error(
                "DELETE audio chapter comment error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to delete audio comment."
            });
        }
    }
);

/*
=========================================================
REPORT AUDIO CHAPTER COMMENT
POST /api/audio/comments/:commentId/report
=========================================================
*/

router.post(
    "/comments/:commentId/report",
    auth,
    async (req, res) => {

        try {

            const commentId =
                Number(req.params.commentId);

            const reporterUserId =
                Number(req.user.id);

            const reason =
                String(
                    req.body.reason || ""
                ).trim();

            if (
                !Number.isInteger(commentId) ||
                commentId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid comment ID."
                });
            }

            if (!reason) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please provide a report reason."
                });
            }

            if (reason.length > 1000) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Report reason cannot exceed 1000 characters."
                });
            }


            /*
            ---------------------------------------------
            VERIFY COMMENT
            ---------------------------------------------
            */

            const comment =
                await db.query(`
                    SELECT
                        id,
                        chapter_id,
                        user_id
                    FROM audio_chapter_comments
                    WHERE id = $1
                    LIMIT 1
                `, [commentId]);


            if (!comment.rows.length) {

                return res.status(404).json({
                    success: false,
                    message: "Comment not found."
                });

            }


            /*
            ---------------------------------------------
            PREVENT REPORTING OWN COMMENT
            ---------------------------------------------
            */

            if (
                Number(
                    comment.rows[0].user_id
                ) === reporterUserId
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "You cannot report your own comment."
                });

            }


            /*
            ---------------------------------------------
            PREVENT DUPLICATE REPORT
            ---------------------------------------------
            */

            const existing =
                await db.query(`
                    SELECT id
                    FROM audio_chapter_comment_reports
                    WHERE
                        comment_id = $1
                        AND reporter_user_id = $2
                    LIMIT 1
                `, [
                    commentId,
                    reporterUserId
                ]);


            if (existing.rows.length) {

                return res.status(409).json({
                    success: false,
                    message:
                        "You have already reported this comment."
                });

            }


            /*
            ---------------------------------------------
            CREATE REPORT
            ---------------------------------------------
            */

            const result =
                await db.query(`
                    INSERT INTO audio_chapter_comment_reports
                    (
                        comment_id,
                        reporter_user_id,
                        reason,
                        status,
                        created_at
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        'pending',
                        NOW()
                    )
                    RETURNING
                        id,
                        comment_id,
                        reporter_user_id,
                        reason,
                        status,
                        created_at
                `, [
                    commentId,
                    reporterUserId,
                    reason
                ]);


            return res.status(201).json({

                success: true,

                message:
                    "Comment reported successfully.",

                report:
                    result.rows[0]

            });


        } catch (error) {

            console.error(
                "POST audio comment report error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to report audio comment."
            });

        }

    }
);


module.exports = router;