const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const router = express.Router();
const coverUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
            return cb(new Error("Only JPG, PNG and WebP covers are allowed."));
        }
        cb(null, true);
    }
});
const b2 = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_ENDPOINT,
    credentials: { accessKeyId: process.env.B2_KEY_ID, secretAccessKey: process.env.B2_APPLICATION_KEY },
    forcePathStyle: true
});
const db = require("../db");
const auth = require("../middleware/auth");
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
        const { chapter_no, title, is_premium, coins_required, early_access, publish_at } = req.body || {};
        const result = await db.query(
            `UPDATE audio_chapters SET chapter_no=COALESCE($1,chapter_no), title=COALESCE($2,title), is_premium=COALESCE($3,is_premium), coins_required=COALESCE($4,coins_required),
             early_access=COALESCE($5,early_access), publish_at=COALESCE($6,publish_at) WHERE id=$7 RETURNING *`,
            [chapter_no === undefined ? null : Number(chapter_no), title === undefined ? null : clean(title), is_premium === undefined ? null : Boolean(is_premium), coins_required === undefined ? null : Math.max(0, Number(coins_required)||0), early_access === undefined ? null : Boolean(early_access), publish_at === undefined ? null : publish_at, req.params.chapterId]
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
        const { chapter_no, title, content, media_type, is_premium, coins_required, early_access, publish_at } = req.body || {};
        if (media_type !== undefined && !["video","audio","text"].includes(media_type)) return res.status(400).json({ success: false, message: "Invalid episode media type." });
        const result = await db.query(
            `UPDATE original_chapters SET chapter_no=COALESCE($1,chapter_no),title=COALESCE($2,title),content=COALESCE($3,content),media_type=COALESCE($4,media_type),
             is_premium=COALESCE($5,is_premium),coins_required=COALESCE($6,coins_required),early_access=COALESCE($7,early_access),
             publish_at=COALESCE($8,publish_at) WHERE id=$9 RETURNING *`,
            [chapter_no===undefined?null:Number(chapter_no),title===undefined?null:clean(title),content===undefined?null:clean(content),media_type===undefined?null:media_type,is_premium===undefined?null:Boolean(is_premium),coins_required===undefined?null:Math.max(0,Number(coins_required)||0),early_access===undefined?null:Boolean(early_access),publish_at===undefined?null:publish_at,req.params.episodeId]
        );
        res.json({ success: true, episode: result.rows[0] });
    } catch (err) { sendError(res, err, "Update Originals episode"); }
});


/* Writer cover image upload. The shared asset worker URL makes the returned URL public. */
router.post("/cover-upload", coverUpload.single("cover"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success:false, message:"Please select a cover image." });
        const ext = { "image/jpeg":"jpg", "image/png":"png", "image/webp":"webp" }[req.file.mimetype];
        const key = `covers/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        await b2.send(new PutObjectCommand({
            Bucket: process.env.B2_BUCKET_NAME, Key:key, Body:req.file.buffer,
            ContentType:req.file.mimetype, CacheControl:"public, max-age=31536000, immutable"
        }));
        const worker = String(process.env.MYLIKITH_ASSETS_WORKER_URL || "https://mylikith-assets.sandhyashiva2006.workers.dev").replace(/\/+$/,"");
        res.status(201).json({ success:true, cover_url:`${worker}/${key}`, url:`${worker}/${key}` });
    } catch (err) { sendError(res, err, "Upload writer cover"); }
});

/* Publish/unpublish a project. */
for (const [path, table, childTable, fk] of [
    ["audio", "audio_novels", "audio_chapters", "audio_novel_id"],
    ["originals", "originals", "original_chapters", "original_id"]
]) {
    router.post(`/${path}/:id/publish`, async (req,res) => {
        try {
            if (!await owned(table, req.params.id, req.user.id)) return res.status(404).json({success:false,message:"Project not found."});
            const published = req.body?.published !== false;
            if (published) {
                const ready = path === "audio"
                    ? await db.query(`SELECT COUNT(*)::int AS total FROM ${childTable} WHERE ${fk}=$1 AND is_published=TRUE AND is_draft=FALSE AND audio_status='ready' AND audio_object_key IS NOT NULL`,[req.params.id])
                    : await db.query(`SELECT COUNT(*)::int AS total FROM ${childTable} WHERE ${fk}=$1 AND is_published=TRUE AND is_draft=FALSE AND ((media_type='text' AND COALESCE(content,'')<>'') OR (media_type<>'text' AND media_status='ready' AND media_object_key IS NOT NULL))`,[req.params.id]);
                if (!Number(ready.rows[0].total))
                    return res.status(400).json({success:false,message:"Publish at least one chapter/episode with its required content or uploaded media before publishing this project."});
            }
            const result = await db.query(`UPDATE ${table} SET publish_status=$1, visibility=$2, updated_at=NOW() WHERE id=$3 AND created_by=$4 RETURNING *`,
                [published?"published":"draft",published?"public":"private",req.params.id,req.user.id]);
            res.json({success:true, project:result.rows[0]});
        } catch(err) { sendError(res,err,"Update project publication"); }
    });
    router.delete(`/${path}/:id`, async (req,res) => {
        const client = await db.connect();
        try {
            await client.query("BEGIN");
            const own = await client.query(`SELECT id FROM ${table} WHERE id=$1 AND created_by=$2 FOR UPDATE`,[req.params.id,req.user.id]);
            if (!own.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({success:false,message:"Project not found."}); }
            await client.query(`DELETE FROM ${childTable} WHERE ${fk}=$1`,[req.params.id]);
            await client.query(`DELETE FROM ${table} WHERE id=$1 AND created_by=$2`,[req.params.id,req.user.id]);
            await client.query("COMMIT");
            res.json({success:true});
        } catch(err) { await client.query("ROLLBACK"); sendError(res,err,"Delete project"); }
        finally { client.release(); }
    });
}
router.post("/audio/chapters/:chapterId/publish", async (req,res) => {
    try {
        const q = await db.query(`SELECT ac.id,ac.audio_status,ac.audio_object_key FROM audio_chapters ac JOIN audio_novels an ON an.id=ac.audio_novel_id WHERE ac.id=$1 AND an.created_by=$2`,[req.params.chapterId,req.user.id]);
        if (!q.rows.length) return res.status(404).json({success:false,message:"Chapter not found."});
        const published = req.body?.published !== false;
        if (published && (q.rows[0].audio_status !== "ready" || !q.rows[0].audio_object_key))
            return res.status(400).json({success:false,message:"Upload the chapter MP3 before publishing it."});
        const r = await db.query(`UPDATE audio_chapters SET is_published=$1,is_draft=$2,updated_at=NOW() WHERE id=$3 RETURNING *`,[published,!published,req.params.chapterId]);
        res.json({success:true,chapter:r.rows[0]});
    } catch(err) { sendError(res,err,"Publish audio chapter"); }
});
router.delete("/audio/chapters/:chapterId", async (req,res) => {
    try {
        const r=await db.query(`DELETE FROM audio_chapters ac USING audio_novels an WHERE ac.audio_novel_id=an.id AND ac.id=$1 AND an.created_by=$2 RETURNING ac.id`,[req.params.chapterId,req.user.id]);
        if(!r.rows.length) return res.status(404).json({success:false,message:"Chapter not found."});
        res.json({success:true});
    } catch(err) { sendError(res,err,"Delete audio chapter"); }
});
router.post("/originals/episodes/:episodeId/publish", async (req,res) => {
    try {
        const q=await db.query(`SELECT oc.* FROM original_chapters oc JOIN originals o ON o.id=oc.original_id WHERE oc.id=$1 AND o.created_by=$2`,[req.params.episodeId,req.user.id]);
        if(!q.rows.length) return res.status(404).json({success:false,message:"Episode not found."});
        const c=q.rows[0], published=req.body?.published!==false;
        if(published && (c.media_type==="text" ? !String(c.content||"").trim() : c.media_status!=="ready" || !c.media_object_key))
            return res.status(400).json({success:false,message:"Add the episode content or finish uploading its media before publishing."});
        const r=await db.query(`UPDATE original_chapters SET is_published=$1,is_draft=$2,updated_at=NOW() WHERE id=$3 RETURNING *`,[published,!published,req.params.episodeId]);
        res.json({success:true,episode:r.rows[0]});
    } catch(err) { sendError(res,err,"Publish Originals episode"); }
});
router.delete("/originals/episodes/:episodeId", async (req,res) => {
    try {
        const r=await db.query(`DELETE FROM original_chapters oc USING originals o WHERE oc.original_id=o.id AND oc.id=$1 AND o.created_by=$2 RETURNING oc.id`,[req.params.episodeId,req.user.id]);
        if(!r.rows.length) return res.status(404).json({success:false,message:"Episode not found."});
        res.json({success:true});
    } catch(err) { sendError(res,err,"Delete Originals episode"); }
});

module.exports = router;
