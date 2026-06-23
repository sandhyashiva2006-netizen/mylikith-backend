require("dotenv").config();

const express = require("express");
const cors = require("cors");

const pool = require("./db");

const app = express();

const authRoutes =
require("./routes/auth");
const writerRoutes =
require("./routes/writers");



app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use(
"/api/writers",
writerRoutes
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
  try {

    const result = await pool.query(
      "SELECT * FROM chapters WHERE id=$1",
      [req.params.id]
    );

    res.json(result.rows[0]);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Failed to load chapter"
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

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});

