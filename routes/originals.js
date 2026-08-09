const express = require("express");
const router = express.Router();

const db = require("../db");

const {
    S3Client,
    GetObjectCommand
} = require("@aws-sdk/client-s3");

const {
    getSignedUrl
} = require("@aws-sdk/s3-request-presigner");

const b2S3 = new S3Client({

    region:
        process.env.B2_REGION,

    endpoint:
        process.env.B2_ENDPOINT,

    credentials: {

        accessKeyId:
            process.env.B2_KEY_ID,

        secretAccessKey:
            process.env.B2_APPLICATION_KEY

    },

    forcePathStyle: true

});

/* =========================================================
   GET ALL PUBLISHED ORIGINALS
   GET /api/originals
   Supports:
   ?search=
   ?language=
   ?category=
========================================================= */

router.get("/", async (req, res) => {

    try {

        const {
            search,
            language,
            category
        } = req.query;

        const conditions = [
            "publish_status = 'published'",
            "visibility = 'public'"
        ];

        const values = [];

        if (search && search.trim()) {

            values.push(`%${search.trim()}%`);

            conditions.push(`
                (
                    title ILIKE $${values.length}
                    OR description ILIKE $${values.length}
                )
            `);

        }

        if (language && language.trim()) {

            values.push(language.trim());

            conditions.push(
                `language = $${values.length}`
            );

        }

        if (category && category.trim()) {

            values.push(category.trim());

            conditions.push(
                `category = $${values.length}`
            );

        }

        const result = await db.query(`
            SELECT
                id,
                title,
                description,
                cover_url,
                language,
                category,
                categories,
                content_type,
                status,
                premium_only,
                featured,
                views,
                likes,
                rating,
                release_date,
                created_at
            FROM originals
            WHERE ${conditions.join(" AND ")}
            ORDER BY
                featured DESC,
                release_date DESC NULLS LAST,
                created_at DESC
        `, values);

        res.json({
            success: true,
            originals: result.rows
        });

    } catch (err) {

        console.error(
            "Originals API error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load MyLikith Originals."
        });

    }

});


/* =========================================================
   GET FEATURED ORIGINALS
   GET /api/originals/featured
========================================================= */

router.get("/featured", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT
                id,
                title,
                description,
                cover_url,
                language,
                category,
                categories,
                content_type,
                status,
                premium_only,
                featured,
                views,
                likes,
                rating,
                release_date,
                created_at
            FROM originals
            WHERE
                publish_status = 'published'
                AND visibility = 'public'
                AND featured = TRUE
            ORDER BY
                release_date DESC NULLS LAST,
                created_at DESC
        `);

        res.json({
            success: true,
            originals: result.rows
        });

    } catch (err) {

        console.error(
            "Featured Originals API error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load featured Originals."
        });

    }

});

/* =========================================================
   GET SINGLE ORIGINAL CHAPTER LIST
   GET /api/originals/:id/chapters
========================================================= */

router.get("/:id/chapters", async (req, res) => {

    try {

        const originalId = Number(req.params.id);

        if (!Number.isInteger(originalId)) {

            return res.status(400).json({
                success: false,
                message: "Invalid Original ID."
            });

        }

        const original = await db.query(`
            SELECT
                id,
                title,
                premium_only,
                publish_status,
                visibility
            FROM originals
            WHERE id = $1
        `, [originalId]);

        if (!original.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Original not found."
            });

        }

        if (
            original.rows[0].publish_status.toLowerCase() !== "published" ||
            original.rows[0].visibility !== "public"
        ) {

            return res.status(404).json({
                success: false,
                message: "Original not available."
            });

        }

        const result = await db.query(`
            SELECT
                id,
                original_id,
                chapter_no,
                title,
                is_premium,
                coins_required,
                early_access,
                is_draft,
                is_published,
                publish_at,
                created_at
            FROM original_chapters
            WHERE
                original_id = $1
                AND is_draft = FALSE
                AND is_published = TRUE
                AND (
                    publish_at IS NULL
                    OR publish_at <= NOW()
                )
            ORDER BY chapter_no ASC
        `, [originalId]);

        res.json({
            success: true,
            original: original.rows[0],
            chapters: result.rows
        });

    } catch (err) {

        console.error(
            "Original chapters error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load Original chapters."
        });

    }

});


/* =========================================================
   GET SINGLE ORIGINAL CHAPTER
   GET /api/originals/chapter/:chapterId
========================================================= */

router.get("/chapter/:chapterId", async (req, res) => {

    try {

        const chapterId =
            Number(req.params.chapterId);

        if (!Number.isInteger(chapterId)) {

            return res.status(400).json({
                success: false,
                message: "Invalid chapter ID."
            });

        }

        const result = await db.query(`
            SELECT
                oc.id,
                oc.original_id,
                oc.chapter_no,
                oc.title,
                oc.content,
                oc.is_premium,
                oc.coins_required,
                oc.early_access,

                o.title AS original_title,
                o.premium_only,
                o.visibility,
                o.publish_status

            FROM original_chapters oc

            JOIN originals o
                ON o.id = oc.original_id

            WHERE
                oc.id = $1

                AND oc.is_draft = FALSE

                AND oc.is_published = TRUE

                AND (
                    oc.publish_at IS NULL
                    OR oc.publish_at <= NOW()
                )

                AND o.publish_status = 'published'

                AND o.visibility = 'public'
        `, [chapterId]);

        if (!result.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Chapter not found."
            });

        }

        const chapter = result.rows[0];

        /*
         * Premium access is checked by the frontend
         * using the existing MyLikith premium system.
         *
         * The content endpoint intentionally does not
         * expose premium content until we implement the
         * proper authenticated Originals access layer.
         */

        if (
            chapter.is_premium ||
            chapter.premium_only
        ) {

            return res.json({
                success: true,
                locked: true,

                chapter: {
                    id: chapter.id,
                    original_id: chapter.original_id,
                    chapter_no: chapter.chapter_no,
                    title: chapter.title,
                    is_premium: true,
                    coins_required: chapter.coins_required,
                    early_access: chapter.early_access,
                    original_title: chapter.original_title
                }
            });

        }

        res.json({
            success: true,
            locked: false,
            chapter
        });

    } catch (err) {

        console.error(
            "Original chapter error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load Original chapter."
        });

    }

});

/* =========================================================
   GET ORIGINAL VIDEO PLAYBACK URL
   GET /api/originals/chapter/:chapterId/video
========================================================= */

router.get(
    "/chapter/:chapterId/video",
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);


            if (!Number.isInteger(chapterId)) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid chapter ID."

                });

            }


            const result =
                await db.query(`

                    SELECT

                        oc.id,
                        oc.original_id,
                        oc.chapter_no,
                        oc.title,

                        oc.is_premium,
                        oc.coins_required,
                        oc.early_access,

                        oc.media_provider,
                        oc.media_object_key,
                        oc.media_mime_type,
                        oc.media_original_name,
                        oc.media_size_bytes,
                        oc.media_status,

                        o.title AS original_title,
                        o.publish_status,
                        o.visibility,
                        o.premium_only

                    FROM original_chapters oc

                    JOIN originals o
                        ON o.id = oc.original_id

                    WHERE
                        oc.id = $1

                        AND oc.is_draft = FALSE

                        AND oc.is_published = TRUE

                        AND (
                            oc.publish_at IS NULL
                            OR oc.publish_at <= NOW()
                        )

                        AND o.publish_status = 'published'

                        AND o.visibility = 'public'

                    LIMIT 1

                `, [
                    chapterId
                ]);


            if (!result.rows.length) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Episode not found or not available."

                });

            }


            const chapter =
                result.rows[0];


            /* -------------------------------------------------
               PREMIUM ACCESS
            ------------------------------------------------- */

            if (
                chapter.is_premium ||
                chapter.premium_only
            ) {

                return res.status(403).json({

                    success: false,

                    locked: true,

                    message:
                        "This episode requires premium access.",

                    chapter: {

                        id:
                            chapter.id,

                        original_id:
                            chapter.original_id,

                        chapter_no:
                            chapter.chapter_no,

                        title:
                            chapter.title,

                        is_premium:
                            true,

                        coins_required:
                            chapter.coins_required || 0,

                        original_title:
                            chapter.original_title

                    }

                });

            }


            /* -------------------------------------------------
               VIDEO CHECK
            ------------------------------------------------- */

            if (
                chapter.media_provider !== "b2"
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Video is not available."

                });

            }


            if (
                !chapter.media_object_key
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Video file is not available."

                });

            }


            if (
                String(
                    chapter.media_status || ""
                ).toLowerCase() !==
                "ready"
            ) {

                return res.status(409).json({

                    success: false,

                    message:
                        "Video is still processing."

                });

            }


            /* -------------------------------------------------
               CREATE TEMPORARY B2 SIGNED URL
            ------------------------------------------------- */

            const command =
                new GetObjectCommand({

                    Bucket:
                        process.env.B2_BUCKET_NAME,

                    Key:
                        chapter.media_object_key

                });


            const signedUrl =
                await getSignedUrl(
                    b2S3,
                    command,
                    {
                        expiresIn:
                            900
                    }
                );


            res.json({

                success: true,

                locked: false,

                url:
                    signedUrl,

                expires_in:
                    900,

                chapter: {

                    id:
                        chapter.id,

                    original_id:
                        chapter.original_id,

                    chapter_no:
                        chapter.chapter_no,

                    title:
                        chapter.title,

                    original_title:
                        chapter.original_title,

                    mime_type:
                        chapter.media_mime_type ||
                        "video/mp4",

                    original_name:
                        chapter.media_original_name,

                    size_bytes:
                        chapter.media_size_bytes

                }

            });


        } catch (err) {

            console.error(
                "Original video playback error:",
                err
            );

            res.status(500).json({

                success: false,

                message:
                    "Unable to prepare video playback."

            });

        }

    }
);

/* =========================================================
   GET SINGLE ORIGINAL
   GET /api/originals/:id
========================================================= */

router.get("/:id", async (req, res) => {

    try {

        const originalId = Number(req.params.id);

        if (!Number.isInteger(originalId)) {

            return res.status(400).json({
                success: false,
                message: "Invalid Original ID."
            });

        }

        const result = await db.query(`
            SELECT
                id,
                title,
                description,
                cover_url,
                language,
                category,
                categories,
                content_type,
                status,
                premium_only,
                featured,
                views,
                likes,
                rating,
                release_date,
                created_at
            FROM originals
            WHERE
                id = $1
                AND publish_status = 'published'
                AND visibility = 'public'
        `, [originalId]);

        if (!result.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Original not found."
            });

        }

        res.json({
            success: true,
            original: result.rows[0]
        });

    } catch (err) {

        console.error(
            "Original detail error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load Original."
        });

    }

});



module.exports = router;