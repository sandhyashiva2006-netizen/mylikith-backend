const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");
const {
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    HeadObjectCommand
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const b2S3 = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.B2_KEY_ID,
        secretAccessKey: process.env.B2_APPLICATION_KEY
    },
    forcePathStyle: true
});


router.use(auth);

router.use(async (req, res, next) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ success: false, message: "Authentication required." });
        }
        const profile = await db.query(
            `SELECT status FROM writer_profiles WHERE user_id = $1`,
            [req.user.id]
        );
        if (req.user.role !== "writer" || !profile.rows.length || String(profile.rows[0].status).toLowerCase() !== "approved") {
            return res.status(403).json({ success: false, message: "An approved writer account is required." });
        }
        next();
    } catch (err) {
        console.error("Writer Universe authorization error:", err);
        res.status(500).json({ success: false, message: "Unable to verify writer access." });
    }
});

const clean = value => typeof value === "string" ? value.trim() : value;
const categories = value => Array.isArray(value) ? value.map(v => String(v).trim()).filter(Boolean) : [];

async function owned(table, id, userId) {
    const result = await db.query(
        `SELECT id FROM ${table} WHERE id = $1 AND created_by = $2`,
        [id, userId]
    );
    return result.rows.length > 0;
}

function sendError(res, err, label) {
    console.error(`${label}:`, err);
    return res.status(500).json({ success: false, message: `Unable to ${label.toLowerCase()}.` });
}

/* List and create writer-owned audio novels. */
router.get("/audio", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT an.*, (SELECT COUNT(*)::int FROM audio_chapters ac WHERE ac.audio_novel_id = an.id) AS chapter_count
             FROM audio_novels an WHERE an.created_by = $1 ORDER BY an.updated_at DESC NULLS LAST, an.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, audio: result.rows });
    } catch (err) { sendError(res, err, "Load audio projects"); }
});

router.post("/audio", async (req, res) => {
    try {
        const { title, description, cover_url, language, category, categories: cats, content_type, status } = req.body || {};
        if (!clean(title)) return res.status(400).json({ success: false, message: "Title is required." });
        const result = await db.query(
            `INSERT INTO audio_novels
             (title, description, cover_url, language, category, categories, content_type, status, publish_status, visibility, premium_only, featured, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft','private',FALSE,FALSE,$9) RETURNING *`,
            [clean(title), clean(description) || null, clean(cover_url) || null, clean(language) || null, clean(category) || null, categories(cats), clean(content_type) || "story", clean(status) || "ongoing", req.user.id]
        );
        res.status(201).json({ success: true, audioNovel: result.rows[0] });
    } catch (err) { sendError(res, err, "Create audio project"); }
});

router.put("/audio/:id", async (req, res) => {
    try {
        if (!await owned("audio_novels", req.params.id, req.user.id)) return res.status(404).json({ success: false, message: "Audio project not found." });
        const { title, description, cover_url, language, category, categories: cats, content_type, status } = req.body || {};
        if (title !== undefined && !clean(title)) return res.status(400).json({ success: false, message: "Title cannot be empty." });
        const result = await db.query(
            `UPDATE audio_novels SET title=COALESCE($1,title), description=COALESCE($2,description), cover_url=COALESCE($3,cover_url),
             language=COALESCE($4,language), category=COALESCE($5,category), categories=COALESCE($6,categories),
             content_type=COALESCE($7,content_type), status=COALESCE($8,status), updated_at=NOW()
             WHERE id=$9 AND created_by=$10 RETURNING *`,
            [title === undefined ? null : clean(title), description === undefined ? null : clean(description), cover_url === undefined ? null : clean(cover_url), language === undefined ? null : clean(language), category === undefined ? null : clean(category), cats === undefined ? null : categories(cats), content_type === undefined ? null : clean(content_type), status === undefined ? null : clean(status), req.params.id, req.user.id]
        );
        res.json({ success: true, audioNovel: result.rows[0] });
    } catch (err) { sendError(res, err, "Update audio project"); }
});

router.get("/audio/:id/chapters", async (req, res) => {
    try {
        if (!await owned("audio_novels", req.params.id, req.user.id)) return res.status(404).json({ success: false, message: "Audio project not found." });
        const result = await db.query(`SELECT * FROM audio_chapters WHERE audio_novel_id=$1 ORDER BY chapter_no ASC`, [req.params.id]);
        res.json({ success: true, chapters: result.rows });
    } catch (err) { sendError(res, err, "Load audio chapters"); }
});

router.post("/audio/:id/chapters", async (req, res) => {
    try {
        if (!await owned("audio_novels", req.params.id, req.user.id)) return res.status(404).json({ success: false, message: "Audio project not found." });
        const { chapter_no, title, is_premium, coins_required, early_access, publish_at } = req.body || {};
        const number = Number(chapter_no);
        if (!Number.isInteger(number) || number < 1 || !clean(title)) return res.status(400).json({ success: false, message: "A valid chapter number and title are required." });
        const result = await db.query(
            `INSERT INTO audio_chapters (audio_novel_id,chapter_no,title,audio_status,is_premium,coins_required,early_access,is_draft,is_published,publish_at)
             VALUES ($1,$2,$3,'pending',$4,$5,$6,TRUE,FALSE,$7) RETURNING *`,
            [req.params.id, number, clean(title), Boolean(is_premium), Math.max(0, Number(coins_required) || 0), Boolean(early_access), publish_at || null]
        );
        res.status(201).json({ success: true, chapter: result.rows[0] });
    } catch (err) { sendError(res, err, "Create audio chapter"); }
});

router.put("/audio/chapters/:chapterId", async (req, res) => {
    try {
        const owner = await db.query(`SELECT an.id FROM audio_chapters ac JOIN audio_novels an ON an.id=ac.audio_novel_id WHERE ac.id=$1 AND an.created_by=$2`, [req.params.chapterId, req.user.id]);
        if (!owner.rows.length) return res.status(404).json({ success: false, message: "Audio chapter not found." });
        const { title, is_premium, coins_required, early_access, publish_at } = req.body || {};
        const result = await db.query(
            `UPDATE audio_chapters SET title=COALESCE($1,title), is_premium=COALESCE($2,is_premium), coins_required=COALESCE($3,coins_required),
             early_access=COALESCE($4,early_access), publish_at=COALESCE($5,publish_at) WHERE id=$6 RETURNING *`,
            [title === undefined ? null : clean(title), is_premium === undefined ? null : Boolean(is_premium), coins_required === undefined ? null : Math.max(0, Number(coins_required)||0), early_access === undefined ? null : Boolean(early_access), publish_at === undefined ? null : publish_at, req.params.chapterId]
        );
        res.json({ success: true, chapter: result.rows[0] });
    } catch (err) { sendError(res, err, "Update audio chapter"); }
});

/* List and create writer-owned Originals series and episodes. */
router.get("/originals", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT o.*, (SELECT COUNT(*)::int FROM original_chapters oc WHERE oc.original_id=o.id) AS episode_count
             FROM originals o WHERE o.created_by=$1 ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, originals: result.rows });
    } catch (err) { sendError(res, err, "Load Originals projects"); }
});

router.post("/originals", async (req, res) => {
    try {
        const { title, description, cover_url, language, category, categories: cats, content_type, status } = req.body || {};
        if (!clean(title)) return res.status(400).json({ success: false, message: "Title is required." });
        const result = await db.query(
            `INSERT INTO originals (title,description,cover_url,language,category,categories,content_type,status,publish_status,visibility,premium_only,featured,created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft','private',FALSE,FALSE,$9) RETURNING *`,
            [clean(title), clean(description)||null, clean(cover_url)||null, clean(language)||null, clean(category)||null, categories(cats), clean(content_type)||"series", clean(status)||"ongoing", req.user.id]
        );
        res.status(201).json({ success: true, original: result.rows[0] });
    } catch (err) { sendError(res, err, "Create Originals project"); }
});

router.put("/originals/:id", async (req, res) => {
    try {
        if (!await owned("originals", req.params.id, req.user.id)) return res.status(404).json({ success: false, message: "Originals project not found." });
        const { title, description, cover_url, language, category, categories: cats, content_type, status } = req.body || {};
        if (title !== undefined && !clean(title)) return res.status(400).json({ success: false, message: "Title cannot be empty." });
        const result = await db.query(
            `UPDATE originals SET title=COALESCE($1,title),description=COALESCE($2,description),cover_url=COALESCE($3,cover_url),
             language=COALESCE($4,language),category=COALESCE($5,category),categories=COALESCE($6,categories),
             content_type=COALESCE($7,content_type),status=COALESCE($8,status),updated_at=NOW()
             WHERE id=$9 AND created_by=$10 RETURNING *`,
            [title===undefined?null:clean(title),description===undefined?null:clean(description),cover_url===undefined?null:clean(cover_url),language===undefined?null:clean(language),category===undefined?null:clean(category),cats===undefined?null:categories(cats),content_type===undefined?null:clean(content_type),status===undefined?null:clean(status),req.params.id,req.user.id]
        );
        res.json({ success: true, original: result.rows[0] });
    } catch (err) { sendError(res, err, "Update Originals project"); }
});

router.get("/originals/:id/episodes", async (req, res) => {
    try {
        if (!await owned("originals", req.params.id, req.user.id)) return res.status(404).json({ success: false, message: "Originals project not found." });
        const result = await db.query(`SELECT * FROM original_chapters WHERE original_id=$1 ORDER BY chapter_no ASC`, [req.params.id]);
        res.json({ success: true, episodes: result.rows });
    } catch (err) { sendError(res, err, "Load Originals episodes"); }
});

router.post("/originals/:id/episodes", async (req, res) => {
    try {
        if (!await owned("originals", req.params.id, req.user.id)) return res.status(404).json({ success: false, message: "Originals project not found." });
        const { chapter_no, title, content, media_type, is_premium, coins_required, early_access, publish_at } = req.body || {};
        const number = Number(chapter_no);
        const type = media_type || "video";
        if (!Number.isInteger(number) || number < 1 || !clean(title)) return res.status(400).json({ success: false, message: "A valid episode number and title are required." });
        if (!["video","audio","text"].includes(type)) return res.status(400).json({ success: false, message: "Invalid episode media type." });
        if (type === "text" && !clean(content)) return res.status(400).json({ success: false, message: "Text episodes require content." });
        const result = await db.query(
            `INSERT INTO original_chapters (original_id,chapter_no,title,content,media_type,is_premium,coins_required,early_access,is_draft,is_published,publish_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,FALSE,$9) RETURNING *`,
            [req.params.id,number,clean(title),clean(content)||null,type,Boolean(is_premium),Math.max(0,Number(coins_required)||0),Boolean(early_access),publish_at||null]
        );
        res.status(201).json({ success: true, episode: result.rows[0] });
    } catch (err) { sendError(res, err, "Create Originals episode"); }
});

router.put("/originals/episodes/:episodeId", async (req, res) => {
    try {
        const owner = await db.query(`SELECT o.id FROM original_chapters oc JOIN originals o ON o.id=oc.original_id WHERE oc.id=$1 AND o.created_by=$2`, [req.params.episodeId, req.user.id]);
        if (!owner.rows.length) return res.status(404).json({ success: false, message: "Episode not found." });
        const { title, content, media_type, is_premium, coins_required, early_access, publish_at } = req.body || {};
        if (media_type !== undefined && !["video","audio","text"].includes(media_type)) return res.status(400).json({ success: false, message: "Invalid episode media type." });
        const result = await db.query(
            `UPDATE original_chapters SET title=COALESCE($1,title),content=COALESCE($2,content),media_type=COALESCE($3,media_type),
             is_premium=COALESCE($4,is_premium),coins_required=COALESCE($5,coins_required),early_access=COALESCE($6,early_access),
             publish_at=COALESCE($7,publish_at) WHERE id=$8 RETURNING *`,
            [title===undefined?null:clean(title),content===undefined?null:clean(content),media_type===undefined?null:media_type,is_premium===undefined?null:Boolean(is_premium),coins_required===undefined?null:Math.max(0,Number(coins_required)||0),early_access===undefined?null:Boolean(early_access),publish_at===undefined?null:publish_at,req.params.episodeId]
        );
        res.json({ success: true, episode: result.rows[0] });
    } catch (err) { sendError(res, err, "Update Originals episode"); }
});



/* Writer publishing controls for Originals episodes and series. */
router.post("/originals/episodes/:episodeId/publish", async (req, res) => {
    try {
        const episodeId = Number(req.params.episodeId);
        const published = req.body?.published !== false;
        const owner = await db.query(
            `SELECT oc.id, oc.media_type, oc.content, oc.media_status, oc.media_object_key
             FROM original_chapters oc
             JOIN originals o ON o.id = oc.original_id
             WHERE oc.id = $1 AND o.created_by = $2`,
            [episodeId, req.user.id]
        );
        if (!owner.rows.length) return res.status(404).json({success:false,message:"Episode not found."});
        const ep = owner.rows[0];
        if (published) {
            const ready = ep.media_type === "text"
                ? Boolean(String(ep.content || "").trim())
                : ep.media_status === "ready" && Boolean(ep.media_object_key);
            if (!ready) return res.status(400).json({success:false,message: ep.media_type === "text" ? "Add episode text before publishing." : "Upload and verify the episode media before publishing."});
        }
        const result = await db.query(
            `UPDATE original_chapters
             SET is_published = $1, is_draft = $2, updated_at = NOW()
             WHERE id = $3 RETURNING *`,
            [published, !published, episodeId]
        );
        return res.json({success:true,episode:result.rows[0]});
    } catch (err) {
        console.error("Publish Originals episode:",err);
        return res.status(500).json({success:false,message:"Unable to update episode publication status."});
    }
});

router.post("/originals/:id/publish", async (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const published = req.body?.published !== false;
        const owner = await db.query(
            `SELECT id FROM originals WHERE id = $1 AND created_by = $2`,
            [projectId, req.user.id]
        );
        if (!owner.rows.length) return res.status(404).json({success:false,message:"Originals series not found."});
        if (published) {
            const ready = await db.query(
                `SELECT COUNT(*)::int AS total
                 FROM original_chapters
                 WHERE original_id = $1 AND is_published = TRUE AND is_draft = FALSE
                   AND ((media_type = 'text' AND COALESCE(content,'') <> '')
                     OR (media_type <> 'text' AND media_status = 'ready' AND media_object_key IS NOT NULL))`,
                [projectId]
            );
            if (!Number(ready.rows[0].total)) return res.status(400).json({success:false,message:"Publish at least one episode with its required content or uploaded media before publishing this series."});
        }
        const result = await db.query(
            `UPDATE originals SET publish_status = $1, visibility = $2 WHERE id = $3 RETURNING *`,
            [published ? "published" : "draft", published ? "public" : "private", projectId]
        );
        return res.json({success:true,original:result.rows[0]});
    } catch (err) {
        console.error("Publish Originals series:",err);
        return res.status(500).json({success:false,message:"Unable to update Originals series publication status."});
    }
});


/* Writer-owned Originals episode video upload to Backblaze B2. */
async function ownedEpisode(episodeId, userId) {
    const result = await db.query(
        `SELECT oc.id, oc.original_id FROM original_chapters oc
         JOIN originals o ON o.id = oc.original_id
         WHERE oc.id = $1 AND o.created_by = $2`,
        [episodeId, userId]
    );
    return result.rows[0] || null;
}

router.post("/originals/episodes/:episodeId/media/start", async (req, res) => {
    try {
        const episodeId = Number(req.params.episodeId);
        if (!Number.isInteger(episodeId)) return res.status(400).json({success:false,message:"Invalid episode ID."});
        const episode = await ownedEpisode(episodeId, req.user.id);
        if (!episode) return res.status(404).json({success:false,message:"Episode not found."});
        const {file_name, mime_type, file_size} = req.body || {};
        const allowed = ["video/mp4","video/webm","video/quicktime"];
        if (!file_name || !allowed.includes(mime_type)) return res.status(400).json({success:false,message:"Choose an MP4, WebM or MOV video."});
        if (!Number.isFinite(Number(file_size)) || Number(file_size) <= 0 || Number(file_size) > 2*1024*1024*1024)
            return res.status(400).json({success:false,message:"Video must be larger than zero and no more than 2 GB."});
        const safeName = String(file_name).replace(/[^a-zA-Z0-9._-]/g,"_");
        const objectKey = `originals/${episode.original_id}/chapters/${episodeId}/${Date.now()}-${safeName}`;
        const upload = await b2S3.send(new CreateMultipartUploadCommand({
            Bucket:process.env.B2_BUCKET_NAME, Key:objectKey, ContentType:mime_type
        }));
        if (!upload.UploadId) throw new Error("B2 did not return an upload ID.");
        await db.query(
            `UPDATE original_chapters SET media_type='video',media_provider='b2',media_object_key=$1,
             media_original_name=$2,media_mime_type=$3,media_size_bytes=$4,media_status='uploading',
             media_uploaded_at=NULL,updated_at=NOW() WHERE id=$5`,
            [objectKey,file_name,mime_type,Number(file_size),episodeId]
        );
        res.json({success:true,upload_id:upload.UploadId,object_key:objectKey,episode_id:episodeId,part_size:10*1024*1024});
    } catch(err) { console.error("Writer Originals video upload start:",err); res.status(500).json({success:false,message:"Unable to start video upload."}); }
});

router.post("/originals/episodes/:episodeId/media/sign-part", async (req, res) => {
    try {
        const episodeId = Number(req.params.episodeId);
        const episode = await ownedEpisode(episodeId, req.user.id);
        if (!episode) return res.status(404).json({success:false,message:"Episode not found."});
        const {upload_id,object_key,part_number} = req.body || {};
        if (!upload_id || !object_key || !Number.isInteger(Number(part_number)) || Number(part_number)<1)
            return res.status(400).json({success:false,message:"Upload ID, object key and part number are required."});
        const check = await db.query(
            `SELECT id FROM original_chapters WHERE id=$1 AND media_provider='b2' AND media_object_key=$2 AND media_status='uploading'`,
            [episodeId,object_key]
        );
        if (!check.rows.length || !String(object_key).startsWith(`originals/${episode.original_id}/chapters/${episodeId}/`))
            return res.status(404).json({success:false,message:"Video upload session not found."});
        const url = await getSignedUrl(b2S3,new UploadPartCommand({
            Bucket:process.env.B2_BUCKET_NAME,Key:object_key,UploadId:upload_id,PartNumber:Number(part_number)
        }),{expiresIn:900});
        res.json({success:true,url,expires_in:900});
    } catch(err) { console.error("Writer Originals video sign part:",err); res.status(500).json({success:false,message:"Unable to create video upload URL."}); }
});

router.post("/originals/episodes/:episodeId/media/complete", async (req, res) => {
    try {
        const episodeId = Number(req.params.episodeId);
        const episode = await ownedEpisode(episodeId, req.user.id);
        if (!episode) return res.status(404).json({success:false,message:"Episode not found."});
        const {upload_id,object_key,parts} = req.body || {};
        if (!upload_id || !object_key || !Array.isArray(parts) || !parts.length)
            return res.status(400).json({success:false,message:"Upload ID, object key and uploaded parts are required."});
        const check = await db.query(
            `SELECT id FROM original_chapters WHERE id=$1 AND media_provider='b2' AND media_object_key=$2 AND media_status='uploading'`,
            [episodeId,object_key]
        );
        if (!check.rows.length || !String(object_key).startsWith(`originals/${episode.original_id}/chapters/${episodeId}/`))
            return res.status(404).json({success:false,message:"Video upload session not found."});
        const normalized = parts.map(p=>({ETag:p.etag||p.ETag,PartNumber:Number(p.part_number||p.PartNumber)}))
            .filter(p=>p.ETag&&Number.isInteger(p.PartNumber)).sort((a,b)=>a.PartNumber-b.PartNumber);
        if (!normalized.length) return res.status(400).json({success:false,message:"No valid uploaded video parts were provided."});
        await b2S3.send(new CompleteMultipartUploadCommand({
            Bucket:process.env.B2_BUCKET_NAME,Key:object_key,UploadId:upload_id,MultipartUpload:{Parts:normalized}
        }));
        const head = await b2S3.send(new HeadObjectCommand({Bucket:process.env.B2_BUCKET_NAME,Key:object_key}));
        await db.query(
            `UPDATE original_chapters SET media_status='ready',media_size_bytes=COALESCE($1,media_size_bytes),
             media_uploaded_at=NOW(),updated_at=NOW() WHERE id=$2 AND media_object_key=$3`,
            [head.ContentLength||null,episodeId,object_key]
        );
        res.json({success:true,message:"Video uploaded successfully.",episode_id:episodeId,object_key,size_bytes:head.ContentLength||null,content_type:head.ContentType||null});
    } catch(err) { console.error("Writer Originals video upload complete:",err); res.status(500).json({success:false,message:"Unable to complete video upload."}); }
});


module.exports = router;
