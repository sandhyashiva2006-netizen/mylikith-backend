const express = require("express");
const router = express.Router();

const db = require("../db");
const auth = require("../middleware/auth");
const axios = require("axios");

const {
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    HeadObjectCommand,
    PutBucketCorsCommand,
    GetBucketCorsCommand
} = require("@aws-sdk/client-s3");;

const {
    getSignedUrl
} = require("@aws-sdk/s3-request-presigner");

/* =========================================================
   BACKBLAZE B2 S3 CLIENT
========================================================= */

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
   ADMIN AUTHENTICATION
========================================================= */

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

/* =========================================================
   B2 CONNECTION TEST
   GET /api/admin/originals/b2-test
========================================================= */

router.get("/b2-test", async (req, res) => {

    try {

        const keyId =
            process.env.B2_KEY_ID;

        const applicationKey =
            process.env.B2_APPLICATION_KEY;


        if (!keyId || !applicationKey) {

            return res.status(500).json({
                success: false,
                message:
                    "Backblaze B2 environment variables are missing."
            });

        }


        const credentials =
            Buffer
                .from(
                    `${keyId}:${applicationKey}`
                )
                .toString("base64");


        /* -------------------------------------------------
           AUTHORIZE B2 ACCOUNT
        ------------------------------------------------- */

const authResponse =
    await axios.get(
        "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
        {
            headers: {
                Authorization:
                    `Basic ${credentials}`
            }
        }
    );

const b2 = authResponse.data;


        if (!b2.authorizationToken) {

            return res.status(502).json({
                success: false,
                message:
                    "Backblaze authorization failed."
            });

        }


        /* -------------------------------------------------
           VERIFY ACCESS TO OUR BUCKET
        ------------------------------------------------- */

const bucketResponse =
    await axios.get(
        `${b2.apiInfo.storageApi.apiUrl}/b2api/v4/b2_list_buckets`,
        {
            params: {
                accountId: b2.accountId,
                bucketName: process.env.B2_BUCKET_NAME
            },
            headers: {
                Authorization:
                    b2.authorizationToken
            }
        }
    );

const buckets =
    bucketResponse.data.buckets || [];

const ourBucket =
    buckets.find(
        bucket =>
            bucket.bucketName ===
            process.env.B2_BUCKET_NAME
    );

if (!ourBucket) {

    return res.status(403).json({
        success: false,
        message:
            "B2 connected, but the MyLikith Originals bucket was not accessible."
    });

}


        res.json({

            success: true,

            message:
                "Backblaze B2 connection successful.",

            bucket: {

                name:
                    ourBucket.bucketName,

                type:
                    ourBucket.bucketType,

                bucketId:
                    ourBucket.bucketId

            }

        });


    } catch (err) {

        console.error(
            "B2 connection test error:",
            err.response?.data ||
            err.message
        );


        res.status(500).json({

            success: false,

            message:
                "Unable to connect to Backblaze B2."

        });

    }

});


/* =========================================================
   START B2 MULTIPART UPLOAD

   POST /api/admin/originals/chapters/:chapterId/media/start
========================================================= */

router.post(
    "/chapters/:chapterId/media/start",
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);

            const {
                file_name,
                mime_type,
                file_size
            } = req.body;


            if (!Number.isInteger(chapterId)) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid chapter ID."
                });

            }


            if (!file_name || !mime_type) {

                return res.status(400).json({
                    success: false,
                    message:
                        "File name and MIME type are required."
                });

            }


            if (
                !Number.isFinite(Number(file_size)) ||
                Number(file_size) <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid file size."
                });

            }


            const chapter =
                await db.query(`

                    SELECT
                        oc.id,
                        oc.original_id,
                        o.title AS original_title

                    FROM original_chapters oc

                    JOIN originals o
                        ON o.id = oc.original_id

                    WHERE oc.id = $1

                `, [
                    chapterId
                ]);


            if (!chapter.rows.length) {

                return res.status(404).json({
                    success: false,
                    message: "Chapter not found."
                });

            }


            const safeName =
                file_name
                    .replace(/[^a-zA-Z0-9._-]/g, "_");


            const objectKey =
                `originals/${chapter.rows[0].original_id}/chapters/${chapterId}/${Date.now()}-${safeName}`;


            const command =
                new CreateMultipartUploadCommand({

                    Bucket:
                        process.env.B2_BUCKET_NAME,

                    Key:
                        objectKey,

                    ContentType:
                        mime_type

                });


            const upload =
                await b2S3.send(command);


            if (!upload.UploadId) {

                throw new Error(
                    "B2 did not return a multipart upload ID."
                );

            }


            await db.query(`

                UPDATE original_chapters

                SET
                    media_type = 'video',
                    media_provider = 'b2',
                    media_object_key = $1,
                    media_original_name = $2,
                    media_mime_type = $3,
                    media_size_bytes = $4,
                    media_status = 'uploading',
                    media_uploaded_at = NULL,
                    updated_at = NOW()

                WHERE id = $5

            `, [

                objectKey,
                file_name,
                mime_type,
                Number(file_size),
                chapterId

            ]);


            res.json({

                success: true,

                upload_id:
                    upload.UploadId,

                object_key:
                    objectKey,

                chapter_id:
                    chapterId,

                part_size:
                    10 * 1024 * 1024

            });


        } catch (err) {

            console.error(
                "B2 multipart start error:",
                err
            );


            res.status(500).json({

                success: false,

                message:
                    "Unable to start video upload."

            });

        }

    }
);

/* =========================================================
   SIGN ONE MULTIPART PART

   POST /api/admin/originals/chapters/:chapterId/media/sign-part
========================================================= */

router.post(
    "/chapters/:chapterId/media/sign-part",
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);

            const {
                upload_id,
                object_key,
                part_number
            } = req.body;


            if (!Number.isInteger(chapterId)) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid chapter ID."
                });

            }


            if (
                !upload_id ||
                !object_key ||
                !Number.isInteger(Number(part_number)) ||
                Number(part_number) < 1
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Upload ID, object key and part number are required."
                });

            }


            const chapter =
                await db.query(`

                    SELECT id

                    FROM original_chapters

                    WHERE
                        id = $1
                        AND media_provider = 'b2'
                        AND media_object_key = $2

                `, [

                    chapterId,
                    object_key

                ]);


            if (!chapter.rows.length) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Upload session not found."
                });

            }


            const command =
                new UploadPartCommand({

                    Bucket:
                        process.env.B2_BUCKET_NAME,

                    Key:
                        object_key,

                    UploadId:
                        upload_id,

                    PartNumber:
                        Number(part_number)

                });


            const signedUrl =
                await getSignedUrl(
                    b2S3,
                    command,
                    {
                        expiresIn: 900
                    }
                );


            res.json({

                success: true,

                url:
                    signedUrl,

                expires_in:
                    900

            });


        } catch (err) {

            console.error(
                "B2 sign part error:",
                err
            );


            res.status(500).json({

                success: false,

                message:
                    "Unable to create upload URL."

            });

        }

    }
);

/* =========================================================
   COMPLETE B2 MULTIPART UPLOAD

   POST /api/admin/originals/chapters/:chapterId/media/complete
========================================================= */

router.post(
    "/chapters/:chapterId/media/complete",
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);

            const {
                upload_id,
                object_key,
                parts
            } = req.body;


            if (!Number.isInteger(chapterId)) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid chapter ID."
                });

            }


            if (
                !upload_id ||
                !object_key ||
                !Array.isArray(parts) ||
                !parts.length
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Upload ID, object key and uploaded parts are required."
                });

            }


            /* -------------------------------------------------
               VERIFY CHAPTER / UPLOAD SESSION
            ------------------------------------------------- */

            const chapter =
                await db.query(`

                    SELECT
                        id,
                        media_object_key,
                        media_size_bytes

                    FROM original_chapters

                    WHERE
                        id = $1
                        AND media_provider = 'b2'
                        AND media_object_key = $2

                `, [

                    chapterId,
                    object_key

                ]);


            if (!chapter.rows.length) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Upload session not found."
                });

            }


            /* -------------------------------------------------
               NORMALIZE PARTS
            ------------------------------------------------- */

            const normalizedParts =
                parts
                    .map(part => ({

                        ETag:
                            part.etag ||
                            part.ETag,

                        PartNumber:
                            Number(
                                part.part_number ||
                                part.PartNumber
                            )

                    }))
                    .filter(
                        part =>
                            part.ETag &&
                            Number.isInteger(
                                part.PartNumber
                            )
                    )
                    .sort(
                        (a, b) =>
                            a.PartNumber -
                            b.PartNumber
                    );


            if (!normalizedParts.length) {

                return res.status(400).json({
                    success: false,
                    message:
                        "No valid uploaded parts were provided."
                });

            }


            /* -------------------------------------------------
               COMPLETE MULTIPART UPLOAD
            ------------------------------------------------- */

            const completeCommand =
                new CompleteMultipartUploadCommand({

                    Bucket:
                        process.env.B2_BUCKET_NAME,

                    Key:
                        object_key,

                    UploadId:
                        upload_id,

                    MultipartUpload: {

                        Parts:
                            normalizedParts

                    }

                });


            await b2S3.send(
                completeCommand
            );


            /* -------------------------------------------------
               VERIFY OBJECT EXISTS
            ------------------------------------------------- */

            const headCommand =
                new HeadObjectCommand({

                    Bucket:
                        process.env.B2_BUCKET_NAME,

                    Key:
                        object_key

                });


            const head =
                await b2S3.send(
                    headCommand
                );


            /* -------------------------------------------------
               MARK MEDIA READY
            ------------------------------------------------- */

            await db.query(`

                UPDATE original_chapters

                SET
                    media_status = 'ready',
                    media_size_bytes =
                        COALESCE($1, media_size_bytes),
                    media_uploaded_at = NOW(),
                    updated_at = NOW()

                WHERE
                    id = $2
                    AND media_object_key = $3

            `, [

                head.ContentLength || null,
                chapterId,
                object_key

            ]);


            res.json({

                success: true,

                message:
                    "Video uploaded successfully.",

                chapter_id:
                    chapterId,

                object_key:
                    object_key,

                size_bytes:
                    head.ContentLength || null,

                content_type:
                    head.ContentType || null

            });


        } catch (err) {

            console.error(
                "B2 multipart complete error:",
                err
            );


            res.status(500).json({

                success: false,

                message:
                    "Unable to complete video upload."

            });

        }

    }
);

/* =========================================================
   ABORT B2 MULTIPART UPLOAD

   POST /api/admin/originals/chapters/:chapterId/media/abort
========================================================= */

router.post(
    "/chapters/:chapterId/media/abort",
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);

            const {
                upload_id,
                object_key
            } = req.body;


            if (!Number.isInteger(chapterId)) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid chapter ID."
                });

            }


            if (
                !upload_id ||
                !object_key
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Upload ID and object key are required."
                });

            }


            const chapter =
                await db.query(`

                    SELECT id

                    FROM original_chapters

                    WHERE
                        id = $1
                        AND media_object_key = $2

                `, [

                    chapterId,
                    object_key

                ]);


            if (!chapter.rows.length) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Upload session not found."
                });

            }


            const abortCommand =
                new AbortMultipartUploadCommand({

                    Bucket:
                        process.env.B2_BUCKET_NAME,

                    Key:
                        object_key,

                    UploadId:
                        upload_id

                });


            await b2S3.send(
                abortCommand
            );


            await db.query(`

                UPDATE original_chapters

                SET
                    media_status = 'pending',
                    media_object_key = NULL,
                    media_original_name = NULL,
                    media_mime_type = NULL,
                    media_size_bytes = NULL,
                    media_uploaded_at = NULL,
                    updated_at = NOW()

                WHERE id = $1

            `, [
                chapterId
            ]);


            res.json({

                success: true,

                message:
                    "Video upload cancelled."

            });


        } catch (err) {

            console.error(
                "B2 multipart abort error:",
                err
            );


            res.status(500).json({

                success: false,

                message:
                    "Unable to cancel video upload."

            });

        }

    }
);

/* =========================================================
   GET ALL ORIGINALS
   GET /api/admin/originals
========================================================= */

router.get("/", async (req, res) => {
    try {

        const result = await db.query(`
            SELECT
                o.*,
                COUNT(oc.id)::INTEGER AS chapter_count
            FROM originals o
            LEFT JOIN original_chapters oc
                ON oc.original_id = o.id
            GROUP BY o.id
            ORDER BY o.created_at DESC
        `);

        res.json({
            success: true,
            originals: result.rows
        });

    } catch (err) {

        console.error(
            "Admin Originals GET error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load Originals.",
            error: err.message,
            detail: err.detail || null,
            code: err.code || null
        });
    }
});

/* =========================================================
   GET ORIGINAL COMMENT REPORTS
   GET /api/admin/originals/comment-reports
========================================================= */

router.get(
    "/comment-reports",
    async (req, res) => {

        try {

            const result =
                await db.query(`
                    SELECT

                        r.id AS report_id,

                        r.comment_id,

                        r.reason AS report_reason,

                        r.created_at AS reported_at,


                        c.comment,

                        c.created_at AS comment_created_at,


                        o.id AS original_id,

                        o.title AS original_title,


                        commenter.id AS commenter_id,

                        commenter.name AS commenter_name,

                        commenter.email AS commenter_email,


                        reporter.id AS reporter_id,

                        reporter.name AS reporter_name,

                        reporter.email AS reporter_email


                    FROM original_comment_reports r


                    JOIN original_comments c
                        ON c.id = r.comment_id


                    JOIN originals o
                        ON o.id = c.original_id


                    JOIN users commenter
                        ON commenter.id = c.user_id


                    JOIN users reporter
                        ON reporter.id = r.user_id


                    ORDER BY
                        r.created_at DESC,

                        r.id DESC
                `);


            res.json({

                success: true,

                reports:
                    result.rows

            });


        } catch (err) {

            console.error(
                "Admin Original comment reports GET error:",
                err
            );


            res.status(500).json({

                success: false,

                message:
                    "Unable to load comment reports."

            });

        }

    }
);

/* =========================================================
   DELETE ORIGINAL COMMENT — ADMIN MODERATION

   DELETE
   /api/admin/originals/comment-reports/:reportId/comment
========================================================= */

router.delete(
    "/comment-reports/:reportId/comment",
    async (req, res) => {

        const client =
            await db.connect();

        try {

            const reportId =
                Number(
                    req.params.reportId
                );


            if (
                !Number.isInteger(
                    reportId
                ) ||
                reportId <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid report ID."

                });

            }


            await client.query(
                "BEGIN"
            );


            const reportResult =
                await client.query(
                    `
                    SELECT
                        r.id,
                        r.comment_id
                    FROM original_comment_reports r
                    WHERE r.id = $1
                    FOR UPDATE
                    `,
                    [reportId]
                );


            if (
                reportResult.rows.length === 0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return res.status(404).json({

                    success: false,

                    message:
                        "Report not found."

                });

            }


            const commentId =
                reportResult.rows[0]
                    .comment_id;


            /*
             * Delete reports first.
             * This keeps the operation safe even if
             * the report table does not use ON DELETE CASCADE.
             */

            await client.query(
                `
                DELETE FROM
                    original_comment_reports
                WHERE comment_id = $1
                `,
                [commentId]
            );


            const commentResult =
                await client.query(
                    `
                    DELETE FROM
                        original_comments
                    WHERE id = $1
                    RETURNING id
                    `,
                    [commentId]
                );


            if (
                commentResult.rows.length === 0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return res.status(404).json({

                    success: false,

                    message:
                        "Comment no longer exists."

                });

            }


            await client.query(
                "COMMIT"
            );


            res.json({

                success: true,

                message:
                    "Comment deleted successfully.",

                comment_id:
                    commentId

            });


        } catch (error) {

            try {

                await client.query(
                    "ROLLBACK"
                );

            } catch (
                rollbackError
            ) {

                console.error(
                    "Rollback error:",
                    rollbackError
                );

            }


            console.error(
                "Admin Original comment delete error:",
                error
            );


            res.status(500).json({

                success: false,

                message:
                    "Unable to delete comment."

            });


        } finally {

            client.release();

        }

    }
);

/* =========================================================
   DISMISS ORIGINAL COMMENT REPORT

   DELETE
   /api/admin/originals/comment-reports/:reportId
========================================================= */

router.delete(
    "/comment-reports/:reportId",
    async (req, res) => {

        try {

            const reportId =
                Number(
                    req.params.reportId
                );


            if (
                !Number.isInteger(
                    reportId
                ) ||
                reportId <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid report ID."

                });

            }


            const result =
                await db.query(
                    `
                    DELETE FROM
                        original_comment_reports
                    WHERE id = $1

                    RETURNING
                        id,
                        comment_id
                    `,
                    [reportId]
                );


            if (
                result.rows.length === 0
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Report not found."

                });

            }


            res.json({

                success: true,

                message:
                    "Report dismissed successfully.",

                report_id:
                    result.rows[0].id,

                comment_id:
                    result.rows[0].comment_id

            });


        } catch (error) {

            console.error(
                "Admin Original report dismiss error:",
                error
            );


            res.status(500).json({

                success: false,

                message:
                    "Unable to dismiss report."

            });

        }

    }
);

/* =========================================================
   GET SINGLE ORIGINAL
   GET /api/admin/originals/:id
========================================================= */

router.get("/:id", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT *
            FROM originals
            WHERE id = $1
        `, [
            req.params.id
        ]);

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
            "Admin Original GET error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load Original."
        });

    }

});


/* =========================================================
   CREATE ORIGINAL
   POST /api/admin/originals
========================================================= */

router.post("/", async (req, res) => {

    try {

        const {
            title,
            description,
            cover_url,
            language,
            category,
            categories,
            content_type,
            status,
            publish_status,
            visibility,
            premium_only,
            featured,
            release_date
        } = req.body;


        if (!title || !title.trim()) {

            return res.status(400).json({
                success: false,
                message: "Original title is required."
            });

        }


        const result = await db.query(`
            INSERT INTO originals (
                title,
                description,
                cover_url,
                language,
                category,
                categories,
                content_type,
                status,
                publish_status,
                visibility,
                premium_only,
                featured,
                release_date,
                created_by
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
                $13,
                $14
            )
            RETURNING *
        `, [

            title.trim(),
            description || null,
            cover_url || null,
            language || null,
            category || null,
            Array.isArray(categories)
                ? categories
                : [],
            content_type || "story",
            status || "ongoing",
            publish_status || "draft",
            visibility || "private",
            Boolean(premium_only),
            Boolean(featured),
            release_date || null,
            req.user.id

        ]);


        res.status(201).json({
            success: true,
            message: "Original created successfully.",
            original: result.rows[0]
        });


    } catch (err) {

        console.error(
            "Admin Original CREATE error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to create Original."
        });

    }

});


/* =========================================================
   UPDATE ORIGINAL
   PUT /api/admin/originals/:id
========================================================= */

router.put("/:id", async (req, res) => {

    try {

        const {
            title,
            description,
            cover_url,
            language,
            category,
            categories,
            content_type,
            status,
            publish_status,
            visibility,
            premium_only,
            featured,
            release_date
        } = req.body;


        if (!title || !title.trim()) {

            return res.status(400).json({
                success: false,
                message: "Original title is required."
            });

        }


        const result = await db.query(`
            UPDATE originals
            SET
                title = $1,
                description = $2,
                cover_url = $3,
                language = $4,
                category = $5,
                categories = $6,
                content_type = $7,
                status = $8,
                publish_status = $9,
                visibility = $10,
                premium_only = $11,
                featured = $12,
                release_date = $13,
                updated_at = NOW()
            WHERE id = $14
            RETURNING *
        `, [

            title.trim(),
            description || null,
            cover_url || null,
            language || null,
            category || null,
            Array.isArray(categories)
                ? categories
                : [],
            content_type || "story",
            status || "ongoing",
            publish_status || "draft",
            visibility || "private",
            Boolean(premium_only),
            Boolean(featured),
            release_date || null,
            req.params.id

        ]);


        if (!result.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Original not found."
            });

        }


        res.json({
            success: true,
            message: "Original updated successfully.",
            original: result.rows[0]
        });


    } catch (err) {

        console.error(
            "Admin Original UPDATE error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to update Original."
        });

    }

});


/* =========================================================
   DELETE ORIGINAL
   DELETE /api/admin/originals/:id
========================================================= */

router.delete("/:id", async (req, res) => {

    try {

        const result = await db.query(`
            DELETE FROM originals
            WHERE id = $1
            RETURNING id, title
        `, [
            req.params.id
        ]);


        if (!result.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Original not found."
            });

        }


        res.json({
            success: true,
            message: "Original deleted successfully."
        });


    } catch (err) {

        console.error(
            "Admin Original DELETE error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to delete Original."
        });

    }

});


/* =========================================================
   GET CHAPTERS
   GET /api/admin/originals/:id/chapters
========================================================= */

router.get("/:id/chapters", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT *
            FROM original_chapters
            WHERE original_id = $1
            ORDER BY chapter_no ASC
        `, [
            req.params.id
        ]);


        res.json({
            success: true,
            chapters: result.rows
        });


    } catch (err) {

        console.error(
            "Admin Original chapters GET error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load chapters."
        });

    }

});


/* =========================================================
   CREATE CHAPTER / EPISODE
   POST /api/admin/originals/:id/chapters
========================================================= */

router.post("/:id/chapters", async (req, res) => {

    try {

        const {
            chapter_no,
            title,
            content,
            media_type,
            is_premium,
            coins_required,
            early_access,
            is_draft,
            is_published,
            publish_at
        } = req.body;


        /* -------------------------------------------------
           VALIDATE CHAPTER NUMBER
        ------------------------------------------------- */

        if (
            chapter_no === undefined ||
            chapter_no === null ||
            !Number.isInteger(Number(chapter_no)) ||
            Number(chapter_no) < 1
        ) {

            return res.status(400).json({
                success: false,
                message: "Valid chapter number is required."
            });

        }


        /* -------------------------------------------------
           VALIDATE MEDIA TYPE
        ------------------------------------------------- */

        const allowedMediaTypes = [
            "video",
            "audio",
            "text"
        ];

        const selectedMediaType =
            media_type || "video";


        if (
            !allowedMediaTypes.includes(
                selectedMediaType
            )
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Invalid media type. Allowed values: video, audio, text."
            });

        }


        /* -------------------------------------------------
           TEXT EPISODES REQUIRE CONTENT
        ------------------------------------------------- */

        if (
            selectedMediaType === "text" &&
            (
                !content ||
                !content.trim()
            )
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Content is required for text episodes."
            });

        }


        /* -------------------------------------------------
           VIDEO / AUDIO CONTENT IS OPTIONAL
        ------------------------------------------------- */

        const original =
            await db.query(`

                SELECT id

                FROM originals

                WHERE id = $1

            `, [
                req.params.id
            ]);


        if (!original.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Original not found."
            });

        }


        /* -------------------------------------------------
           CREATE EPISODE
        ------------------------------------------------- */

        const result =
            await db.query(`

                INSERT INTO original_chapters (
                    original_id,
                    chapter_no,
                    title,
                    content,
                    media_type,
                    is_premium,
                    coins_required,
                    early_access,
                    is_draft,
                    is_published,
                    publish_at
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
                    $11
                )

                RETURNING *

            `, [

                req.params.id,

                Number(chapter_no),

                title ||
                    `Episode ${Number(chapter_no)}`,

                content &&
                content.trim()
                    ? content.trim()
                    : null,

                selectedMediaType,

                Boolean(is_premium),

                Number(coins_required) || 0,

                Boolean(early_access),

                is_draft !== false,

                Boolean(is_published),

                publish_at || null

            ]);


        res.status(201).json({

            success: true,

            message:
                "Episode created successfully.",

            chapter:
                result.rows[0]

        });


    } catch (err) {

        console.error(
            "Admin Original chapter CREATE error:",
            err
        );


        if (err.code === "23505") {

            return res.status(409).json({
                success: false,
                message:
                    "That episode number already exists."
            });

        }


        res.status(500).json({

            success: false,

            message:
                "Unable to create episode."

        });

    }

});


/* =========================================================
   UPDATE CHAPTER
   PUT /api/admin/originals/:id/chapters/:chapterId
========================================================= */

router.put(
    "/:id/chapters/:chapterId",
    async (req, res) => {

        try {

            const {
                chapter_no,
                title,
                content,
                is_premium,
                coins_required,
                early_access,
                is_draft,
                is_published,
                publish_at
            } = req.body;


            if (
                chapter_no === undefined ||
                chapter_no === null ||
                !content ||
                !content.trim()
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Chapter number and content are required."
                });

            }


            const result = await db.query(`
                UPDATE original_chapters
                SET
                    chapter_no = $1,
                    title = $2,
                    content = $3,
                    is_premium = $4,
                    coins_required = $5,
                    early_access = $6,
                    is_draft = $7,
                    is_published = $8,
                    publish_at = $9,
                    updated_at = NOW()
                WHERE
                    id = $10
                    AND original_id = $11
                RETURNING *
            `, [

                Number(chapter_no),
                title ||
                    `Chapter ${Number(chapter_no)}`,
                content.trim(),
                Boolean(is_premium),
                Number(coins_required) || 0,
                Boolean(early_access),
                Boolean(is_draft),
                Boolean(is_published),
                publish_at || null,
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

            console.error(
                "Admin Original chapter UPDATE error:",
                err
            );

            if (err.code === "23505") {

                return res.status(409).json({
                    success: false,
                    message:
                        "That chapter number already exists."
                });

            }

            res.status(500).json({
                success: false,
                message: "Unable to update chapter."
            });

        }

    }
);


/* =========================================================
   DELETE CHAPTER
   DELETE /api/admin/originals/:id/chapters/:chapterId
========================================================= */

router.delete(
    "/:id/chapters/:chapterId",
    async (req, res) => {

        try {

            const result = await db.query(`
                DELETE FROM original_chapters
                WHERE
                    id = $1
                    AND original_id = $2
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

            console.error(
                "Admin Original chapter DELETE error:",
                err
            );

            res.status(500).json({
                success: false,
                message: "Unable to delete chapter."
            });

        }

    }
);



module.exports = router;