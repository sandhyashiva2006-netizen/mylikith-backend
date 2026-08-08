const express = require("express");
const router = express.Router();

const db = require("../db");
const auth = require("../middleware/auth");


/* =========================================================
   ALL ROUTES REQUIRE LOGIN
========================================================= */

router.use(auth);


/* =========================================================
   GET READING PROGRESS
   GET /api/classic-progress/:classicId
========================================================= */

router.get("/:classicId", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT
                crp.id,
                crp.user_id,
                crp.classic_id,
                crp.chapter_id,
                crp.chapter_number,
                crp.progress_percent,
                crp.last_read_at,
                c.title AS classic_title,
                cc.title AS chapter_title
            FROM classic_reading_progress crp

            JOIN classics c
                ON c.id = crp.classic_id

            JOIN classic_chapters cc
                ON cc.id = crp.chapter_id

            WHERE
                crp.user_id = $1
                AND crp.classic_id = $2

            LIMIT 1
        `, [
            req.user.id,
            req.params.classicId
        ]);


        if (!result.rows.length) {

            return res.json({
                success: true,
                progress: null
            });

        }


        res.json({
            success: true,
            progress: result.rows[0]
        });


    } catch (err) {

        console.error(
            "Get Classic progress error:",
            err
        );


        res.status(500).json({
            success: false,
            message: "Unable to load reading progress."
        });

    }

});


/* =========================================================
   SAVE READING PROGRESS
   PUT /api/classic-progress/:classicId
========================================================= */

router.put("/:classicId", async (req, res) => {

    try {

        const {
            chapter_id,
            chapter_number,
            progress_percent
        } = req.body;


        if (!chapter_id || !chapter_number) {

            return res.status(400).json({
                success: false,
                message:
                    "Chapter information is required."
            });

        }


        const progress =
            Math.min(
                100,
                Math.max(
                    0,
                    Number(progress_percent) || 0
                )
            );


        /* ================================================
           VERIFY CLASSIC
        ================================================= */

        const classicCheck =
            await db.query(`
                SELECT id
                FROM classics
                WHERE
                    id = $1
                    AND is_published = TRUE
            `, [
                req.params.classicId
            ]);


        if (!classicCheck.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Classic not found."
            });

        }


        /* ================================================
           VERIFY CHAPTER
        ================================================= */

        const chapterCheck =
            await db.query(`
                SELECT
                    id,
                    chapter_number
                FROM classic_chapters
                WHERE
                    id = $1
                    AND classic_id = $2
            `, [
                chapter_id,
                req.params.classicId
            ]);


        if (!chapterCheck.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Chapter not found."
            });

        }


        const actualChapterNumber =
            chapterCheck.rows[0].chapter_number;


        /* ================================================
           UPSERT PROGRESS
        ================================================= */

        const result =
            await db.query(`
                INSERT INTO classic_reading_progress (
                    user_id,
                    classic_id,
                    chapter_id,
                    chapter_number,
                    progress_percent,
                    last_read_at,
                    created_at,
                    updated_at
                )

                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    NOW(),
                    NOW(),
                    NOW()
                )

                ON CONFLICT (
                    user_id,
                    classic_id
                )

                DO UPDATE SET
                    chapter_id =
                        EXCLUDED.chapter_id,

                    chapter_number =
                        EXCLUDED.chapter_number,

                    progress_percent =
                        EXCLUDED.progress_percent,

                    last_read_at =
                        NOW(),

                    updated_at =
                        NOW()

                RETURNING
                    id,
                    user_id,
                    classic_id,
                    chapter_id,
                    chapter_number,
                    progress_percent,
                    last_read_at
            `, [
                req.user.id,
                req.params.classicId,
                chapter_id,
                actualChapterNumber,
                progress
            ]);


        res.json({
            success: true,
            progress: result.rows[0]
        });


    } catch (err) {

        console.error(
            "Save Classic progress error:",
            err
        );


        res.status(500).json({
            success: false,
            message: "Unable to save reading progress."
        });

    }

});


/* =========================================================
   DELETE READING PROGRESS
   DELETE /api/classic-progress/:classicId
========================================================= */

router.delete("/:classicId", async (req, res) => {

    try {

        await db.query(`
            DELETE FROM classic_reading_progress

            WHERE
                user_id = $1
                AND classic_id = $2
        `, [
            req.user.id,
            req.params.classicId
        ]);


        res.json({
            success: true,
            message: "Reading progress cleared."
        });


    } catch (err) {

        console.error(
            "Delete Classic progress error:",
            err
        );


        res.status(500).json({
            success: false,
            message: "Unable to clear reading progress."
        });

    }

});


module.exports = router;