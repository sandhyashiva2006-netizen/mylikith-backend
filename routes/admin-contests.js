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

module.exports = router;