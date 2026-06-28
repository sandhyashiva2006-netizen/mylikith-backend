const express = require("express");
const router = express.Router();

const db = require("../db");

/* ===========================
   GET WALLET
=========================== */

router.get("/:userId", async (req, res) => {

    try {

        let wallet = await db.query(
            `
            SELECT *
            FROM wallets
            WHERE user_id=$1
            `,
            [req.params.userId]
        );

        if (wallet.rows.length === 0) {

            await db.query(
                `
                INSERT INTO wallets
                (user_id,balance,coins)
                VALUES($1,0,0)
                `,
                [req.params.userId]
            );

            wallet = await db.query(
                `
                SELECT *
                FROM wallets
                WHERE user_id=$1
                `,
                [req.params.userId]
            );

        }

        res.json(wallet.rows[0]);

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});


/* ===========================
   WALLET HISTORY
=========================== */

router.get("/:userId/history", async (req, res) => {

    try {

        const result = await db.query(

            `
            SELECT
            id,
            type,
            amount,
            description,
            created_at

            FROM wallet_transactions

            WHERE user_id=$1

            ORDER BY id DESC
            `,
            [req.params.userId]

        );

        res.json(result.rows);

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});


/* ===========================
   CREDIT
=========================== */

router.post("/credit", async (req, res) => {

    try {

        const {

            user_id,
            amount,
            description

        } = req.body;

        await db.query(

            `
            UPDATE wallets

            SET balance=balance+$1

            WHERE user_id=$2
            `,

            [
                amount,
                user_id
            ]

        );

        await db.query(

            `
            INSERT INTO wallet_transactions
            (
            user_id,
            type,
            amount,
            description
            )

            VALUES
            ($1,'Credit',$2,$3)
            `,

            [
                user_id,
                amount,
                description
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


/* ===========================
   DEBIT
=========================== */

router.post("/debit", async (req, res) => {

    try {

        const {

            user_id,
            amount,
            description

        } = req.body;

        const wallet = await db.query(

            `
            SELECT balance

            FROM wallets

            WHERE user_id=$1
            `,

            [
                user_id
            ]

        );

        if (wallet.rows.length === 0) {

            return res.status(404).json({

                success: false,

                message: "Wallet not found"

            });

        }

        if (Number(wallet.rows[0].balance) < Number(amount)) {

            return res.status(400).json({

                success: false,

                message: "Insufficient Balance"

            });

        }

        await db.query(

            `
            UPDATE wallets

            SET balance=balance-$1

            WHERE user_id=$2
            `,

            [
                amount,
                user_id
            ]

        );

        await db.query(

            `
            INSERT INTO wallet_transactions
            (
            user_id,
            type,
            amount,
            description
            )

            VALUES
            ($1,'Debit',$2,$3)
            `,

            [
                user_id,
                amount,
                description
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


/* ===========================
   SUMMARY
=========================== */

router.get("/:userId/summary", async (req, res) => {

    try {

        const wallet = await db.query(

            `
            SELECT
            balance,
            coins
            FROM wallets
            WHERE user_id=$1
            `,

            [
                req.params.userId
            ]

        );

        const credit = await db.query(

            `
            SELECT
            COALESCE(SUM(amount),0) total

            FROM wallet_transactions

            WHERE

            user_id=$1

            AND

            type='Credit'
            `,

            [
                req.params.userId
            ]

        );

        const debit = await db.query(

            `
            SELECT
            COALESCE(SUM(amount),0) total

            FROM wallet_transactions

            WHERE

            user_id=$1

            AND

            type='Debit'
            `,

            [
                req.params.userId
            ]

        );

        const total = await db.query(

            `
            SELECT COUNT(*) total

            FROM wallet_transactions

            WHERE user_id=$1
            `,

            [
                req.params.userId
            ]

        );

        res.json({

            balance: wallet.rows[0]?.balance || 0,

            coins: wallet.rows[0]?.coins || 0,

            credits: credit.rows[0].total,

            debits: debit.rows[0].total,

            transactions: Number(total.rows[0].total)

        });

    } catch (err) {

        console.log(err);

        res.status(500).json({

            success: false

        });

    }

});

module.exports = router;