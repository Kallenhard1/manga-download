const express = require("express");
const app = express();
const port = 3000;

import fetch from "node-fetch";

const MangaDownloadr = require("./lib/manga-downloadr/manga-downloadr.js");

app.listen(port, () => {
  console.log(`Servidor funcionando na porta: ${port}.`);
});
