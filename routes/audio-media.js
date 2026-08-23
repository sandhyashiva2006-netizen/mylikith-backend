const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");

const {
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    HeadObjectCommand
} = require("@aws-sdk/client-s3");

const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const router = express.Router();

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

router.use(auth);

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
   AUDIO MEDIA STATUS

   GET /api/audio/media/chapters/:chapterId/status
========================================================= */

router.get(
    "/chapters/:chapterId/status",
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

module.exports = router;