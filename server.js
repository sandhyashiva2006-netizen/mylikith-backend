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

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});

