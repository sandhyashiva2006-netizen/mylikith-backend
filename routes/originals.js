const express = require("express");
const router = express.Router();

const db = require("../db");
const jwt = require("jsonwebtoken");

const auth = require("../middleware/auth");

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

function getOptionalUserId(req) {

    const authHeader =
        req.headers.authorization;

    if (
        !authHeader ||
        !authHeader.startsWith("Bearer ")
    ) {
        return null;
    }

    const token =
        authHeader.split(" ")[1];

    try {

        const decoded =
            jwt.verify(
                token,
                process.env.JWT_SECRET
            );

        return Number(decoded.id);

    } catch (err) {

        return null;

    }

}

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
   UNLOCK PREMIUM ORIGINAL EPISODE
   POST /api/originals/chapter/:chapterId/unlock
========================================================= */

router.post(
    "/chapter/:chapterId/unlock",
    auth,
    async (req, res) => {

        const client =
            await db.connect();

        try {

            await client.query(
                "BEGIN"
            );

            const chapterId =
                Number(
                    req.params.chapterId
                );

            const userId =
                Number(
                    req.user.id
                );

            if (
                !Number.isInteger(chapterId) ||
                chapterId < 1
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid chapter ID."
                });

            }

            if (
                !Number.isInteger(userId) ||
                userId < 1
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return res.status(401).json({
                    success: false,
                    message:
                        "Authentication required."
                });

            }


            /* -------------------------------------------------
               GET EPISODE
            ------------------------------------------------- */

            const chapterResult =
                await client.query(
                    `
                    SELECT
                        oc.id,
                        oc.original_id,
                        oc.chapter_no,
                        oc.title,
                        oc.is_premium,
                        oc.coins_required,
                        oc.early_access,

                        o.title AS original_title,
                        o.premium_only,
                        o.publish_status,
                        o.visibility

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
                    `,
                    [chapterId]
                );


            if (
                chapterResult.rows.length === 0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return res.status(404).json({
                    success: false,
                    message:
                        "Episode not found or not available."
                });

            }


            const chapter =
                chapterResult.rows[0];


            /* -------------------------------------------------
               FREE EPISODE
            ------------------------------------------------- */

            if (
                !chapter.is_premium &&
                !chapter.premium_only
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return res.json({
                    success: true,
                    unlocked: true,
                    premium: false,
                    coins_paid: 0
                });

            }


            /* -------------------------------------------------
               PREMIUM MEMBERSHIP CHECK
            ------------------------------------------------- */

            const premiumResult =
                await client.query(
                    `
                    SELECT id

                    FROM user_premium

                    WHERE
                        user_id = $1

                        AND status = 'Active'

                        AND expiry_date > NOW()

                    LIMIT 1
                    `,
                    [userId]
                );


            const isPremiumMember =
                premiumResult.rows.length > 0;


            if (isPremiumMember) {

                await client.query(
                    "ROLLBACK"
                );

                return res.json({
                    success: true,
                    unlocked: true,
                    premium: true,
                    coins_paid: 0
                });

            }


            /* -------------------------------------------------
               CHECK EXISTING UNLOCK
            ------------------------------------------------- */

            const existingUnlock =
                await client.query(
                    `
                    SELECT
                        id,
                        coins_paid,
                        unlocked_at

                    FROM original_chapter_unlocks

                    WHERE
                        user_id = $1

                        AND chapter_id = $2

                    LIMIT 1
                    `,
                    [
                        userId,
                        chapterId
                    ]
                );


            if (
                existingUnlock.rows.length > 0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return res.json({
                    success: true,
                    unlocked: true,
                    premium: false,
                    already_unlocked: true,
                    coins_paid:
                        Number(
                            existingUnlock
                                .rows[0]
                                .coins_paid
                        )
                });

            }


            const coinsRequired =
                Math.max(
                    0,
                    Number(
                        chapter.coins_required || 0
                    )
                );


            if (coinsRequired <= 0) {

                await client.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    success: false,
                    message:
                        "This premium episode has an invalid coin price."
                });

            }


            /* -------------------------------------------------
               LOCK WALLET ROW
            ------------------------------------------------- */

            const walletResult =
                await client.query(
                    `
                    SELECT
                        id,
                        coins,
                        earned_coins,
                        spent_coins

                    FROM wallets

                    WHERE user_id = $1

                    FOR UPDATE
                    `,
                    [userId]
                );


            if (
                walletResult.rows.length === 0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    success: false,
                    message:
                        "Wallet not found."
                });

            }


            const wallet =
                walletResult.rows[0];

            const currentCoins =
                Number(
                    wallet.coins || 0
                );


            /* -------------------------------------------------
               BALANCE CHECK
            ------------------------------------------------- */

            if (
                currentCoins <
                coinsRequired
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    success: false,
                    message:
                        "Not enough coins.",
                    coins_required:
                        coinsRequired,
                    coins_balance:
                        currentCoins
                });

            }


            /* -------------------------------------------------
               DEDUCT COINS
            ------------------------------------------------- */

            const updatedWallet =
                await client.query(
                    `
                    UPDATE wallets

                    SET
                        coins =
                            coins - $1,

                        spent_coins =
                            spent_coins + $1

                    WHERE
                        user_id = $2

                    RETURNING
                        coins
                    `,
                    [
                        coinsRequired,
                        userId
                    ]
                );


            const newBalance =
                Number(
                    updatedWallet
                        .rows[0]
                        .coins
                );


            /* -------------------------------------------------
               WALLET TRANSACTION
            ------------------------------------------------- */

            await client.query(
                `
                INSERT INTO wallet_transactions
                (
                    wallet_id,
                    user_id,
                    type,
                    coins,
                    amount,
                    description,
                    reference_id
                )

                VALUES
                (
                    $1,
                    $2,
                    'Debit',
                    $3,
                    0,
                    'Original Episode Unlock',
                    $4
                )
                `,
                [
                    wallet.id,
                    userId,
                    coinsRequired,
                    `original_chapter:${chapterId}`
                ]
            );


            /* -------------------------------------------------
               RECORD ORIGINAL EPISODE UNLOCK
            ------------------------------------------------- */

            await client.query(
                `
                INSERT INTO original_chapter_unlocks
                (
                    user_id,
                    chapter_id,
                    coins_paid
                )

                VALUES
                (
                    $1,
                    $2,
                    $3
                )
                `,
                [
                    userId,
                    chapterId,
                    coinsRequired
                ]
            );


            await client.query(
                "COMMIT"
            );


            res.json({
                success: true,
                unlocked: true,
                premium: false,
                already_unlocked: false,
                coins_paid:
                    coinsRequired,
                coins_balance:
                    newBalance
            });

        } catch (err) {

            await client.query(
                "ROLLBACK"
            );

            console.error(
                "Original episode unlock error:",
                err
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to unlock episode."
            });

        } finally {

            client.release();

        }

    }
);

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

    const userId =
        getOptionalUserId(req);


    /* ---------------------------------------------
       NO LOGIN
    --------------------------------------------- */

    if (!userId) {

        return res.status(403).json({

            success: false,

            locked: true,

            requires_login: true,

            message:
                "Please login to watch this premium episode.",

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
                    Number(
                        chapter.coins_required || 0
                    ),

                original_title:
                    chapter.original_title

            }

        });

    }


    /* ---------------------------------------------
       PREMIUM MEMBERSHIP
    --------------------------------------------- */

    const premiumResult =
        await db.query(
            `
            SELECT id

            FROM user_premium

            WHERE
                user_id = $1

                AND status = 'Active'

                AND expiry_date > NOW()

            LIMIT 1
            `,
            [userId]
        );


    const isPremiumMember =
        premiumResult.rows.length > 0;


    if (isPremiumMember) {

        // Premium members can watch directly.

    } else {

        /* -----------------------------------------
           CHECK ORIGINAL EPISODE UNLOCK
        ----------------------------------------- */

        const unlockResult =
            await db.query(
                `
                SELECT id

                FROM original_chapter_unlocks

                WHERE
                    user_id = $1

                    AND chapter_id = $2

                LIMIT 1
                `,
                [
                    userId,
                    chapter.id
                ]
            );


        if (
            unlockResult.rows.length === 0
        ) {

            return res.status(403).json({

                success: false,

                locked: true,

                requires_login: false,

                message:
                    "This episode requires coins to unlock.",

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
                        Number(
                            chapter.coins_required || 0
                        ),

                    original_title:
                        chapter.original_title

                }

            });

        }

    }

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

/* =========================================================
   SAVE ORIGINAL EPISODE READING PROGRESS
   POST /api/originals/chapter/:chapterId/progress
========================================================= */

router.post(
    "/chapter/:chapterId/progress",
    auth,
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);

            const userId =
                Number(req.user.id);

            const progress =
                Number(req.body.progress_percent);


            if (
                !Number.isInteger(chapterId) ||
                chapterId < 1
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid chapter ID."
                });

            }


            if (
                !Number.isInteger(userId) ||
                userId < 1
            ) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Authentication required."
                });

            }


            if (
                !Number.isFinite(progress)
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid progress."
                });

            }


            const progressPercent =
                Math.min(
                    100,
                    Math.max(
                        0,
                        Math.round(progress)
                    )
                );


            const chapterResult =
                await db.query(
                    `
                    SELECT id
                    FROM original_chapters
                    WHERE
                        id = $1
                        AND is_draft = FALSE
                        AND is_published = TRUE
                    LIMIT 1
                    `,
                    [chapterId]
                );


            if (
                chapterResult.rows.length === 0
            ) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Episode not found."
                });

            }


            await db.query(
                `
                INSERT INTO original_reading_progress
                (
                    user_id,
                    chapter_id,
                    progress_percent,
                    updated_at
                )

                VALUES
                (
                    $1,
                    $2,
                    $3,
                    NOW()
                )

                ON CONFLICT
                (
                    user_id,
                    chapter_id
                )

                DO UPDATE SET
                    progress_percent =
                        EXCLUDED.progress_percent,
                    updated_at =
                        NOW()
                `,
                [
                    userId,
                    chapterId,
                    progressPercent
                ]
            );


            res.json({
                success: true,
                progress_percent:
                    progressPercent
            });


        } catch (err) {

            console.error(
                "Original progress save error:",
                err
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to save episode progress."
            });

        }

    }
);

/* =========================================================
   GET ORIGINAL EPISODE READING PROGRESS
   GET /api/originals/chapter/:chapterId/progress
========================================================= */

router.get(
    "/chapter/:chapterId/progress",
    auth,
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);

            const userId =
                Number(req.user.id);


            if (
                !Number.isInteger(chapterId) ||
                chapterId < 1
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid chapter ID."
                });

            }


            if (
                !Number.isInteger(userId) ||
                userId < 1
            ) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Authentication required."
                });

            }


            const result =
                await db.query(
                    `
                    SELECT
                        progress_percent,
                        updated_at

                    FROM original_reading_progress

                    WHERE
                        user_id = $1
                        AND chapter_id = $2

                    LIMIT 1
                    `,
                    [
                        userId,
                        chapterId
                    ]
                );


            if (
                result.rows.length === 0
            ) {

                return res.json({
                    success: true,
                    progress_percent: 0,
                    updated_at: null
                });

            }


            res.json({
                success: true,

                progress_percent:
                    Number(
                        result.rows[0]
                            .progress_percent || 0
                    ),

                updated_at:
                    result.rows[0]
                        .updated_at
            });


        } catch (err) {

            console.error(
                "Original progress fetch error:",
                err
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to load episode progress."
            });

        }

    }
);

module.exports = router;