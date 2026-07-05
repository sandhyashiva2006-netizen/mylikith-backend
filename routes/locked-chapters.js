const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/:chapterId/:userId", async (req, res) => {

    try {

        const { chapterId, userId } = req.params;

const premium = await db.query(

`
SELECT id

FROM user_premium

WHERE

user_id=$1

AND status='Active'

AND expiry_date>NOW()

LIMIT 1
`,

[
userId
]

);

const isPremium =
premium.rows.length > 0;

        const locked = await db.query(

            `
            SELECT
id,
is_premium,
coins_required,
novel_id
FROM chapters
WHERE id=$1
            `,

            [chapterId]

        );

        if (
locked.rows.length === 0 ||
!locked.rows[0].is_premium
){

    return res.json({

        locked:false

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

if(isPremium){

return res.json({

locked:false,

premium:true

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

    const client = await db.connect();

    try {

        await client.query("BEGIN");

        const {

            user_id,

            chapter_id

        } = req.body;

        const lockResult =
            await client.query(

                `
                SELECT
id,
novel_id,
coins_required,
is_premium
FROM chapters
WHERE id=$1
                `,

                [

                    chapter_id

                ]

            );

        if(
lockResult.rows.length===0 ||
!lockResult.rows[0].is_premium
){

            await client.query("ROLLBACK");

            return res.json({

                success:false,

                message:"Chapter is free."

            });

        }

        const lock =
            lockResult.rows[0];

const premium=await client.query(

`
SELECT id

FROM user_premium

WHERE

user_id=$1

AND status='Active'

AND expiry_date>NOW()

LIMIT 1
`,

[
user_id
]

);

const isPremium=
premium.rows.length>0;

        const alreadyUnlocked =
            await client.query(

                `
                SELECT id

                FROM unlocked_chapters

                WHERE user_id=$1

                AND chapter_id=$2
                `,

                [

                    user_id,

                    chapter_id

                ]

            );

        if(alreadyUnlocked.rows.length){

            await client.query("ROLLBACK");

            return res.json({

                success:true,

                message:"Already unlocked."

            });

        }

        const wallet =
            await client.query(

                `
                SELECT *

                FROM wallets

                WHERE user_id=$1
                `,

                [

                    user_id

                ]

            );

        if(wallet.rows.length===0){

            await client.query("ROLLBACK");

            return res.json({

                success:false,

                message:"Wallet not found."

            });

        }

 if(

!isPremium &&

wallet.rows[0].coins < lock.coins_required

){

    await client.query("ROLLBACK");

    return res.json({

        success:false,

        message:"Not enough coins."

    });

}

if(!isPremium){

        await client.query(

            `
            UPDATE wallets

            SET

            coins = coins - $1,

            spent_coins = spent_coins + $1

            WHERE user_id=$2
            `,

            [

                lock.coins_required,

                user_id

            ]

        );
}

        await client.query(

            `
            INSERT INTO unlocked_chapters
            (

                user_id,

                chapter_id,

                novel_id,

                coins_paid

            )

            VALUES

            (

                $1,

                $2,

                $3,

                $4

            )
            `,

            [

                user_id,

                chapter_id,

                lock.novel_id,

                lock.coins_required

            ]

        );

if(isPremium){

console.log(

`Premium access granted for User ${user_id} -> Chapter ${chapter_id}`

);

}

        const novel =
            await client.query(

                `
                SELECT author_id

                FROM novels

                WHERE id=$1
                `,

                [

                    lock.novel_id

                ]

            );

        const writerId =
            novel.rows[0].author_id;

        const settings =
await client.query(

`
SELECT *

FROM platform_settings

LIMIT 1
`

);

const writerShare =
Number(
settings.rows[0].writer_share
);

const writerAmount =
Number(

(

lock.coins_required *

(writerShare / 100)

).toFixed(2)

);

await client.query(

`
INSERT INTO writer_earnings
(

    writer_id,

    user_id,

    novel_id,

    chapter_id,

    coins,

    amount

)

VALUES

(

    $1,

    $2,

    $3,

    $4,

    $5,

    $6

)
`,

[

    writerId,

    user_id,

    lock.novel_id,

    chapter_id,

    lock.coins_required,

    writerAmount

]

);

if(!isPremium){

        await client.query(

            `
            INSERT INTO wallet_transactions
            (

                wallet_id,

                user_id,

                type,

                coins,

                amount,

                description,

                reference_id

            )

            SELECT

                id,

                user_id,

                'Debit',

                $1,

                0,

                'Premium Chapter Unlock',

                NULL

            FROM wallets

            WHERE user_id=$2
            `,

            [

                lock.coins_required,

                user_id

            ]

        );

}

        await client.query("COMMIT");

        res.json({

            success:true,

            message:"Chapter unlocked."

        });

    }

    catch(err){

        await client.query("ROLLBACK");

        console.log(err);

        res.status(500).json({

            success:false,

            error:err.message

        });

    }

    finally{

        client.release();

    }

});

router.get(
"/ad/status/:userId",
async(req,res)=>{

try{

const result=await db.query(

`
SELECT COUNT(*) total

FROM rewarded_ad_unlocks

WHERE

user_id=$1

AND

created_at>=NOW()-INTERVAL '24 HOURS'
`,

[
req.params.userId
]

);

const used=
Number(result.rows[0].total);

res.json({

used,

remaining:

Math.max(0,2-used),

eligible:

used<2

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

router.post(
"/ad/start",
async(req,res)=>{

try{

const{

user_id,

chapter_id

}=req.body;

await db.query(

`
INSERT INTO rewarded_ad_sessions(

user_id,

chapter_id

)

VALUES(

$1,

$2

)

ON CONFLICT(user_id,chapter_id)

DO NOTHING
`,

[
user_id,
chapter_id
]

);

res.json({

success:true

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

router.post(
"/ad/viewed",
async(req,res)=>{

try{

const{

user_id,

chapter_id

}=req.body;

const existingSession=await db.query(

`
SELECT *

FROM rewarded_ad_sessions

WHERE

user_id=$1

AND

chapter_id=$2

AND

completed=false
`,

[
user_id,
chapter_id
]

);

if(existingSession.rows.length===0){

return res.status(400).json({

success:false,

message:"Invalid ad session."

});

}

const session=

await db.query(

`
UPDATE rewarded_ad_sessions

SET

views_completed=

LEAST(

views_completed+1,

required_views

),

updated_at=NOW()

WHERE

user_id=$1

AND

chapter_id=$2

RETURNING *
`,

[
user_id,
chapter_id
]

);

if(!session.rows.length){

return res.json({

success:false

});

}

const ad=session.rows[0];

if(ad.views_completed<2){

return res.json({

success:true,

completed:false,

remaining:

2-ad.views_completed

});

}

/* ---------- Unlock Chapter ---------- */

await db.query(

`
INSERT INTO unlocked_chapters(

user_id,

chapter_id,

coins_paid

)

VALUES(

$1,

$2,

0

)

ON CONFLICT DO NOTHING
`,

[
user_id,
chapter_id
]

);

await db.query(

`
UPDATE rewarded_ad_sessions

SET completed=true

WHERE id=$1
`,

[
ad.id
]

);

await db.query(

`
INSERT INTO rewarded_ad_unlocks(

user_id,

chapter_id

)

VALUES(

$1,

$2

)

ON CONFLICT DO NOTHING
`,

[
user_id,
chapter_id
]

);



await db.query(

`
DELETE FROM rewarded_ad_sessions

WHERE id=$1
`,

[
ad.id
]

);

res.json({

success:true,

completed:true

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

module.exports = router;