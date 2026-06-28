require("dotenv").config();

const express = require("express");
const cors = require("cors");

const pool = require("./db");

const app = express();

const multer =
require("multer");

const path =
require("path");

const storage =
multer.diskStorage({

destination:

(req,file,cb)=>{

cb(
null,
"uploads/covers"
);

},

filename:

(req,file,cb)=>{

cb(

null,

Date.now()

+

path.extname(
file.originalname
)

);

}

});

const upload =
multer({

storage

});

const authRoutes =
require("./routes/auth");
const writerRoutes =
require("./routes/writers");
const publishRoutes=require("./routes/publish.routes");


app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use(
"/api/writers",
writerRoutes
);
app.use("/api/publish",publishRoutes);


app.get("/", (req, res) => {
  res.json({
    success: true,
    app: "Mylikith",
    status: "Running"
  });
});

app.get("/api/novels", async (req, res) => {
  try {

    const result = await pool.query(
      "SELECT * FROM novels ORDER BY id DESC"
    );

    res.json(result.rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Failed to load novels"
    });

  }
});

app.get("/api/novels/:id", async (req, res) => {
  try {

    const result = await pool.query(
      "SELECT * FROM novels WHERE id=$1",
      [req.params.id]
    );

    res.json(result.rows[0]);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Failed to load novel"
    });

  }
});

app.get("/api/chapters/:id", async (req, res) => {

try{

const result = await pool.query(

`SELECT * FROM chapters WHERE id=$1`,

[req.params.id]

);

if(result.rows.length===0){

return res.status(404).json({

success:false,

message:"Chapter not found"

});

}

res.json(result.rows[0]);

}catch(err){

console.error("Chapter API Error:",err);

res.status(500).json({

success:false,

error:err.message

});

}

});

app.get(
"/api/novels/:id/chapters",
async (req,res)=>{

try{

const result =
await pool.query(

`
SELECT *
FROM chapters
WHERE novel_id=$1
ORDER BY chapter_no ASC
`,

[
req.params.id
]

);

res.json(
result.rows
);

}

catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

app.get("/api/search", async (req,res)=>{

try{

const q =
req.query.q;

const result =
await pool.query(

`
SELECT *
FROM novels

WHERE

LOWER(title)
LIKE LOWER($1)

ORDER BY id DESC
`,

[
`%${q}%`
]

);

res.json(
result.rows
);

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

app.post(
"/api/follow",
async (req,res)=>{

try{

const {
user_id,
author_id
} = req.body;

await pool.query(

`
INSERT INTO follows
(user_id, author_id)

VALUES ($1,$2)

ON CONFLICT
(user_id, author_id)

DO NOTHING
`,

[
user_id,
author_id
]

);

res.json({
success:true
});

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

app.get(
"/api/follow-status",
async (req,res)=>{

try{

const {
user_id,
author_id
} = req.query;

const result =
await pool.query(

`
SELECT *
FROM follows

WHERE

user_id=$1
AND
author_id=$2
`,

[
user_id,
author_id
]

);

res.json({

following:
result.rows.length > 0

});

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

app.post(
"/api/reviews",
async (req,res)=>{

try{

const {
user_id,
novel_id,
rating,
review
} = req.body;

await pool.query(

`
INSERT INTO reviews
(
user_id,
novel_id,
rating,
review
)

VALUES
($1,$2,$3,$4)

ON CONFLICT
(user_id,novel_id)

DO UPDATE SET

rating=$3,
review=$4
`,

[
user_id,
novel_id,
rating,
review
]

);

await pool.query(

`
UPDATE novels

SET rating=(

SELECT
COALESCE(
ROUND(AVG(rating),1),
0
)

FROM reviews

WHERE novel_id=$1

)

WHERE id=$1
`,

[
novel_id
]

);

res.json({
success:true
});

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

app.get(
"/api/reviews/:novelId",
async (req,res)=>{

try{

const result =
await pool.query(

`
SELECT
r.*,
u.name

FROM reviews r

JOIN users u

ON r.user_id=u.id

WHERE r.novel_id=$1

ORDER BY r.id DESC
`,

[
req.params.novelId
]

);

res.json(
result.rows
);

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

app.get(
"/api/rating/:novelId",
async (req,res)=>{

try{

const result =
await pool.query(

`
SELECT

ROUND(
AVG(rating),
1
) AS rating,

COUNT(*) AS total

FROM reviews

WHERE novel_id=$1
`,

[
req.params.novelId
]

);

res.json(
result.rows[0]
);

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

app.get(
"/api/follow-count/:authorId",
async (req,res)=>{

const result =
await pool.query(

`
SELECT COUNT(*)
FROM follows
WHERE author_id=$1
`,

[
req.params.authorId
]

);

res.json({
count:
result.rows[0].count
});

});


app.post(
"/api/novels/:id/view",
async (req,res)=>{

try{

await pool.query(

`
UPDATE novels

SET views = views + 1

WHERE id = $1
`,

[
req.params.id
]

);

res.json({
success:true
});

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

app.post(
"/api/comments",
async(req,res)=>{

try{

const {
user_id,
chapter_id,
comment
} = req.body;

await pool.query(

`
INSERT INTO comments
(
user_id,
chapter_id,
comment
)

VALUES
($1,$2,$3)
`,

[
user_id,
chapter_id,
comment
]

);

res.json({
success:true
});

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

app.get(
"/api/comments/:chapterId",
async(req,res)=>{

try{

const result =
await pool.query(

`
SELECT

c.*,
u.name

FROM comments c

JOIN users u

ON c.user_id=u.id

WHERE c.chapter_id=$1

ORDER BY c.id DESC
`,

[
req.params.chapterId
]

);

res.json(
result.rows
);

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

app.get(
"/api/profile/stats/:userId",
async(req,res)=>{

try{

const userId =
req.params.userId;

const bookmarks =
await pool.query(

`
SELECT COUNT(*)
FROM bookmarks

WHERE user_id=$1
`,

[userId]
);

const follows =
await pool.query(

`
SELECT COUNT(*)
FROM follows

WHERE user_id=$1
`,

[userId]
);

const reviews =
await pool.query(

`
SELECT COUNT(*)
FROM reviews

WHERE user_id=$1
`,

[userId]
);

const comments =
await pool.query(

`
SELECT COUNT(*)
FROM comments

WHERE user_id=$1
`,

[userId]
);

res.json({

bookmarks:
bookmarks.rows[0].count,

follows:
follows.rows[0].count,

reviews:
reviews.rows[0].count,

comments:
comments.rows[0].count

});

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

app.get("/api/profile/continue/:userId", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                rp.chapter_id,
                c.title AS chapter_title,
                n.title AS novel_title
            FROM reading_progress rp
            JOIN chapters c ON rp.chapter_id = c.id
            JOIN novels n ON c.novel_id = n.id
            WHERE rp.user_id = $1
            ORDER BY rp.updated_at DESC
            LIMIT 1
        `, [req.params.userId]);

        res.json(result.rows[0] || null);

    } catch (err) {

        console.log(err);
        res.status(500).json({ success:false });

    }

});

app.get("/api/profile/history/:userId", async (req, res) => {

    try {

        const result = await pool.query(`

SELECT

rh.chapter_id,

c.title AS chapter_title,

n.title AS novel_title,

rh.last_read_at

FROM reading_history rh

JOIN chapters c
ON rh.chapter_id = c.id

JOIN novels n
ON c.novel_id = n.id

WHERE rh.user_id = $1

ORDER BY rh.last_read_at DESC

LIMIT 10

`, [req.params.userId]);

        res.json(result.rows);

    } catch(err){

        console.log(err);

        res.status(500).json({
            success:false
        });

    }

});

app.get("/api/profile/reviews/:userId", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                r.id,
                r.rating,
                r.review,
                n.id AS novel_id,
                n.title AS novel_title
            FROM reviews r
            JOIN novels n
            ON r.novel_id = n.id
            WHERE r.user_id = $1
            ORDER BY r.id DESC
        `,[req.params.userId]);

        res.json(result.rows);

    } catch(err){

        console.log(err);

        res.status(500).json({
            success:false
        });

    }

});

app.get("/api/profile/comments/:userId", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                c.id,
                c.comment,
                ch.id AS chapter_id,
                ch.title AS chapter_title,
                n.title AS novel_title
            FROM comments c
            JOIN chapters ch
            ON c.chapter_id = ch.id
            JOIN novels n
            ON ch.novel_id = n.id
            WHERE c.user_id = $1
            ORDER BY c.id DESC
        `,[req.params.userId]);

        res.json(result.rows);

    } catch(err){

        console.log(err);

        res.status(500).json({
            success:false
        });

    }

});

app.get("/api/writer/analytics/:authorId", async (req, res) => {

    try {

        const authorId = req.params.authorId;

        const novels = await pool.query(`
            SELECT COUNT(*) AS total
            FROM novels
            WHERE author_id = $1
        `,[authorId]);

        const chapters = await pool.query(`
            SELECT COUNT(*) AS total
            FROM chapters c
            JOIN novels n
            ON c.novel_id = n.id
            WHERE n.author_id = $1
        `,[authorId]);

        const reads = await pool.query(`
            SELECT
            COALESCE(SUM(views),0) AS total
            FROM novels
            WHERE author_id = $1
        `,[authorId]);

        const followers = await pool.query(`
            SELECT
            COUNT(*) AS total
            FROM follows
            WHERE author_id = $1
        `,[authorId]);

        const rating = await pool.query(`
            SELECT
            ROUND(AVG(r.rating),1) AS rating
            FROM reviews r
            JOIN novels n
            ON r.novel_id = n.id
            WHERE n.author_id = $1
        `,[authorId]);

        res.json({

            novels: novels.rows[0].total,

            chapters: chapters.rows[0].total,

            reads: reads.rows[0].total,

            followers: followers.rows[0].total,

            rating: rating.rows[0].rating || 0

        });

    } catch(err){

        console.log(err);

        res.status(500).json({
            success:false
        });

    }

});

app.use(

"/uploads",

express.static(

"uploads"

)

);

app.post(

"/api/upload-cover",

upload.single(
"cover"
),

(req,res)=>{

res.json({

success:true,

url:

`https://mylikith-backend.onrender.com/uploads/covers/${req.file.filename}`

});

});

const PORT = process.env.PORT || 5000;

app.get("/api/debug-users-columns", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json(err.message);
  }
});

app.get("/api/debug-db", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT current_database(), current_schema()
    `);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json(err.message);
  }
});

app.get("/api/users/:id", async (req, res) => {

try{

const author=await pool.query(
`
SELECT
id,
name,
bio,
profile_image
FROM users
WHERE id=$1
`,
[req.params.id]
);

const followers=await pool.query(
`
SELECT COUNT(*) total
FROM follows
WHERE author_id=$1
`,
[req.params.id]
);

const novels=await pool.query(
`
SELECT COUNT(*) total
FROM novels
WHERE author_id=$1
`,
[req.params.id]
);

const rating=await pool.query(
`
SELECT ROUND(AVG(r.rating),1) rating
FROM reviews r
JOIN novels n
ON r.novel_id=n.id
WHERE n.author_id=$1
`,
[req.params.id]
);

res.json({

...author.rows[0],

followers:followers.rows[0].total,

total_novels:novels.rows[0].total,

rating:rating.rows[0].rating||0

});

}catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

app.post("/api/library",async(req,res)=>{

try{

const{

user_id,

novel_id

}=req.body;

await pool.query(

`INSERT INTO library(user_id,novel_id)

VALUES($1,$2)

ON CONFLICT(user_id,novel_id)

DO NOTHING`,

[user_id,novel_id]

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

app.post("/api/reader/reading-history", async (req,res)=>{

try{

const{
user_id,
novel_id,
chapter_id
}=req.body;

await pool.query(

`
INSERT INTO reading_history
(user_id,novel_id,chapter_id,last_read_at)

VALUES($1,$2,$3,NOW())

ON CONFLICT(user_id,chapter_id)

DO UPDATE SET

last_read_at=NOW()
`,

[user_id,novel_id,chapter_id]

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

app.get("/api/writer/activity/:authorId",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT

'Novel Created' AS action,

title,

created_at

FROM novels

WHERE author_id=$1

UNION ALL

SELECT

'Chapter Published',

title,

created_at

FROM chapters

WHERE novel_id IN(

SELECT id

FROM novels

WHERE author_id=$1

)

ORDER BY created_at DESC

LIMIT 10
`,

[req.params.authorId]

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.get("/api/writer/notifications/:authorId", async(req,res)=>{

try{

const result=await pool.query(

`
SELECT *

FROM writer_notifications

WHERE author_id=$1

ORDER BY id DESC

LIMIT 20
`,

[req.params.authorId]

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.get("/api/writer/top-novel/:authorId",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT

title,

views,

rating

FROM novels

WHERE author_id=$1

ORDER BY

views DESC

LIMIT 1
`,

[req.params.authorId]

);

res.json(result.rows[0]||null);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.post("/api/report",async(req,res)=>{

try{

const{

user_id,

type,

reported_item,

reason

}=req.body;

await pool.query(

`

INSERT INTO reports

(

user_id,

type,

reported_item,

reason

)

VALUES

($1,$2,$3,$4)

`,

[

user_id,

type,

reported_item,

reason

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

/* ===========================
   ADMIN DASHBOARD
=========================== */

app.get("/api/admin/dashboard", async(req,res)=>{

try{

const users=await pool.query(
"SELECT COUNT(*) total FROM users"
);

const writers=await pool.query(
"SELECT COUNT(*) total FROM users WHERE role='writer'"
);

const novels=await pool.query(
"SELECT COUNT(*) total FROM novels"
);

const chapters=await pool.query(
"SELECT COUNT(*) total FROM chapters"
);

const reviews=await pool.query(
"SELECT COUNT(*) total FROM reviews"
);

const comments=await pool.query(
"SELECT COUNT(*) total FROM comments"
);

const views=await pool.query(
"SELECT COALESCE(SUM(views),0) total FROM novels"
);

res.json({

users:Number(users.rows[0].total),

writers:Number(writers.rows[0].total),

novels:Number(novels.rows[0].total),

chapters:Number(chapters.rows[0].total),

reviews:Number(reviews.rows[0].total),

comments:Number(comments.rows[0].total),

views:Number(views.rows[0].total),

reports:0

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});


app.get("/api/admin/recent-users",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT

id,

name,

email,

role

FROM users

ORDER BY id DESC

LIMIT 10
`

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});


app.get("/api/admin/recent-novels",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT

n.id,

n.title,

n.status,

u.name AS author

FROM novels n

LEFT JOIN users u

ON n.author_id=u.id

ORDER BY n.id DESC

LIMIT 10
`

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.get("/api/admin/users",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT

id,
name,
email,
role

FROM users

ORDER BY id DESC
`

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.put("/api/admin/users/:id/role",async(req,res)=>{

try{

await pool.query(

`
UPDATE users

SET role=$1

WHERE id=$2
`,

[
req.body.role,
req.params.id
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

app.delete("/api/admin/users/:id",async(req,res)=>{

try{

await pool.query(

`
DELETE FROM users

WHERE id=$1
`,

[
req.params.id
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

app.get("/api/admin/novels",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT

n.*,

u.name AS author

FROM novels n

LEFT JOIN users u

ON n.author_id=u.id

ORDER BY n.id DESC
`

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.delete("/api/admin/novels/:id",async(req,res)=>{

try{

await pool.query(

`
DELETE FROM novels

WHERE id=$1
`,

[
req.params.id
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

app.put("/api/admin/novels/:id/feature",async(req,res)=>{

try{

await pool.query(

`
UPDATE novels

SET featured=TRUE

WHERE id=$1
`,

[
req.params.id
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

app.get("/api/admin/chapters",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT

c.id,

c.chapter_no,

c.title,

n.title AS novel,

u.name AS author

FROM chapters c

JOIN novels n
ON c.novel_id=n.id

LEFT JOIN users u
ON n.author_id=u.id

ORDER BY c.id DESC
`

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.delete("/api/admin/chapters/:id",async(req,res)=>{

try{

await pool.query(

`
DELETE FROM chapters

WHERE id=$1
`,

[
req.params.id
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

app.get("/api/admin/reports",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT *

FROM reports

ORDER BY id DESC
`

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.put("/api/admin/reports/:id/resolve",async(req,res)=>{

try{

await pool.query(

`
UPDATE reports

SET status='Resolved'

WHERE id=$1
`,

[
req.params.id
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

app.delete("/api/admin/reports/:id",async(req,res)=>{

try{

await pool.query(

`
DELETE FROM reports

WHERE id=$1
`,

[
req.params.id
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

app.get("/api/admin/settings",async(req,res)=>{

const result=

await pool.query(

"SELECT * FROM site_settings LIMIT 1"

);

res.json(result.rows[0]);

});

app.put("/api/admin/settings",async(req,res)=>{

const{

site_name,

announcement,

maintenance

}=req.body;

await pool.query(

`

UPDATE site_settings

SET

site_name=$1,

announcement=$2,

maintenance=$3

WHERE id=1

`,

[

site_name,

announcement,

maintenance

]

);

res.json({

success:true

});

});

app.get("/api/admin/writers",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT

u.id,

u.name,

u.email,

COUNT(n.id) AS novels

FROM users u

LEFT JOIN novels n

ON u.id=n.author_id

WHERE u.role='writer'

GROUP BY u.id

ORDER BY u.id DESC
`

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.delete("/api/admin/writers/:id",async(req,res)=>{

try{

await pool.query(

`

UPDATE users

SET role='reader'

WHERE id=$1

`,

[

req.params.id

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

app.get("/api/admin/reviews",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT

r.id,

r.rating,

r.comment,

u.name AS user,

n.title AS novel

FROM reviews r

LEFT JOIN users u
ON r.user_id=u.id

LEFT JOIN novels n
ON r.novel_id=n.id

ORDER BY r.id DESC
`

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.delete("/api/admin/reviews/:id",async(req,res)=>{

try{

await pool.query(

`
DELETE FROM reviews

WHERE id=$1
`,

[
req.params.id
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

app.get("/api/admin/comments",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT

c.id,

c.comment,

u.name AS user,

ch.title AS chapter

FROM comments c

LEFT JOIN users u
ON c.user_id=u.id

LEFT JOIN chapters ch
ON c.chapter_id=ch.id

ORDER BY c.id DESC
`

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.delete("/api/admin/comments/:id",async(req,res)=>{

try{

await pool.query(

`
DELETE FROM comments

WHERE id=$1
`,

[
req.params.id
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

app.get("/api/admin/analytics",async(req,res)=>{

try{

const reads=await pool.query(

"SELECT COALESCE(SUM(views),0) total FROM novels"

);

const rating=await pool.query(

"SELECT ROUND(AVG(rating),1) rating FROM novels"

);

const topNovel=await pool.query(

`
SELECT title

FROM novels

ORDER BY views DESC

LIMIT 1
`

);

const topWriter=await pool.query(

`
SELECT

u.name,

SUM(n.views) views

FROM users u

JOIN novels n

ON u.id=n.author_id

GROUP BY u.id

ORDER BY views DESC

LIMIT 1
`

);

const popular=await pool.query(

`
SELECT

title,

views,

rating

FROM novels

ORDER BY views DESC

LIMIT 10
`

);

res.json({

reads:reads.rows[0].total,

rating:rating.rows[0].rating||0,

topNovel:

topNovel.rows[0]?.title||"-",

topWriter:

topWriter.rows[0]?.name||"-",

popular:popular.rows

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.get("/api/admin/revenue",async(req,res)=>{

res.json({

totalRevenue:0,

writerPayouts:0,

platformRevenue:0,

pendingWithdrawals:0

});

});


app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});

