const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");


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

// Get all contests
router.get("/", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT
                c.*,
                (
                    SELECT COUNT(*)
                    FROM contest_entries ce
                    WHERE ce.contest_id = c.id
                ) AS entries
            FROM contests c
            ORDER BY c.created_at DESC
        `);

        res.json(result.rows);

    } catch (err) {

        console.error(err);
        res.status(500).json({
            success: false,
            message: "Failed to load contests."
        });

    }

});



// Create contest
router.post("/", async (req, res) => {

    try {

        const {
    title,
    description,
    language,
    prize_pool,
    registration_end,
    start_date,
    end_date,
    status,
    banner_url,
    rules,
    categories = []
} = req.body;

        const result = await db.query(`
            INSERT INTO contests
            (
                title,
                description,
                language,
                prize_pool,
                registration_end,
                start_date,
                end_date,
                status,
                rules
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            RETURNING *
        `,
        [
            title,
            description,
            language,
            prize_pool,
            registration_end,
            start_date,
            end_date,
            status,
            rules
        ]);

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

        console.error(err);

        res.status(500).json({
            success: false,
            message: "Failed to create contest."
        });

    }

});

// Get single contest
router.get("/:id", async (req, res) => {

    try {

        const contestResult = await db.query(
            `
            SELECT *
            FROM contests
            WHERE id=$1
            `,
            [req.params.id]
        );

        if (!contestResult.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Contest not found."
            });

        }

        const categoryResult = await db.query(
            `
            SELECT
                id,
                category
            FROM contest_categories
            WHERE contest_id=$1
            ORDER BY id
            `,
            [req.params.id]
        );

        const contest = contestResult.rows[0];

        contest.categories = categoryResult.rows;

        res.json(contest);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: "Server error."
        });

    }

});

// Update contest
router.put("/:id", async (req, res) => {

    try {

        const {
    title,
    description,
    language,
    prize_pool,
    registration_end,
    start_date,
    end_date,
    status,
    banner_url,
    rules,
    categories = []
} = req.body;

        const result = await db.query(`
            UPDATE contests
            SET
                title=$1,
                description=$2,
                language=$3,
                prize_pool=$4,
                registration_end=$5,
                start_date=$6,
                end_date=$7,
                status=$8,
                rules=$9
            WHERE id=$10
            RETURNING *
        `,
        [
            title,
            description,
            language,
            prize_pool,
            registration_end,
            start_date,
            end_date,
            status,
            rules,
            req.params.id
        ]);

await db.query(
    `
    DELETE
    FROM contest_categories
    WHERE contest_id=$1
    `,
    [req.params.id]
);

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
            req.params.id,
            category.trim()
        ]
    );

}

        res.json({
            success: true,
            contest: result.rows[0]
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: "Failed to update contest."
        });

    }

});

router.delete("/:id", async (req, res) => {

    try {

        await db.query("BEGIN");

        await db.query(
            `
            DELETE FROM contest_winners
            WHERE contest_id=$1
            `,
            [req.params.id]
        );

        await db.query(
            `
            DELETE FROM contest_votes
            WHERE contest_id=$1
            `,
            [req.params.id]
        );

        await db.query(
            `
            DELETE FROM contest_entries
            WHERE contest_id=$1
            `,
            [req.params.id]
        );

        await db.query(
            `
            DELETE FROM contest_categories
            WHERE contest_id=$1
            `,
            [req.params.id]
        );

        await db.query(
            `
            DELETE FROM contests
            WHERE id=$1
            `,
            [req.params.id]
        );

        await db.query("COMMIT");

        res.json({
            success: true
        });

    } catch (err) {

        await db.query("ROLLBACK");

        console.error(err);

        res.status(500).json({
            success: false,
            message: "Failed to delete contest."
        });

    }

});

router.delete("/contest-entries/:id", async (req, res) => {

    try {

        await db.query(
            `
            DELETE
            FROM contest_entries
            WHERE id=$1
            `,
            [req.params.id]
        );

        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: "Failed to remove entry."
        });

    }

});

router.post("/:id/winners", auth, async (req, res) => {

    try {

        if (req.user.role !== "admin") {

            return res.status(403).json({
                success: false,
                message: "Admin only."
            });

        }

        const { winners } = req.body;

        if (!Array.isArray(winners) || winners.length !== 3) {

            return res.status(400).json({
                success: false,
                message: "Exactly 3 winners are required."
            });

        }

        const unique = new Set(winners);

        if (unique.size !== 3) {

            return res.status(400).json({
                success: false,
                message: "Please select three different winners."
            });

        }

        const contest = await db.query(
            `
            SELECT
                prize_pool,
                end_date
            FROM contests
            WHERE id = $1
            `,
            [req.params.id]
        );

        if (!contest.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Contest not found."
            });

        }

        if (new Date() < new Date(contest.rows[0].end_date)) {

            return res.status(400).json({
                success: false,
                message: "Winners can only be announced after the contest ends."
            });

        }

        const prizePool = Number(contest.rows[0].prize_pool || 0);

        const prizes = [

            Math.round(prizePool * 0.60),

            Math.round(prizePool * 0.30),

            Math.round(prizePool * 0.10)

        ];

        const badges = [

            "Gold Winner",

            "Silver Winner",

            "Bronze Winner"

        ];

        await db.query(
            `
            DELETE
            FROM contest_winners
            WHERE contest_id = $1
            `,
            [req.params.id]
        );

        for (let i = 0; i < winners.length; i++) {

            const entry = await db.query(
                `
                SELECT
                    novel_id,
                    writer_id
                FROM contest_entries
                WHERE id = $1
                `,
                [winners[i]]
            );

            if (!entry.rows.length) {

                continue;

            }

            const {

                novel_id,

                writer_id

            } = entry.rows[0];

            await db.query(
                `
                INSERT INTO contest_winners
                (
                    contest_id,
                    novel_id,
                    writer_id,
                    position,
                    prize_amount,
                    badge
                )
                VALUES
                ($1,$2,$3,$4,$5,$6)
                `,
                [
                    req.params.id,
                    novel_id,
                    writer_id,
                    i + 1,
                    prizes[i],
                    badges[i]
                ]
            );

            await db.query(
                `
                UPDATE novels
                SET winner_badge = $1
                WHERE id = $2
                `,
                [
                    badges[i],
                    novel_id
                ]
            );

            await db.query(
                `
                UPDATE users
                SET winner_badge = $1
                WHERE id = $2
                `,
                [
                    badges[i],
                    writer_id
                ]
            );

        }

        await db.query(
            `
            UPDATE contests
            SET status = 'Completed'
            WHERE id = $1
            `,
            [req.params.id]
        );

        res.json({

            success: true,

            message: "Winners announced successfully."

        });

    } catch (err) {

        console.error(err);

        res.status(500).json({

            success: false,

            message: "Failed to announce winners."

        });

    }

});

router.get("/:id/entries", auth, async (req, res) => {

console.log("User:", req.user);
console.log("Contest ID:", req.params.id);

    try {

        if (req.user.role !== "admin") {

            return res.status(403).json({
                success: false,
                message: "Admin only."
            });

        }

        const result = await db.query(
            `
            SELECT

                ce.id,
                ce.novel_id,
                ce.category_id,
                ce.created_at,

(
    SELECT COUNT(*)
    FROM contest_votes cv
    WHERE cv.entry_id = ce.id
) AS votes,

                n.title AS novel_title,

                u.name AS writer_name,

                cc.category AS category_name

            FROM contest_entries ce

            JOIN novels n
                ON ce.novel_id = n.id

            JOIN users u
                ON ce.writer_id = u.id

            JOIN contest_categories cc
                ON ce.category_id = cc.id

            WHERE ce.contest_id = $1

            ORDER BY ce.created_at

            `,
            [req.params.id]
        );

console.log("Entries:", result.rows);

        res.json(result.rows);

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});

module.exports = router;