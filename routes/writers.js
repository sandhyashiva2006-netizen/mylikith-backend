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


module.exports = router;