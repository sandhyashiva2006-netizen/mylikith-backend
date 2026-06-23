const express = require("express");
const db = require("../db");

const router = express.Router();

router.post("/novels", async (req, res) => {

try {

const {
author_id,
title,
description,
language,
category
} = req.body;

const result =
await db.query(

`
INSERT INTO novels
(
author_id,
title,
description,
language,
category
)

VALUES
($1,$2,$3,$4,$5)

RETURNING *
`,

[
author_id,
title,
description,
language,
category
]

);

res.json({
success:true,
novel:result.rows[0]
});

}

catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.get(
"/my-novels/:authorId",
async (req,res)=>{

try{

const result =
await db.query(

`
SELECT *
FROM novels
WHERE author_id=$1
ORDER BY id DESC
`,

[
req.params.authorId
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

router.delete(
"/novels/:id",
async (req,res)=>{

try{

await db.query(

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

}

catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.post(
"/chapters",
async (req,res)=>{

try{

const {
novel_id,
chapter_no,
title,
content
} = req.body;

const result =
await db.query(

`
INSERT INTO chapters
(
novel_id,
chapter_no,
title,
content
)

VALUES
($1,$2,$3,$4)

RETURNING *
`,

[
novel_id,
chapter_no,
title,
content
]

);

res.json({
success:true,
chapter:result.rows[0]
});

}

catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.put(
"/novels/:id",
async (req,res)=>{

try{

const {
title,
description,
language,
category
} = req.body;

const result =
await db.query(

`
UPDATE novels

SET

title=$1,
description=$2,
language=$3,
category=$4

WHERE id=$5

RETURNING *
`,

[
title,
description,
language,
category,
req.params.id
]

);

res.json({
success:true,
novel:result.rows[0]
});

}

catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.get(
"/chapters/:novelId",
async (req,res)=>{

try{

const result =
await db.query(

`
SELECT *
FROM chapters
WHERE novel_id=$1
ORDER BY chapter_no ASC
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

router.delete(
"/chapters/:id",
async (req,res)=>{

try{

await db.query(

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

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.put(
"/chapters/:id",
async (req,res)=>{

try{

const {
title,
content
} = req.body;

const result =
await db.query(

`
UPDATE chapters

SET

title=$1,
content=$2

WHERE id=$3

RETURNING *
`,

[
title,
content,
req.params.id
]

);

res.json({
success:true,
chapter:result.rows[0]
});

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});



module.exports = router;