const express = require("express");
const router = express.Router();
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

module.exports = router;
