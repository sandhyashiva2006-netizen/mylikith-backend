const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/:chapterId/:userId", async (req, res) => {

    try {

        const { chapterId, userId } = req.params;

        const locked = await db.query(

            `
            SELECT *
            FROM locked_chapters
            WHERE chapter_id=$1
            `,

            [chapterId]

        );

        if (locked.rows.length === 0) {

            return res.json({

                locked: false

            });

        }

        const unlocked = await db.query(

            `
            SELECT id
            FROM unlocked_chapters
            WHERE chapter_id=$1
            AND user_id=$2
            `,

            [

                chapterId,

                userId

            ]

        );

        if (unlocked.rows.length > 0) {

            return res.json({

                locked: false,

                purchased: true

            });

        }

        res.json({

            locked: true,

            coins: locked.rows[0].coins_required

        });

    }

    catch (err) {

        console.log(err);

        res.status(500).json({

            error: err.message

        });

    }

});

router.post("/lock", async (req, res) => {

    try {

        const {

            chapter_id,

            novel_id,

            coins_required

        } = req.body;

        await db.query(

            `
            INSERT INTO locked_chapters
            (

                chapter_id,

                novel_id,

                coins_required,

                is_locked

            )

            VALUES

            (

                $1,

                $2,

                $3,

                true

            )

            ON CONFLICT DO NOTHING
            `,

            [

                chapter_id,

                novel_id,

                coins_required

            ]

        );

        res.json({

            success: true

        });

    }

    catch (err) {

        console.log(err);

        res.status(500).json({

            error: err.message

        });

    }

});

router.post("/unlock", async (req, res) => {

    res.json({

        success: true

    });

});

module.exports = router;