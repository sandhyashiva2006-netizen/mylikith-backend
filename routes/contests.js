const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");



/* ===============================
   GET ALL CONTESTS
================================ */

router.get("/", async (req, res) => {
    try {

        const result = await db.query(`
            SELECT *
            FROM contests
            ORDER BY id DESC
        `);

        res.json(result.rows);

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false,
            message: "Unable to load contests."
        });

    }
});

/* ===============================
   CREATE CONTEST
================================ */

router.post("/", auth, async (req, res) => {

    try {

        if (req.user.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Admin only."
            });
        }

        const {
            title,
            description,
            banner_url,
            prize_pool,
            start_date,
            end_date,
            registration_end,
            rules
        } = req.body;

        const result = await db.query(
            `
            INSERT INTO contests
            (
                title,
                description,
                banner_url,
                prize_pool,
                start_date,
                end_date,
                registration_end,
                rules,
                created_by
            )
            VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            RETURNING *
            `,
            [
                title,
                description,
                banner_url,
                prize_pool || 0,
                start_date,
                end_date,
                registration_end,
                rules,
                req.user.id
            ]
        );

const contestId = result.rows[0].id;

for (const category of categories) {

    if (!category.trim()) continue;

    await db.query(
        `
        INSERT INTO contest_categories
        (
            contest_id,
            category
        )
        VALUES
        ($1,$2)
        `,
        [
            contestId,
            category.trim()
        ]
    );

}

        res.json({
            success: true,
            contest: result.rows[0]
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false,
            message: "Unable to create contest."
        });

    }

});

/* ===============================
   ACTIVE CONTEST
================================ */

router.get("/active", async (req, res) => {

    try {

        const result = await db.query(
            `
            SELECT *
FROM contests
WHERE LOWER(status)='active'
ORDER BY start_date ASC
            `
        );

        if (!result.rows.length) {

    return res.status(404).json({
        success: false,
        message: "No active contest found."
    });

}

res.json({
    success: true,
    contests: result.rows
});

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});


/* ===============================
   ELIGIBLE NOVELS
================================ */

router.get("/eligible-novels", async (req, res) => {

    try {

        const contestId = req.query.contest_id;

        const userId = req.query.user_id;

        if (!contestId || !userId) {

            return res.json([]);

        }

        const contest = await db.query(
            `
            SELECT id, language
            FROM contests
            WHERE id=$1
            `,
            [contestId]
        );

        if (!contest.rows.length) {

            return res.json([]);

        }

        const contestLanguage =
            contest.rows[0].language;

        const novels = await db.query(
            `
            SELECT
                n.id,
                n.title
            FROM novels n
            WHERE
                n.author_id=$1

                AND LOWER(n.publish_status)='published'

                AND LOWER(n.approval_status)='approved'

                AND LOWER(n.language)=LOWER($2)

                AND NOT EXISTS (

                    SELECT 1

                    FROM contest_entries ce

                    WHERE ce.contest_id=$3

                    AND ce.novel_id=n.id

                )

            ORDER BY n.title
            `,
            [
                userId,
                contestLanguage,
                contestId
            ]
        );

        res.json(novels.rows);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: "Failed to load eligible novels."
        });

    }

});

/* ===============================
   PREVIOUS WINNERS
================================ */

router.get("/winners", async (req, res) => {

    try {

        const result = await db.query(
            `
            SELECT
                cw.id,
                cw.position,
                cw.prize_amount AS prize,
                c.title AS contest_title,
                n.title AS novel_title,
                u.name AS writer_name
            FROM contest_winners cw
            JOIN contests c
                ON cw.contest_id = c.id
            JOIN contest_entries ce
                ON cw.entry_id = ce.id
            JOIN novels n
                ON ce.novel_id = n.id
            JOIN users u
                ON ce.writer_id = u.id
            ORDER BY c.end_date DESC, cw.position ASC
            `
        );

        res.json(result.rows);

    } catch (err) {

        console.error("Winners Error:", err);

        res.status(500).json({
            success: false
        });

    }

});

/* ===============================
   UPDATE CONTEST
================================ */

router.put("/:id", auth, async (req, res) => {

    try {

        if (req.user.role !== "admin") {
            return res.status(403).json({
                success: false
            });
        }

        const {
            title,
            description,
            banner_url,
            prize_pool,
            start_date,
            end_date,
            registration_end,
            rules,
            status
        } = req.body;

        await db.query(
            `
            UPDATE contests
            SET
                title=$1,
                description=$2,
                banner_url=$3,
                prize_pool=$4,
                start_date=$5,
                end_date=$6,
                registration_end=$7,
                rules=$8,
                status=$9
            WHERE id=$10
            `,
            [
                title,
                description,
                banner_url,
                prize_pool,
                start_date,
                end_date,
                registration_end,
                rules,
                status,
                req.params.id
            ]
        );

        res.json({
            success: true
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});

/* ===============================
   DELETE CONTEST
================================ */

router.delete("/:id", auth, async (req, res) => {

    try {

        if (req.user.role !== "admin") {
            return res.status(403).json({
                success: false
            });
        }

        await db.query(
            `DELETE FROM contests WHERE id=$1`,
            [req.params.id]
        );

        res.json({
            success: true
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});

/* ===============================
   CONTEST DETAILS
================================ */

router.get("/:id", async (req, res) => {

    try {

        const contest = await db.query(
            `
            SELECT *
            FROM contests
            WHERE id=$1
            `,
            [req.params.id]
        );

        if (!contest.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Contest not found."
            });
        }

        const categories = await db.query(
            `
            SELECT id, category
            FROM contest_categories
            WHERE contest_id=$1
            ORDER BY category
            `,
            [req.params.id]
        );

        res.json({

    success: true,

    contest: {

        ...contest.rows[0],

        categories: categories.rows

    }

});

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});

/* ===============================
   GET CONTEST CATEGORIES
================================ */

router.get("/:id/categories", async (req, res) => {

    try {

        const result = await db.query(
            `
            SELECT *
            FROM contest_categories
            WHERE contest_id=$1
            ORDER BY category
            `,
            [req.params.id]
        );

        res.json(result.rows);

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});

/* ===============================
   ADD CATEGORY
================================ */

router.post("/:id/categories", auth, async (req, res) => {

    try {

        if (req.user.role !== "admin") {
            return res.status(403).json({
                success: false
            });
        }

        const { category } = req.body;

        const result = await db.query(
            `
            INSERT INTO contest_categories
            (contest_id,category)
            VALUES($1,$2)
            RETURNING *
            `,
            [
                req.params.id,
                category
            ]
        );

        res.json({
            success: true,
            category: result.rows[0]
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});

/* ===============================
   DELETE CATEGORY
================================ */

router.delete("/categories/:id", auth, async (req, res) => {

    try {

        if (req.user.role !== "admin") {
            return res.status(403).json({
                success: false
            });
        }

        await db.query(
            `
            DELETE
            FROM contest_categories
            WHERE id=$1
            `,
            [req.params.id]
        );

        res.json({
            success: true
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});



/* ===============================
   REGISTER FOR CONTEST
================================ */

router.post("/:id/register", auth, async (req, res) => {

    try {

        const { novel_id, category_id } = req.body;

        const contest = await db.query(
            `
            SELECT *
            FROM contests
            WHERE id=$1
            `,
            [req.params.id]
        );

        if (!contest.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Contest not found."
            });
        }

const contestData = contest.rows[0];

if (contestData.status !== "Active") {

    return res.status(400).json({
        success: false,
        message: "This contest is not active."
    });

}

if (new Date() > new Date(contestData.registration_end)) {

    return res.status(400).json({
        success: false,
        message: "Contest registration has closed."
    });

}

        const novel = await db.query(
            `
            SELECT id
FROM novels
WHERE id = $1
AND author_id = $2
AND LOWER(publish_status) = 'published'
AND LOWER(approval_status) = 'approved'
AND language = $3
            `,
            [
    novel_id,
    req.user.id,
    contestData.language
]
        );

        if (!novel.rows.length) {
            return res.status(400).json({
                success: false,
                message: "Invalid novel."
            });
        }

const category = await db.query(
    `
    SELECT id
    FROM contest_categories
    WHERE id=$1
    AND contest_id=$2
    `,
    [
        category_id,
        req.params.id
    ]
);

if (!category.rows.length) {

    return res.status(400).json({
        success: false,
        message: "Invalid contest category."
    });

}

        const exists = await db.query(
            `
            SELECT id
            FROM contest_entries
            WHERE contest_id=$1
            AND novel_id=$2
            `,
            [
                req.params.id,
                novel_id
            ]
        );

        if (exists.rows.length) {
            return res.status(400).json({
                success: false,
                message: "Novel already registered."
            });
        }

        await db.query(
            `
            INSERT INTO contest_entries
            (
                contest_id,
                category_id,
                novel_id,
                writer_id
            )
            VALUES
            ($1,$2,$3,$4)
            `,
            [
                req.params.id,
                category_id,
                novel_id,
                req.user.id
            ]
        );

        res.json({
            success: true,
            message: "Contest registration successful."
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});

/* ===============================
   MY CONTEST ENTRY
================================ */

router.get("/:id/my-entry", auth, async (req, res) => {

    try {

        const result = await db.query(
            `
            SELECT
                ce.*,
                n.title,
                cc.category
            FROM contest_entries ce
            JOIN novels n
            ON ce.novel_id=n.id
            JOIN contest_categories cc
            ON ce.category_id=cc.id
            WHERE ce.contest_id=$1
            AND ce.writer_id=$2
            `,
            [
                req.params.id,
                req.user.id
            ]
        );

        res.json(result.rows);

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});

/* ===============================
   ADMIN - VIEW CONTEST ENTRIES
================================ */

router.get("/:id/entries", auth, async (req, res) => {

    try {

        if (req.user.role !== "admin") {
            return res.status(403).json({
                success: false
            });
        }

        const result = await db.query(
            `
            SELECT
                ce.id,
                ce.created_at AS registered_at,
                u.name AS writer_name,
                n.title AS novel_title,
                cc.category
            FROM contest_entries ce
            JOIN users u
                ON ce.writer_id = u.id
            JOIN novels n
                ON ce.novel_id = n.id
            JOIN contest_categories cc
                ON ce.category_id = cc.id
            WHERE ce.contest_id = $1
            ORDER BY ce.created_at DESC
            `,
            [req.params.id]
        );

        res.json(result.rows);

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});

/* ===============================
   ADMIN - REMOVE ENTRY
================================ */

router.delete("/entries/:entryId", auth, async (req, res) => {

    try {

        if (req.user.role !== "admin") {
            return res.status(403).json({
                success: false
            });
        }

        await db.query(
            `
            DELETE
            FROM contest_entries
            WHERE id = $1
            `,
            [req.params.entryId]
        );

        res.json({
            success: true,
            message: "Entry removed successfully."
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});

/* ===============================
   VOTE FOR CONTEST ENTRY
================================ */

router.post("/entries/:entryId/vote", auth, async (req, res) => {

    try {

        const alreadyVoted = await db.query(
            `
            SELECT id
            FROM contest_votes
            WHERE entry_id=$1
            AND voter_id=$2
            `,
            [
                req.params.entryId,
                req.user.id
            ]
        );

        if (alreadyVoted.rows.length) {
            return res.status(400).json({
                success: false,
                message: "You have already voted."
            });
        }

        await db.query(
            `
            INSERT INTO contest_votes
            (entry_id,voter_id)
            VALUES($1,$2)
            `,
            [
                req.params.entryId,
                req.user.id
            ]
        );

        await db.query(
            `
            UPDATE contest_entries
            SET votes=votes+1
            WHERE id=$1
            `,
            [req.params.entryId]
        );

        res.json({
            success: true,
            message: "Vote recorded."
        });

    } catch(err){

        console.log(err);

        res.status(500).json({
            success:false
        });

    }

});

/* ===============================
   CONTEST LEADERBOARD
================================ */

router.get("/:id/leaderboard", async (req, res) => {

    try {

        const result = await db.query(
            `
            SELECT
                ce.id,
                ce.created_at,
                n.title AS novel_title,
                u.name AS writer_name,
                cc.category AS category_name,
                COUNT(cv.id) AS votes
            FROM contest_entries ce

            JOIN novels n
                ON ce.novel_id = n.id

            JOIN users u
                ON ce.writer_id = u.id

            JOIN contest_categories cc
                ON ce.category_id = cc.id

            LEFT JOIN contest_votes cv
                ON cv.entry_id = ce.id

            WHERE ce.contest_id = $1

            GROUP BY
                ce.id,
                ce.created_at,
                n.title,
                u.name,
                cc.category

            ORDER BY
                votes DESC,
                ce.created_at ASC
            `,
            [req.params.id]
        );

        res.json(result.rows);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false
        });

    }

});



module.exports = router;