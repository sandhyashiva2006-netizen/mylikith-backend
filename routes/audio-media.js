const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");

const {
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    HeadObjectCommand,
    GetObjectCommand
} = require("@aws-sdk/client-s3");

const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const router = express.Router();

const jwt = require("jsonwebtoken");

function optionalAuth(req, res, next) {

    const authHeader =
        req.headers.authorization;

    if (
        !authHeader ||
        !authHeader.startsWith("Bearer ")
    ) {
        req.user = null;
        return next();
    }

    const token =
        authHeader.split(" ")[1];

    try {

        const decoded =
            jwt.verify(
                token,
                process.env.JWT_SECRET
            );

        req.user = decoded;

    } catch (err) {

        req.user = null;

    }

    next();
} 

const b2S3 = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.B2_KEY_ID,
        secretAccessKey: process.env.B2_APPLICATION_KEY
    },
    forcePathStyle: true
});

const PART_SIZE = 10 * 1024 * 1024;
const MAX_AUDIO_SIZE = 500 * 1024 * 1024;
const SIGNED_URL_EXPIRES = 900;



function getChapterId(req) {
    const chapterId = Number(req.params.chapterId);

    return Number.isInteger(chapterId) && chapterId > 0
        ? chapterId
        : null;
}

async function getAuthorizedChapter(chapterId, user) {

    const result = await db.query(`
        SELECT
            ac.id,
            ac.audio_novel_id,
            ac.audio_provider,
            ac.audio_object_key,
            ac.audio_status,
            ac.audio_upload_id,
            an.created_by,
            an.title AS audio_novel_title
        FROM audio_chapters ac
        JOIN audio_novels an
            ON an.id = ac.audio_novel_id
        WHERE ac.id = $1
    `, [chapterId]);

    if (!result.rows.length) {
        return {
            error: {
                status: 404,
                message: "Audio chapter not found."
            }
        };
    }

    const chapter = result.rows[0];

    if (
        user.role !== "admin" &&
        Number(chapter.created_by) !== Number(user.id)
    ) {
        return {
            error: {
                status: 403,
                message:
                    "You do not have permission to manage this audio chapter."
            }
        };
    }

    return {
        chapter
    };
}

/* =========================================================
   START AUDIO MULTIPART UPLOAD

   POST /api/audio/media/chapters/:chapterId/start
========================================================= */

router.post(
    "/chapters/:chapterId/start",
auth,
    async (req, res) => {

        try {

            const chapterId =
                getChapterId(req);

            if (!chapterId) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid chapter ID."
                });

            }

            const {
                file_name,
                mime_type,
                file_size
            } = req.body;

            const size =
                Number(file_size);

            const mime =
                String(
                    mime_type || ""
                ).toLowerCase();

            const fileName =
                String(
                    file_name || ""
                ).trim();

            if (
                !fileName ||
                !Number.isFinite(size) ||
                size <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "File name and valid file size are required."
                });

            }

            if (
                size >
                MAX_AUDIO_SIZE
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Audio file is too large. Maximum size is 500 MB."
                });

            }

            if (
                mime !== "audio/mpeg" ||
                !/\.mp3$/i.test(fileName)
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Only MP3 audio files are supported in Audio V1."
                });

            }

            const authorized =
                await getAuthorizedChapter(
                    chapterId,
                    req.user
                );

            if (authorized.error) {

                return res.status(
                    authorized.error.status
                ).json({
                    success: false,
                    message:
                        authorized.error.message
                });

            }

            const chapter =
                authorized.chapter;

            if (
                chapter.audio_status === "uploading" &&
                chapter.audio_upload_id
            ) {

                return res.status(409).json({
                    success: false,
                    message:
                        "An audio upload is already in progress for this chapter."
                });

            }

            const safeName =
                fileName.replace(
                    /[^a-zA-Z0-9._-]/g,
                    "_"
                );

            const objectKey =
                `audio/${chapter.audio_novel_id}/chapters/${chapterId}/${Date.now()}-${safeName}`;

            const upload =
                await b2S3.send(
                    new CreateMultipartUploadCommand({
                        Bucket:
                            process.env.B2_BUCKET_NAME,

                        Key:
                            objectKey,

                        ContentType:
                            "audio/mpeg"
                    })
                );

            if (!upload.UploadId) {

                throw new Error(
                    "B2 did not return a multipart upload ID."
                );

            }

            await db.query(`

                UPDATE audio_chapters

                SET
                    audio_provider = 'b2',
                    audio_object_key = $1,
                    audio_mime_type = 'audio/mpeg',
                    audio_original_name = $2,
                    audio_size_bytes = $3,
                    audio_status = 'uploading',
                    audio_upload_id = $4,
                    audio_upload_started_at = NOW(),
                    updated_at = NOW()

                WHERE id = $5

            `, [

                objectKey,
                fileName,
                Math.round(size),
                upload.UploadId,
                chapterId

            ]);

            return res.json({

                success: true,

                upload_id:
                    upload.UploadId,

                object_key:
                    objectKey,

                chapter_id:
                    chapterId,

                part_size:
                    PART_SIZE,

                max_size:
                    MAX_AUDIO_SIZE

            });

        } catch (err) {

            console.error(
                "Audio B2 multipart start error:",
                err
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to start audio upload."
            });

        }

    }
);

/* =========================================================
   SIGN ONE MULTIPART PART

   POST /api/audio/media/chapters/:chapterId/sign-part
========================================================= */

router.post(
    "/chapters/:chapterId/sign-part",
auth,
    async (req, res) => {

        try {

            const chapterId =
                getChapterId(req);

            const {
                upload_id,
                object_key,
                part_number
            } = req.body;

            const partNumber =
                Number(part_number);

            if (!chapterId) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid chapter ID."
                });

            }

            if (
                !upload_id ||
                !object_key ||
                !Number.isInteger(partNumber) ||
                partNumber < 1 ||
                partNumber > 10000
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Upload ID, object key and valid part number are required."
                });

            }

            const authorized =
                await getAuthorizedChapter(
                    chapterId,
                    req.user
                );

            if (authorized.error) {

                return res.status(
                    authorized.error.status
                ).json({
                    success: false,
                    message:
                        authorized.error.message
                });

            }

            const chapter =
                authorized.chapter;

            if (
                chapter.audio_provider !== "b2" ||
                chapter.audio_object_key !== object_key ||
                chapter.audio_upload_id !== upload_id ||
                chapter.audio_status !== "uploading"
            ) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Audio upload session not found."
                });

            }

            const signedUrl =
                await getSignedUrl(
                    b2S3,

                    new UploadPartCommand({
                        Bucket:
                            process.env.B2_BUCKET_NAME,

                        Key:
                            object_key,

                        UploadId:
                            upload_id,

                        PartNumber:
                            partNumber
                    }),

                    {
                        expiresIn:
                            SIGNED_URL_EXPIRES
                    }
                );

            return res.json({

                success: true,

                url:
                    signedUrl,

                expires_in:
                    SIGNED_URL_EXPIRES

            });

        } catch (err) {

            console.error(
                "Audio B2 sign part error:",
                err
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to create audio upload URL."
            });

        }

    }
);

/* =========================================================
   COMPLETE AUDIO MULTIPART UPLOAD

   POST /api/audio/media/chapters/:chapterId/complete
========================================================= */

router.post(
    "/chapters/:chapterId/complete",
auth,
    async (req, res) => {

        try {

            const chapterId =
                getChapterId(req);

            const {
                upload_id,
                object_key,
                parts,
                duration_seconds
            } = req.body;

            if (!chapterId) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid chapter ID."
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

            const duration =
                Number(duration_seconds);

            if (
                !Number.isFinite(duration) ||
                duration < 0
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Valid audio duration is required."
                });

            }

            const authorized =
                await getAuthorizedChapter(
                    chapterId,
                    req.user
                );

            if (authorized.error) {

                return res.status(
                    authorized.error.status
                ).json({
                    success: false,
                    message:
                        authorized.error.message
                });

            }

            const chapter =
                authorized.chapter;

            if (
                chapter.audio_provider !== "b2" ||
                chapter.audio_object_key !== object_key ||
                chapter.audio_upload_id !== upload_id ||
                chapter.audio_status !== "uploading"
            ) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Audio upload session not found."
                });

            }

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
                    .filter(part =>
                        part.ETag &&
                        Number.isInteger(
                            part.PartNumber
                        ) &&
                        part.PartNumber >= 1 &&
                        part.PartNumber <= 10000
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

            const uniquePartNumbers =
                new Set(
                    normalizedParts.map(
                        part =>
                            part.PartNumber
                    )
                );

            if (
                uniquePartNumbers.size !==
                normalizedParts.length
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Duplicate multipart part numbers were provided."
                });

            }

            await b2S3.send(

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

                })

            );

            const head =
                await b2S3.send(

                    new HeadObjectCommand({

                        Bucket:
                            process.env.B2_BUCKET_NAME,

                        Key:
                            object_key

                    })

                );

            const actualSize =
                Number(
                    head.ContentLength || 0
                );

            if (
                !actualSize ||
                actualSize >
                MAX_AUDIO_SIZE
            ) {

                await db.query(`

                    UPDATE audio_chapters

                    SET
                        audio_status = 'pending',
                        audio_object_key = NULL,
                        audio_upload_id = NULL,
                        audio_upload_started_at = NULL,
                        audio_original_name = NULL,
                        audio_mime_type = NULL,
                        audio_size_bytes = NULL,
                        audio_duration_seconds = NULL,
                        updated_at = NOW()

                    WHERE id = $1

                `, [
                    chapterId
                ]);

                return res.status(400).json({
                    success: false,
                    message:
                        "Uploaded audio failed size validation."
                });

            }

            if (
                String(
                    head.ContentType || ""
                ).toLowerCase() !==
                "audio/mpeg"
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Uploaded object is not an MP3 audio file."
                });

            }

            await db.query(`

                UPDATE audio_chapters

                SET
                    audio_status = 'ready',
                    audio_size_bytes = $1,
                    audio_duration_seconds = $2,
                    audio_uploaded_at = NOW(),
                    audio_upload_id = NULL,
                    audio_upload_started_at = NULL,
                    updated_at = NOW()

                WHERE
                    id = $3
                    AND audio_object_key = $4

            `, [

                actualSize,
                Math.round(duration),
                chapterId,
                object_key

            ]);

            return res.json({

                success: true,

                message:
                    "Audio uploaded successfully.",

                chapter_id:
                    chapterId,

                object_key:
                    object_key,

                size_bytes:
                    actualSize,

                duration_seconds:
                    Math.round(duration),

                content_type:
                    head.ContentType ||
                    "audio/mpeg"

            });

        } catch (err) {

            console.error(
                "Audio B2 multipart complete error:",
                err
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to complete audio upload."
            });

        }

    }
);

/* =========================================================
   ABORT AUDIO MULTIPART UPLOAD

   POST /api/audio/media/chapters/:chapterId/abort
========================================================= */

router.post(
    "/chapters/:chapterId/abort",
auth,
    async (req, res) => {

        try {

            const chapterId =
                getChapterId(req);

            const {
                upload_id,
                object_key
            } = req.body;

            if (!chapterId) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid chapter ID."
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

            const authorized =
                await getAuthorizedChapter(
                    chapterId,
                    req.user
                );

            if (authorized.error) {

                return res.status(
                    authorized.error.status
                ).json({
                    success: false,
                    message:
                        authorized.error.message
                });

            }

            const chapter =
                authorized.chapter;

            if (
                chapter.audio_provider !== "b2" ||
                chapter.audio_object_key !== object_key ||
                chapter.audio_upload_id !== upload_id ||
                chapter.audio_status !== "uploading"
            ) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Audio upload session not found."
                });

            }

            await b2S3.send(

                new AbortMultipartUploadCommand({

                    Bucket:
                        process.env.B2_BUCKET_NAME,

                    Key:
                        object_key,

                    UploadId:
                        upload_id

                })

            );

            await db.query(`

                UPDATE audio_chapters

                SET
                    audio_status = 'pending',
                    audio_object_key = NULL,
                    audio_upload_id = NULL,
                    audio_upload_started_at = NULL,
                    audio_original_name = NULL,
                    audio_mime_type = NULL,
                    audio_size_bytes = NULL,
                    audio_duration_seconds = NULL,
                    updated_at = NOW()

                WHERE id = $1

            `, [
                chapterId
            ]);

            return res.json({

                success: true,

                message:
                    "Audio upload cancelled."

            });

        } catch (err) {

            console.error(
                "Audio B2 multipart abort error:",
                err
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to cancel audio upload."
            });

        }

    }
);

/* =========================================================
   ADMIN AUDIO NOVEL COVER PROXY
   GET /api/audio/media/novels/:novelId/cover

   Stream the private B2 object through the backend. Do NOT
   redirect the browser to B2; that introduces a B2/S3 CORS
   dependency and was the reason the previous 302 still showed
   a broken image.
   ========================================================= */

router.get(
    "/novels/:novelId/cover",
    auth,
    async (req, res) => {

        try {

            if (
                !req.user ||
                req.user.role !== "admin"
            ) {
                return res.status(403).json({
                    success: false,
                    message: "Admin access required."
                });
            }

            const novelId =
                Number(req.params.novelId);

            if (
                !Number.isInteger(novelId) ||
                novelId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid Audio Novel ID."
                });
            }

            const result =
                await db.query(
                    `
                    SELECT cover_url
                    FROM audio_novels
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [novelId]
                );

            if(!result.rows.length){
                return res.status(404).json({
                    success: false,
                    message: "Audio Novel not found."
                });
            }

            const coverUrl =
                String(
                    result.rows[0].cover_url || ""
                ).trim();

            if(!coverUrl){
                return res.status(404).json({
                    success: false,
                    message: "Audio Novel cover not found."
                });
            }

            const parsed =
                new URL(coverUrl);

            const pathname =
                decodeURIComponent(
                    parsed.pathname
                ).replace(/^\/+/, "");

            const bucket =
                String(
                    process.env.B2_BUCKET_NAME || ""
                ).trim();

            if(!bucket){
                throw new Error(
                    "B2_BUCKET_NAME is not configured."
                );
            }

            let objectKey;

            if(
                pathname.startsWith(
                    bucket + "/"
                )
            ){
                objectKey =
                    pathname.slice(
                        bucket.length + 1
                    );
            }else{
                objectKey = pathname;
            }

            if(!objectKey){
                return res.status(404).json({
                    success: false,
                    message: "Audio Novel cover not found."
                });
            }

            const object =
                await b2S3.send(
                    new GetObjectCommand({
                        Bucket: bucket,
                        Key: objectKey
                    })
                );

            const contentType =
                String(
                    object.ContentType || ""
                ).trim() ||
                "image/jpeg";

            if(
                !contentType
                    .toLowerCase()
                    .startsWith("image/")
            ){
                return res.status(415).json({
                    success: false,
                    message: "Stored cover is not an image."
                });
            }

            res.setHeader(
                "Content-Type",
                contentType
            );

            if(
                object.ContentLength !== undefined &&
                object.ContentLength !== null
            ){
                res.setHeader(
                    "Content-Length",
                    String(object.ContentLength)
                );
            }

            res.setHeader(
                "Cache-Control",
                "private, max-age=300"
            );

            if(
                object.Body &&
                typeof object.Body.pipe === "function"
            ){
                object.Body.pipe(res);
                return;
            }

            if(
                object.Body &&
                typeof object.Body[Symbol.asyncIterator] ===
                    "function"
            ){
                for await(
                    const chunk of object.Body
                ){
                    res.write(chunk);
                }

                res.end();
                return;
            }

            throw new Error(
                "B2 returned no readable cover body."
            );

        } catch(error) {

            console.error(
                "Admin Audio Novel cover proxy error:",
                error
            );

            if(!res.headersSent){
                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to load Audio Novel cover."
                });
            }

            res.destroy(error);
        }
    }
);


/* =========================================================
   AUDIO MEDIA STATUS

   GET /api/audio/media/chapters/:chapterId/status
========================================================= */

router.get(
    "/chapters/:chapterId/status",
auth,
    async (req, res) => {

        try {

            const chapterId =
                getChapterId(req);

            if (!chapterId) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid chapter ID."
                });

            }

            const authorized =
                await getAuthorizedChapter(
                    chapterId,
                    req.user
                );

            if (authorized.error) {

                return res.status(
                    authorized.error.status
                ).json({
                    success: false,
                    message:
                        authorized.error.message
                });

            }

            const result =
                await db.query(`

                    SELECT
                        id,
                        audio_provider,
                        audio_original_name,
                        audio_mime_type,
                        audio_size_bytes,
                        audio_duration_seconds,
                        audio_status,
                        audio_uploaded_at,
                        audio_upload_started_at

                    FROM audio_chapters

                    WHERE id = $1

                `, [
                    chapterId
                ]);

            return res.json({

                success: true,

                chapter:
                    result.rows[0]

            });

        } catch (err) {

            console.error(
                "Audio media status error:",
                err
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load audio media status."
            });

        }

    }
);

/* =========================================================
   SECURE AUDIO PLAYBACK

   GET /api/audio/media/chapters/:chapterId/playback
========================================================= */

router.get(
    "/chapters/:chapterId/playback",
    optionalAuth,
    async (req, res) => {

        try {

            const chapterId =
                Number(req.params.chapterId);

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

            /*
            =================================================
            GET PUBLISHED AUDIO CHAPTER
            =================================================
            */

            const result =
                await db.query(`
                    SELECT
                        ac.id,
                        ac.audio_novel_id,
                        ac.chapter_no,
                        ac.title,

                        ac.audio_provider,
                        ac.audio_object_key,
                        ac.audio_mime_type,
                        ac.audio_original_name,
                        ac.audio_size_bytes,
                        ac.audio_duration_seconds,
                        ac.audio_status,

                        ac.is_premium,
                        ac.coins_required,
                        ac.early_access,

                        an.title AS audio_novel_title,
                        an.cover_url AS audio_novel_cover_url,
                        an.premium_only AS audio_novel_premium_only,
                        an.publish_status AS audio_novel_publish_status,
                        an.visibility AS audio_novel_visibility

                    FROM audio_chapters ac

                    JOIN audio_novels an
                        ON an.id = ac.audio_novel_id

                    WHERE
                        ac.id = $1

                        AND ac.is_draft = FALSE

                        AND ac.is_published = TRUE

                        AND (
                            ac.publish_at IS NULL
                            OR ac.publish_at <= NOW()
                        )

                        AND an.publish_status = 'published'

                        AND an.visibility = 'public'

                    LIMIT 1
                `, [chapterId]);

            if (!result.rows.length) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Audio chapter not found or not available."
                });

            }

            const chapter =
                result.rows[0];

            /*
            =================================================
            MEDIA VALIDATION
            =================================================
            */

            if (
                chapter.audio_provider !== "b2"
            ) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Audio is not available."
                });

            }

            if (
                !chapter.audio_object_key
            ) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Audio file is not available."
                });

            }

            if (
                String(
                    chapter.audio_status || ""
                ).toLowerCase() !== "ready"
            ) {

                return res.status(409).json({
                    success: false,
                    message:
                        "Audio is still processing."
                });

            }

            /*
            =================================================
            ACCESS CHECK
            =================================================
            */

            const chapterPremium =
                Boolean(
                    chapter.is_premium
                );

            const novelPremium =
                Boolean(
                    chapter.audio_novel_premium_only
                );

            const requiresAccess =
                chapterPremium ||
                novelPremium;

            /*
            -------------------------------------------------
            FREE AUDIO
            -------------------------------------------------
            */

            if (!requiresAccess) {

                const command =
                    new GetObjectCommand({

                        Bucket:
                            process.env.B2_BUCKET_NAME,

                        Key:
                            chapter.audio_object_key

                    });

                const signedUrl =
                    await getSignedUrl(
                        b2S3,
                        command,
                        {
                            expiresIn: 900
                        }
                    );

                return res.json({

                    success: true,

                    locked: false,

                    premium: false,

                    url:
                        signedUrl,

                    expires_in:
                        900,

                    chapter: {

                        id:
                            chapter.id,

                        audio_novel_id:
                            chapter.audio_novel_id,

                        chapter_no:
                            chapter.chapter_no,

                        title:
                            chapter.title,

                        audio_novel_title:
                            chapter.audio_novel_title,

                        mime_type:
                            chapter.audio_mime_type ||
                            "audio/mpeg",

                        duration_seconds:
                            chapter.audio_duration_seconds,

                        original_name:
                            chapter.audio_original_name,

                        size_bytes:
                            chapter.audio_size_bytes

                    }

                });

            }

            /*
            -------------------------------------------------
            PREMIUM AUDIO REQUIRES LOGIN
            -------------------------------------------------
            */

            const userId =
                req.user?.id
                    ? Number(req.user.id)
                    : null;

            if (!userId) {

                return res.status(403).json({

                    success: false,

                    locked: true,

                    requires_login: true,

                    premium: true,

                    message:
                        "Please login to listen to this premium audio.",

                    chapter: {

                        id:
                            chapter.id,

                        audio_novel_id:
                            chapter.audio_novel_id,

                        chapter_no:
                            chapter.chapter_no,

                        title:
                            chapter.title,

                        is_premium:
                            chapterPremium,

                        premium_only:
                            novelPremium,

                        coins_required:
                            Number(
                                chapter.coins_required || 0
                            )

                    }

                });

            }

            /*
            =================================================
            PREMIUM MEMBERSHIP CHECK
            =================================================
            */

            const premiumResult =
                await db.query(`
                    SELECT id

                    FROM user_premium

                    WHERE
                        user_id = $1

                        AND status = 'Active'

                        AND expiry_date > NOW()

                    LIMIT 1
                `, [userId]);

            const isPremiumMember =
                premiumResult.rows.length > 0;

            if (isPremiumMember) {

                const command =
                    new GetObjectCommand({

                        Bucket:
                            process.env.B2_BUCKET_NAME,

                        Key:
                            chapter.audio_object_key

                    });

                const signedUrl =
                    await getSignedUrl(
                        b2S3,
                        command,
                        {
                            expiresIn: 900
                        }
                    );

                return res.json({

                    success: true,

                    locked: false,

                    premium: true,

                    access:
                        "premium_membership",

                    url:
                        signedUrl,

                    expires_in:
                        900,

                    chapter: {

                        id:
                            chapter.id,

                        audio_novel_id:
                            chapter.audio_novel_id,

                        chapter_no:
                            chapter.chapter_no,

                        title:
                            chapter.title,

                        audio_novel_title:
                            chapter.audio_novel_title,

                        mime_type:
                            chapter.audio_mime_type ||
                            "audio/mpeg",

                        duration_seconds:
                            chapter.audio_duration_seconds,

                        original_name:
                            chapter.audio_original_name,

                        size_bytes:
                            chapter.audio_size_bytes

                    }

                });

            }

            /*
            =================================================
            COIN UNLOCK CHECK
            =================================================
            */

            const unlockResult =
                await db.query(`
                    SELECT
                        id,
                        coins_paid,
                        unlocked_at

                    FROM audio_chapter_unlocks

                    WHERE
                        user_id = $1

                        AND chapter_id = $2

                    LIMIT 1
                `, [
                    userId,
                    chapterId
                ]);

            if (
                unlockResult.rows.length > 0
            ) {

                const command =
                    new GetObjectCommand({

                        Bucket:
                            process.env.B2_BUCKET_NAME,

                        Key:
                            chapter.audio_object_key

                    });

                const signedUrl =
                    await getSignedUrl(
                        b2S3,
                        command,
                        {
                            expiresIn: 900
                        }
                    );

                return res.json({

                    success: true,

                    locked: false,

                    premium: false,

                    access:
                        "coin_unlock",

                    already_unlocked: true,

                    coins_paid:
                        Number(
                            unlockResult.rows[0]
                                .coins_paid || 0
                        ),

                    url:
                        signedUrl,

                    expires_in:
                        900,

                    chapter: {

                        id:
                            chapter.id,

                        audio_novel_id:
                            chapter.audio_novel_id,

                        chapter_no:
                            chapter.chapter_no,

                        title:
                            chapter.title,

                        audio_novel_title:
                            chapter.audio_novel_title,

                        mime_type:
                            chapter.audio_mime_type ||
                            "audio/mpeg",

                        duration_seconds:
                            chapter.audio_duration_seconds,

                        original_name:
                            chapter.audio_original_name,

                        size_bytes:
                            chapter.audio_size_bytes

                    }

                });

            }

            /*
            =================================================
            STILL LOCKED
            =================================================
            */

            return res.status(403).json({

                success: false,

                locked: true,

                requires_login: false,

                premium: true,

                reason:
                    "coins_required",

                message:
                    "This audio chapter requires coins to unlock.",

                chapter: {

                    id:
                        chapter.id,

                    audio_novel_id:
                        chapter.audio_novel_id,

                    chapter_no:
                        chapter.chapter_no,

                    title:
                        chapter.title,

                    is_premium:
                        chapterPremium,

                    premium_only:
                        novelPremium,

                    coins_required:
                        Number(
                            chapter.coins_required || 0
                        )

                }

            });

        } catch (err) {

            console.error(
                "Audio playback error:",
                err
            );

            return res.status(500).json({

                success: false,

                message:
                    "Unable to prepare audio playback."

            });

        }

    }
);

router.post(
    "/chapters/:chapterId/unlock",
    auth,
    async (req, res) => {

        const client =
            await db.connect();

        try {

            await client.query("BEGIN");

            const chapterId =
                Number(req.params.chapterId);

            const userId =
                Number(req.user.id);

            if (
                !Number.isInteger(chapterId) ||
                chapterId < 1
            ) {

                await client.query("ROLLBACK");

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

                await client.query("ROLLBACK");

                return res.status(401).json({
                    success: false,
                    message:
                        "Authentication required."
                });

            }

            /*
            ================================================
            GET PUBLISHED CHAPTER
            ================================================
            */

            const chapterResult =
                await client.query(`
                    SELECT
                        ac.id,
                        ac.audio_novel_id,
                        ac.chapter_no,
                        ac.title,
                        ac.is_premium,
                        ac.coins_required,

                        an.title AS audio_novel_title,
                        an.premium_only,
                        an.publish_status,
                        an.visibility

                    FROM audio_chapters ac

                    JOIN audio_novels an
                        ON an.id = ac.audio_novel_id

                    WHERE
                        ac.id = $1

                        AND ac.is_draft = FALSE

                        AND ac.is_published = TRUE

                        AND (
                            ac.publish_at IS NULL
                            OR ac.publish_at <= NOW()
                        )

                        AND an.publish_status = 'published'

                        AND an.visibility = 'public'

                    LIMIT 1
                `, [chapterId]);

            if (
                chapterResult.rows.length === 0
            ) {

                await client.query("ROLLBACK");

                return res.status(404).json({
                    success: false,
                    message:
                        "Audio chapter not found or not available."
                });

            }

            const chapter =
                chapterResult.rows[0];

            /*
            ================================================
            FREE CHAPTER
            ================================================
            */

            if (
                !chapter.is_premium &&
                !chapter.premium_only
            ) {

                await client.query("ROLLBACK");

                return res.json({

                    success: true,

                    unlocked: true,

                    premium: false,

                    coins_paid: 0

                });

            }

            /*
            ================================================
            PREMIUM MEMBERSHIP
            ================================================
            */

            const premiumResult =
                await client.query(`
                    SELECT id

                    FROM user_premium

                    WHERE
                        user_id = $1

                        AND status = 'Active'

                        AND expiry_date > NOW()

                    LIMIT 1
                `, [userId]);

            if (
                premiumResult.rows.length > 0
            ) {

                await client.query("ROLLBACK");

                return res.json({

                    success: true,

                    unlocked: true,

                    premium: true,

                    coins_paid: 0

                });

            }

            /*
            ================================================
            ALREADY UNLOCKED
            ================================================
            */

            const existingUnlock =
                await client.query(`
                    SELECT
                        id,
                        coins_paid,
                        unlocked_at

                    FROM audio_chapter_unlocks

                    WHERE
                        user_id = $1

                        AND chapter_id = $2

                    LIMIT 1
                `, [
                    userId,
                    chapterId
                ]);

            if (
                existingUnlock.rows.length > 0
            ) {

                await client.query("ROLLBACK");

                return res.json({

                    success: true,

                    unlocked: true,

                    premium: false,

                    already_unlocked: true,

                    coins_paid:
                        Number(
                            existingUnlock.rows[0]
                                .coins_paid || 0
                        )

                });

            }

            /*
            ================================================
            COIN PRICE
            ================================================
            */

            const coinsRequired =
                Math.max(
                    0,
                    Number(
                        chapter.coins_required || 0
                    )
                );

            if (
                coinsRequired <= 0
            ) {

                await client.query("ROLLBACK");

                return res.status(400).json({

                    success: false,

                    message:
                        "This premium audio has an invalid coin price."

                });

            }

            /*
            ================================================
            LOCK WALLET
            ================================================
            */

            const walletResult =
                await client.query(`
                    SELECT
                        id,
                        coins,
                        earned_coins,
                        spent_coins

                    FROM wallets

                    WHERE user_id = $1

                    FOR UPDATE
                `, [userId]);

            if (
                walletResult.rows.length === 0
            ) {

                await client.query("ROLLBACK");

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

            if (
                currentCoins <
                coinsRequired
            ) {

                await client.query("ROLLBACK");

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

            /*
            ================================================
            DEDUCT COINS
            ================================================
            */

            const updatedWallet =
                await client.query(`
                    UPDATE wallets

                    SET
                        coins =
                            coins - $1,

                        spent_coins =
                            spent_coins + $1

                    WHERE
                        user_id = $2

                    RETURNING coins
                `, [
                    coinsRequired,
                    userId
                ]);

            const newBalance =
                Number(
                    updatedWallet.rows[0].coins
                );

            /*
            ================================================
            WALLET TRANSACTION
            ================================================
            */

            await client.query(`
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
                    'Audio Chapter Unlock',
                    $4
                )
            `, [
                wallet.id,
                userId,
                coinsRequired,
                `audio_chapter:${chapterId}`
            ]);

            /*
            ================================================
            RECORD AUDIO UNLOCK
            ================================================
            */

            await client.query(`
                INSERT INTO audio_chapter_unlocks
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
            `, [
                userId,
                chapterId,
                coinsRequired
            ]);

            await client.query("COMMIT");

            return res.json({

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

            await client.query("ROLLBACK");

            console.error(
                "Audio chapter unlock error:",
                err
            );

            return res.status(500).json({

                success: false,

                message:
                    "Unable to unlock audio chapter."

            });

        } finally {

            client.release();

        }

    }
);

module.exports = router;