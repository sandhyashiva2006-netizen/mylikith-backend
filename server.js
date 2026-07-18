require("dotenv").config();


const express = require("express");
const cors = require("cors");

const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const compression = require("compression");

const bcrypt = require("bcryptjs");

const pool = require("./db");

const app = express();

app.set("trust proxy", 1);

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing.");
}

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many requests. Please try again later."
    }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many login attempts. Please try again after 15 minutes."
    }
});

const multer =
require("multer");

const { v2: cloudinary } = require("cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

cloudinary.config({

    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET

});

const path =
require("path");

const storage = new CloudinaryStorage({

    cloudinary,

    params:{

        folder:"mylikith/covers",

        allowed_formats:[
            "jpg",
            "jpeg",
            "png",
            "webp"
        ],

        public_id:()=>Date.now().toString()

    }

});


const upload = multer({

    storage,

    limits:{
        fileSize:5*1024*1024
    }

});

const authRoutes =
require("./routes/auth");
const {
    router: writerRoutes,
    publishChapter
} = require("./routes/writers");
const publishRoutes=require("./routes/publish.routes");
const{

router:walletRoutes,

rewardCoins

}=require("./routes/wallet");
const lockedRoutes =
require("./routes/locked-chapters");
const adminRoutes = require("./routes/admin");
const premiumRoutes=require("./routes/premium");
const manualPaymentRoutes =
require("./routes/manual-payments");
const pageRoutes = require("./routes/pages");


app.use(helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false
}));

app.use(cors({
    origin: [
        "https://mylikith-frontend.pages.dev",
        "https://mylikith.pages.dev",
        "https://mylikith.in",
        "https://www.mylikith.in"
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(compression());

app.use("/api", apiLimiter);

app.use(express.json({
    limit: "10mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "10mb"
}));

app.use("/api/auth", authLimiter, authRoutes);
app.use(
"/api/writers",
writerRoutes
);
app.use("/api/publish",publishRoutes);
app.use("/api/wallet", walletRoutes);
app.use(
"/api/locked",
lockedRoutes
);
app.use("/api/pages", pageRoutes);
app.use(

"/api/referrals",

require("./routes/referrals")

);



app.use("/api/admin", adminRoutes);
app.use("/api/premium",premiumRoutes);
app.use(
"/api/manual-payments",
manualPaymentRoutes
);


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

`
SELECT
    n.*,
    COALESCE((
        SELECT COUNT(*)
        FROM chapter_likes cl
        JOIN chapters c
        ON cl.chapter_id = c.id
        WHERE c.novel_id = n.id
    ),0) AS likes,

    COALESCE((
        SELECT COUNT(*)
        FROM reviews r
        WHERE r.novel_id = n.id
    ),0) AS reviews

FROM novels n

WHERE
LOWER(n.publish_status)='published'
AND
LOWER(n.approval_status)='approved'

ORDER BY
n.views DESC,
likes DESC,
n.rating DESC,
n.id DESC;
`

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

try{

const result=await pool.query(

`
SELECT *

FROM novels

WHERE id=$1
`,

[
req.params.id
]

);

if(!result.rows.length){

return res.status(404).json({

success:false

});

}

res.json(result.rows[0]);

}catch(err){

console.log(err);

res.status(500).json({

success:false

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

message: "Internal server error."

});

}

});

app.get(
"/api/public/chapters/:id",
async(req,res)=>{

try{

const result=await pool.query(

`
SELECT *

FROM chapters

WHERE

id=$1

AND

is_draft=false
`,

[
req.params.id
]

);

if(result.rows.length===0){

return res.status(404).json({

success:false

});

}

res.json(result.rows[0]);

}catch(err){

console.log(err);

res.status(500).json({

success:false

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
WHERE

novel_id=$1

AND

is_draft=false

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

LOWER(publish_status)='published'

AND

LOWER(approval_status)='approved'

AND
(

LOWER(title) LIKE LOWER($1)

OR

LOWER(language) LIKE LOWER($1)

OR

LOWER(category) LIKE LOWER($1)

)

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

await pool.query(

`
INSERT INTO reader_activity(

user_id,

activity_type,

title,

reference_id

)

VALUES($1,$2,$3,$4)
`,

[
user_id,
"review",
"Reviewed a novel",
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

app.get("/api/authors/:id/followers",async(req,res)=>{

try{

const limit=12;

const offset=

(Number(req.query.page||1)-1)*limit;

const total=await pool.query(

`
SELECT COUNT(*) total
FROM follows
WHERE author_id=$1
`,

[
req.params.id
]

);

const followers=await pool.query(

`
SELECT

u.id,

u.name,

u.role,

u.profile_image

FROM follows f

JOIN users u

ON f.user_id=u.id

WHERE f.author_id=$1

ORDER BY f.id DESC

LIMIT $2

OFFSET $3
`,

[
req.params.id,
limit,
offset
]

);

res.json({

followers:followers.rows,

totalFollowers:Number(total.rows[0].total),

hasMore:

offset+limit<

Number(total.rows[0].total)

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.post("/api/authors/:id/contact",async(req,res)=>{

try{

const{

user_id,

message

}=req.body;

await createNotification(

req.params.id,

"📩 New Reader Message",

message,

"author_contact",

user_id

);

res.json({

success:true,

message:"Your message has been sent."

});

}catch(err){

console.log(err);

res.status(500).json({

success:false,

message:"Unable to send message."

});

}

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

app.get("/api/authors/:id/followers", async(req,res)=>{

try{

const result=await pool.query(

`
SELECT

u.id,

u.name,

u.profile_image

FROM follows f

JOIN users u

ON f.user_id=u.id

WHERE f.author_id=$1

ORDER BY u.name
`,

[
req.params.id
]

);

res.json(result.rows);

}catch(err){

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

rp.progress_percent,

rp.updated_at,

c.chapter_no,

c.title AS chapter_title,

n.id AS novel_id,

n.title AS novel_title,

n.cover_url

FROM reading_progress rp

JOIN chapters c
ON rp.chapter_id=c.id

JOIN novels n
ON c.novel_id=n.id

WHERE rp.user_id=$1

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

app.post("/api/profile/change-password", async (req,res)=>{

try{

const{

user_id,

current_password,

new_password,

confirm_password

}=req.body;

if(!user_id||!current_password||!new_password||!confirm_password){

return res.status(400).json({

success:false,

message:"All fields are required."

});

}

if(new_password!==confirm_password){

return res.status(400).json({

success:false,

message:"Passwords do not match."

});

}

if(new_password.length<8){

return res.status(400).json({

success:false,

message:"Password must be at least 8 characters."

});

}

const user=await pool.query(

`
SELECT password_hash

FROM users

WHERE id=$1
`,

[user_id]

);

if(user.rows.length===0){

return res.status(404).json({

success:false,

message:"User not found."

});

}

const valid=await bcrypt.compare(

current_password,

user.rows[0].password_hash

);

if(!valid){

return res.status(400).json({

success:false,

message:"Current password is incorrect."

});

}

const hash=await bcrypt.hash(

new_password,

10

);

await pool.query(

`
UPDATE users

SET password_hash=$1

WHERE id=$2
`,

[
hash,
user_id
]

);

res.json({

success:true,

message:"Password changed successfully."

});

}catch(err){

console.log(err);

res.status(500).json({

success:false,

message:"Internal server error."

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



app.post(
"/api/upload-cover",

(req,res)=>{

upload.single("cover")(req,res,function(err){

if(err){

return res.status(400).json({

success:false,

message:err.message

});

}

if(!req.file){

return res.status(400).json({

success:false,

message:"No image selected."

});

}

res.json({

success:true,

url:req.file.path

});

});

});

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== "production") {

app.post(
"/api/upload/payment-proof",
upload.single("image"),
async(req,res)=>{

try{

if(!req.file){

return res.status(400).json({

success:false,

message:"Image required."

});

}

res.json({

success:true,

url:req.file.path

});

}catch(err){

console.log(err);

res.status(500).json({

success:false,

message:"Upload failed."

});

}

});


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
}

if (process.env.NODE_ENV !== "production") {



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
}

app.get("/api/users/:id", async (req, res) => {

try{

const author=await pool.query(
`
SELECT
id,
name,
bio,
profile_image,
website,
instagram,
facebook,
x,
youtube
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

app.put("/api/users/:id", async (req,res)=>{

try{

const{

bio,

website,

instagram,

facebook,

x,

youtube

}=req.body;

await pool.query(

`
UPDATE users

SET

bio=$1,

website=$2,

instagram=$3,

facebook=$4,

x=$5,

youtube=$6

WHERE id=$7
`,

[
bio||null,
website||null,
instagram||null,
facebook||null,
x||null,
youtube||null,
req.params.id
]

);

res.json({

success:true,

message:"Author profile updated successfully."

});

}catch(err){

console.log(err);

res.status(500).json({

success:false,

message:"Unable to update author profile."

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

`
INSERT INTO library
(user_id,novel_id)

VALUES($1,$2)

ON CONFLICT(user_id,novel_id)

DO NOTHING
`,

[
user_id,
novel_id
]

);

await pool.query(

`
INSERT INTO reader_activity(

user_id,

activity_type,

title,

reference_id

)

VALUES($1,$2,$3,$4)
`,

[
user_id,
"library",
"Added a novel to Library",
novel_id
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

app.get("/api/library/:userId",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT

l.id,

l.status,

l.progress,

l.last_chapter,

n.id AS novel_id,

n.title,

n.cover_url,

n.category,

n.language,

u.name AS author

FROM library l

JOIN novels n

ON l.novel_id=n.id

LEFT JOIN users u

ON n.author_id=u.id

WHERE l.user_id=$1

ORDER BY l.created_at DESC
`,

[req.params.userId]

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json({success:false});

}

});

app.delete("/api/library/:id",async(req,res)=>{

try{

await pool.query(

`

DELETE FROM library

WHERE id=$1

`,

[req.params.id]

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

app.put("/api/library/progress",async(req,res)=>{

try{

const{

user_id,

novel_id,

progress,

last_chapter

}=req.body;

await pool.query(

`

UPDATE library

SET

progress=$1,

last_chapter=$2

WHERE

user_id=$3

AND

novel_id=$4

`,

[

progress,

last_chapter,

user_id,

novel_id

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

app.put("/api/library/status",async(req,res)=>{

try{

const{

user_id,

novel_id,

status

}=req.body;

await pool.query(

`

UPDATE library

SET status=$1

WHERE

user_id=$2

AND novel_id=$3

`,

[

status,

user_id,

novel_id

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

app.post("/api/chapters/:id/like",async(req,res)=>{

try{

const{user_id}=req.body;

await pool.query(

`
INSERT INTO chapter_likes
(user_id,chapter_id)

VALUES($1,$2)

ON CONFLICT(user_id,chapter_id)

DO NOTHING
`,

[
user_id,
req.params.id
]

);

res.json({success:true});

}catch(err){

console.log(err);

res.status(500).json({success:false});

}

});

app.delete("/api/chapters/:id/like",async(req,res)=>{

try{

const{user_id}=req.body;

await pool.query(

`
DELETE FROM chapter_likes

WHERE

user_id=$1

AND

chapter_id=$2
`,

[
user_id,
req.params.id
]

);

res.json({success:true});

}catch(err){

console.log(err);

res.status(500).json({success:false});

}

});

app.get("/api/chapters/:id/likes",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT COUNT(*) total

FROM chapter_likes

WHERE chapter_id=$1
`,

[
req.params.id
]

);

res.json({

likes:Number(result.rows[0].total)

});

}catch(err){

console.log(err);

res.status(500).json({success:false});

}

});

app.get("/api/chapters/:id/liked/:userId",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT id

FROM chapter_likes

WHERE

chapter_id=$1

AND

user_id=$2
`,

[
req.params.id,
req.params.userId
]

);

res.json({

liked:result.rows.length>0

});

}catch(err){

console.log(err);

res.status(500).json({success:false});

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

const coinSales=await pool.query(
`
SELECT
COALESCE(SUM(amount),0) total
FROM wallet_transactions
WHERE type='Credit'
`
);

const writerEarnings=await pool.query(
`
SELECT
COALESCE(SUM(amount),0) total
FROM writer_earnings
`
);

const platform=await pool.query(
`
SELECT
platform_share
FROM platform_settings
LIMIT 1
`
);

const pending=await pool.query(
`
SELECT COUNT(*) total
FROM withdrawal_requests
WHERE status='Pending'
`
);

const completed=await pool.query(
`
SELECT COUNT(*) total
FROM withdrawal_requests
WHERE status IN('Approved','Completed')
`
);

const platformRevenue=

Number(writerEarnings.rows[0].total)

*

Number(platform.rows[0].platform_share)

/100;

res.json({

users:Number(users.rows[0].total),

writers:Number(writers.rows[0].total),

novels:Number(novels.rows[0].total),

chapters:Number(chapters.rows[0].total),

reviews:Number(reviews.rows[0].total),

comments:Number(comments.rows[0].total),

coin_sales:Number(
coinSales.rows[0].total
),

platform_revenue:platformRevenue,

pending_withdrawals:Number(
pending.rows[0].total
),

completed_withdrawals:Number(
completed.rows[0].total
)

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
u.profile_image,

COUNT(DISTINCT n.id) AS novels,

COUNT(DISTINCT f.id) AS followers

FROM users u

LEFT JOIN novels n
ON u.id = n.author_id

LEFT JOIN follows f
ON u.id = f.author_id

WHERE u.role='writer'

GROUP BY
u.id,
u.name,
u.profile_image

ORDER BY
followers DESC,
novels DESC,
u.name ASC

LIMIT 4;
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

r.review,

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

app.get("/api/admin/analytics", async(req,res)=>{

try{

const users=await pool.query(
`SELECT COUNT(*) total FROM users`
);

const writers=await pool.query(
`SELECT COUNT(*) total FROM users WHERE role='writer'`
);

const novels=await pool.query(
`SELECT COUNT(*) total FROM novels`
);

const chapters=await pool.query(
`SELECT COUNT(*) total FROM chapters`
);

const reads=await pool.query(
`
SELECT COALESCE(SUM(views),0) total
FROM novels
`
);

const rating=await pool.query(
`
SELECT
COALESCE(ROUND(AVG(rating),1),0) rating
FROM novels
`
);

const coinSales=await pool.query(
`
SELECT
COALESCE(SUM(amount),0) total
FROM wallet_transactions
WHERE type='Credit'
`
);

const coinsSpent=await pool.query(
`
SELECT
COALESCE(SUM(coins),0) total
FROM wallet_transactions
WHERE type='Debit'
`
);

const pending=await pool.query(
`
SELECT COUNT(*) total
FROM withdrawal_requests
WHERE status='Pending'
`
);

const completed=await pool.query(
`
SELECT COUNT(*) total
FROM withdrawal_requests
WHERE status IN('Approved','Completed')
`
);

const topNovel=await pool.query(
`
SELECT
title,
views,
rating
FROM novels
ORDER BY views DESC
LIMIT 1
`
);

const topWriter=await pool.query(
`
SELECT

u.name,

COALESCE(SUM(we.amount),0) earnings

FROM users u

LEFT JOIN writer_earnings we

ON u.id=we.writer_id

WHERE u.role='writer'

GROUP BY u.id

ORDER BY earnings DESC

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

users:Number(users.rows[0].total),

writers:Number(writers.rows[0].total),

novels:Number(novels.rows[0].total),

chapters:Number(chapters.rows[0].total),

reads:Number(reads.rows[0].total),

rating:Number(rating.rows[0].rating),

coinSales:Number(coinSales.rows[0].total),

coinsSpent:Number(coinsSpent.rows[0].total),

pendingWithdrawals:Number(pending.rows[0].total),

completedWithdrawals:Number(completed.rows[0].total),

topNovel:
topNovel.rows[0]?.title||"-",

topWriter:
topWriter.rows[0]?.name||"-",

popular:
popular.rows

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.get("/api/admin/revenue", async (req, res) => {

    try {

        const coinSales = await pool.query(`
            SELECT COALESCE(SUM(amount),0) total
            FROM wallet_transactions
            WHERE type='Credit'
        `);

        const writerRevenue = await pool.query(`
            SELECT COALESCE(SUM(amount),0) total
            FROM writer_earnings
        `);

        const paid = await pool.query(`
            SELECT COALESCE(SUM(amount),0) total
            FROM withdrawal_requests
            WHERE status IN ('Approved','Completed')
        `);

        const pending = await pool.query(`
            SELECT COALESCE(SUM(amount),0) total
            FROM withdrawal_requests
            WHERE status='Pending'
        `);

        const settings = await pool.query(`
            SELECT
                writer_share,
                platform_share
            FROM platform_settings
            LIMIT 1
        `);

        const writerShare =
            Number(settings.rows[0].writer_share);

        const platformShare =
            Number(settings.rows[0].platform_share);

        const totalRevenue =
            Number(coinSales.rows[0].total);

        const platformRevenue =
            totalRevenue * platformShare / 100;

        res.json({

            totalRevenue,

            writerPayouts:
                Number(paid.rows[0].total),

            platformRevenue,

            pendingWithdrawals:
                Number(pending.rows[0].total),

            writerShare,

            platformShare

        });

    } catch (err) {

        console.log(err);

        res.status(500).json({

            success: false

        });

    }

});

app.get("/api/feed/:userId",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT *

FROM reader_feed

WHERE user_id=$1

ORDER BY id DESC

LIMIT 50
`,

[
req.params.userId
]

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json([]);

}

});

app.get("/api/notifications/:userId",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT *

FROM reader_notifications

WHERE user_id=$1

ORDER BY id DESC

LIMIT 50
`,

[
req.params.userId
]

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json([]);

}

});

app.put("/api/notifications/:id/read",async(req,res)=>{

try{

await pool.query(

`
UPDATE reader_notifications

SET is_read=TRUE

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

app.get("/api/activity/:userId",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT *

FROM reader_activity

WHERE user_id=$1

ORDER BY id DESC

LIMIT 50
`,

[
req.params.userId
]

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json([]);

}

});

app.post("/api/streak/update",async(req,res)=>{

try{

const{user_id}=req.body;

const existing=await pool.query(

`
SELECT *

FROM reader_streaks

WHERE user_id=$1
`,

[user_id]

);

const today=new Date();

const todayString=today.toISOString().split("T")[0];

if(existing.rows.length===0){

await pool.query(

`
INSERT INTO reader_streaks(

user_id,

current_streak,

best_streak,

last_read_date

)

VALUES($1,1,1,$2)
`,

[
user_id,
todayString
]

);

return res.json({

success:true

});

}

const streak=existing.rows[0];

const last=new Date(streak.last_read_date);

const diff=Math.floor(

(today-last)/(1000*60*60*24)

);

let current=streak.current_streak;

if(diff===1){

current++;

}else if(diff>1){

current=1;

}else{

return res.json({

success:true

});

}

const best=Math.max(

current,

streak.best_streak

);

await pool.query(

`
UPDATE reader_streaks

SET

current_streak=$1,

best_streak=$2,

last_read_date=$3,

updated_at=NOW()

WHERE user_id=$4
`,

[
current,
best,
todayString,
user_id
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

app.get("/api/streak/:userId",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT *

FROM reader_streaks

WHERE user_id=$1
`,

[
req.params.userId
]

);

res.json(

result.rows[0]||

{

current_streak:0,

best_streak:0

}

);

}catch(err){

console.log(err);

res.status(500).json({

current_streak:0,

best_streak:0

});

}

});


app.post("/api/daily-reward",async(req,res)=>{

try{

const{user_id}=req.body;

const today=new Date().toISOString().split("T")[0];

const existing=await pool.query(

`
SELECT *

FROM daily_rewards

WHERE user_id=$1
`,

[user_id]

);

if(existing.rows.length===0){

await pool.query(

`
INSERT INTO daily_rewards

(user_id,last_claim,claim_streak)

VALUES($1,$2,1)
`,

[
user_id,
today
]

);

await pool.query(

`
UPDATE wallets

SET

coins=coins+2,

earned_coins=earned_coins+2

WHERE user_id=$1
`,

[user_id]

);

return res.json({

success:true,

coins:2,

streak:1

});

}

const reward=existing.rows[0];

const last=new Date(reward.last_claim);

const now=new Date(today);

const diff=Math.floor(

(now-last)/(1000*60*60*24)

);

if(diff===0){

return res.json({

success:false,

message:"Already claimed today."

});

}

let streak=reward.claim_streak;

if(diff===1){

streak++;

}else{

streak=1;

}

let coins=2;

if(streak===7) coins=10;

if(streak===30) coins=50;

await pool.query(

`
UPDATE daily_rewards

SET

last_claim=$1,

claim_streak=$2

WHERE user_id=$3
`,

[
today,
streak,
user_id
]

);

await pool.query(

`
UPDATE wallets

SET

coins=coins+$1,

earned_coins=earned_coins+$1

WHERE user_id=$2
`,

[
coins,
user_id
]

);

await pool.query(

`
INSERT INTO wallet_transactions
(
wallet_id,
user_id,
type,
coins,
amount,
description,
expiry_date
)

SELECT

id,

user_id,

'Credit',

$1,

0,

'Daily Reward',

NOW()+INTERVAL '30 days'

FROM wallets

WHERE user_id=$2
`,

[
coins,
user_id
]

);

res.json({

success:true,

coins,

streak

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

app.get("/api/daily-reward/:userId",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT *

FROM daily_rewards

WHERE user_id=$1
`,

[
req.params.userId
]

);

res.json(

result.rows[0]||

{

claim_streak:0

}

);

}catch(err){

console.log(err);

res.status(500).json({

claim_streak:0

});

}

});

app.post("/api/goals/update",async(req,res)=>{

try{

const{user_id}=req.body;

const goal=await pool.query(

`
SELECT *

FROM reader_goals

WHERE user_id=$1
`,

[user_id]

);

if(goal.rows.length===0){

return res.json({

success:true

});

}

await pool.query(

`
UPDATE reader_goals

SET

progress=progress+1,

updated_at=NOW()

WHERE user_id=$1
`,

[user_id]

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

app.post("/api/goals",async(req,res)=>{

try{

const{

user_id,

goal_type,

target

}=req.body;

await pool.query(

`
INSERT INTO reader_goals(

user_id,

goal_type,

target

)

VALUES($1,$2,$3)

ON CONFLICT(user_id)

DO UPDATE SET

goal_type=$2,

target=$3,

progress=0,

updated_at=NOW()
`,

[
user_id,
goal_type,
target
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

app.get("/api/goals/:userId",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT *

FROM reader_goals

WHERE user_id=$1
`,

[
req.params.userId
]

);

res.json(

result.rows[0]||

{

goal_type:"Chapters",

target:0,

progress:0

}

);

}catch(err){

console.log(err);

res.status(500).json({

goal_type:"Chapters",

target:0,

progress:0

});

}

});

app.post("/api/rewards/expire",async(req,res)=>{

try{

const expired=await pool.query(

`
SELECT

wallet_id,

user_id,

SUM(coins) coins

FROM wallet_transactions

WHERE

description='Daily Reward'

AND expired=false

AND expiry_date<=NOW()

GROUP BY wallet_id,user_id
`

);

for(const row of expired.rows){

await pool.query(

`
UPDATE wallets

SET

coins=GREATEST(coins-$1,0)

WHERE user_id=$2
`,

[
row.coins,
row.user_id
]

);

await pool.query(

`
UPDATE wallet_transactions

SET expired=true

WHERE

user_id=$1

AND description='Daily Reward'

AND expired=false

AND expiry_date<=NOW()
`,

[
row.user_id
]

);

}

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

setInterval(async()=>{

try{

await fetch(

`${process.env.APP_URL}/api/rewards/expire`,

{

method:"POST"

}

);

}catch(e){}

},3600000);

app.get("/api/recommendations/:userId", async (req, res) => {

try{

const userId=req.params.userId;

const result=await pool.query(

`
SELECT

n.*,

COUNT(l.id) AS score

FROM novels n

LEFT JOIN library l
ON n.category IN(

SELECT DISTINCT n2.category

FROM library lb

JOIN novels n2
ON lb.novel_id=n2.id

WHERE lb.user_id=$1

)

WHERE

LOWER(n.publish_status)='published'

AND

LOWER(n.approval_status)='approved'

AND

n.id NOT IN(

SELECT novel_id

FROM library

WHERE user_id=$1

)

GROUP BY n.id

ORDER BY

score DESC,

n.views DESC,

n.rating DESC,

n.created_at DESC

LIMIT 12
`,

[
userId
]

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json([]);

}

});

app.post("/api/search/history",async(req,res)=>{

try{

const{

user_id,

keyword

}=req.body;

await pool.query(

`
DELETE FROM recent_searches

WHERE

user_id=$1

AND keyword=$2
`,

[
user_id,
keyword
]

);

await pool.query(

`
INSERT INTO recent_searches(

user_id,

keyword

)

VALUES($1,$2)
`,

[
user_id,
keyword
]

);

await pool.query(

`
INSERT INTO search_trends(

keyword,

search_count

)

VALUES($1,1)

ON CONFLICT(keyword)

DO UPDATE SET

search_count=
search_trends.search_count+1,

updated_at=NOW()
`,

[
keyword
]

);

await pool.query(

`
DELETE FROM recent_searches

WHERE id IN(

SELECT id

FROM recent_searches

WHERE user_id=$1

ORDER BY searched_at DESC

OFFSET 10

)
`,

[user_id]

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

app.get("/api/search/history/:userId",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT *

FROM recent_searches

WHERE user_id=$1

ORDER BY searched_at DESC
`,

[
req.params.userId
]

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json([]);

}

});

app.delete("/api/search/history/:userId",async(req,res)=>{

try{

await pool.query(

`
DELETE FROM recent_searches

WHERE user_id=$1
`,

[
req.params.userId
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

app.get("/api/search/trending",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT *

FROM search_trends

ORDER BY

search_count DESC,

updated_at DESC

LIMIT 10
`

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json([]);

}

});

app.get("/api/novels/:id/similar",async(req,res)=>{

try{

const novel=await pool.query(

`
SELECT category,language

FROM novels

WHERE id=$1
`,

[
req.params.id
]

);

if(!novel.rows.length){

return res.json([]);

}

const result=await pool.query(

`
SELECT *

FROM novels

WHERE

id<>$1

AND

LOWER(publish_status)='published'

AND

LOWER(approval_status)='approved'

AND

(

category=$2

OR

language=$3

)

ORDER BY

views DESC,

rating DESC

LIMIT 6
`,

[
req.params.id,
novel.rows[0].category,
novel.rows[0].language
]

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json([]);

}

});

app.get("/api/novels/:id/also-read",async(req,res)=>{

try{

const result=await pool.query(

`
SELECT

n.id,

n.title,

n.cover_url,

n.category,

COUNT(*) score

FROM library l1

JOIN library l2
ON l1.user_id=l2.user_id

JOIN novels n
ON n.id=l2.novel_id

WHERE

l1.novel_id=$1

AND l2.novel_id<>$1

AND

LOWER(n.publish_status)='published'

AND

LOWER(n.approval_status)='approved'

GROUP BY

n.id

ORDER BY

score DESC,

n.views DESC

LIMIT 6
`,

[
req.params.id
]

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json([]);

}

});

app.post(
"/api/profile/upload",

(req,res)=>{

upload.single("photo")(req,res,async function(err){

try{

if(err){

return res.status(400).json({

success:false,

message:err.message

});

}

if(!req.file){

return res.status(400).json({

success:false,

message:"No image selected."

});

}

const{

user_id

}=req.body;

await pool.query(

`
UPDATE users

SET profile_image=$1

WHERE id=$2
`,

[
req.file.path,
user_id
]

);

res.json({

success:true,

url:req.file.path

});

}catch(e){

console.log(e);

res.status(500).json({

success:false

});

}

});

});

app.post(
"/api/payment/upload",
require("./middleware/auth"),

(req,res)=>{

upload.single("payment")(req,res,function(err){

if(err){

return res.status(400).json({

success:false,

message:err.message

});

}

if(!req.file){

return res.status(400).json({

success:false,

message:"No image selected."

});

}

res.json({

success:true,

url:req.file.path

});

});

});

app.get("/api/authors/:id",async(req,res)=>{

try{

const author=await pool.query(

`
SELECT

id,

name,

bio,

profile_image,

website,

instagram,

facebook,

x,

youtube

FROM users

WHERE

id=$1

AND role='writer'
`,

[
req.params.id
]

);

if(!author.rows.length){

return res.status(404).json({

success:false

});

}

const stats=await pool.query(

`
SELECT

COUNT(n.id) AS novels,

COALESCE(SUM(n.views),0) AS views,

COALESCE(
ROUND(
AVG(
CASE
WHEN n.rating > 0 THEN n.rating
END
),
1
),
0
) AS rating,

(
SELECT COUNT(*)
FROM follows
WHERE author_id=$1
) AS followers,

(
SELECT COUNT(*)
FROM chapters c
JOIN novels n2
ON c.novel_id=n2.id
WHERE
n2.author_id=$1
AND LOWER(n2.publish_status)='published'
AND LOWER(n2.approval_status)='approved'
) AS chapters,

(
SELECT COALESCE(COUNT(*),0)
FROM chapter_likes cl
JOIN chapters c
ON cl.chapter_id=c.id
JOIN novels n3
ON c.novel_id=n3.id
WHERE
n3.author_id=$1
AND LOWER(n3.publish_status)='published'
AND LOWER(n3.approval_status)='approved'
) AS likes,

COALESCE(
ROUND(
SUM(n.views)::numeric
/
NULLIF(COUNT(n.id),0),
0
),
0
) AS average_views

FROM novels n

WHERE
n.author_id=$1
AND LOWER(n.publish_status)='published'
AND LOWER(n.approval_status)='approved';
`,

[
req.params.id
]

);

const novels=await pool.query(

`
SELECT

id,
title,
cover_url,
category,
language,
views

FROM novels

WHERE

author_id=$1

AND

LOWER(publish_status)='published'

AND

LOWER(approval_status)='approved'

ORDER BY views DESC
`,

[
req.params.id
]

);

const followers = await pool.query(
`
SELECT COUNT(*) total
FROM follows
WHERE author_id=$1
`,
[req.params.id]
);

res.json({

author:author.rows[0],

stats:{
...stats.rows[0],
followers:Number(stats.rows[0].followers)
},

novels:novels.rows

});


}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

const cron=require("node-cron");

cron.schedule("* * * * *",async()=>{

try{

const chapters=await pool.query(

`
SELECT id

FROM chapters

WHERE

is_draft=true

AND

is_scheduled=true

AND

publish_at<=NOW()
`

);

for(const chapter of chapters.rows){

await publishChapter(chapter.id);

}

}catch(err){

console.log(err);

}

});

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});

