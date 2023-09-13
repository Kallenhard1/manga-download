const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const axios = require("axios");
const cheerio = require("cheerio");
const async = require("async");
const mkdirp = require("mkdirp");
const Jimp = require("jimp");
const PDFDocument = require("pdfkit");
const fastimage = require("fastimage");
const yaml = require("js-yaml");

import fetch from "node-fetch";

class MangaDownloadr {
  constructor(rootUrl, mangaName, options = {}) {
    this.mangaRootUrl = rootUrl;
    this.mangaRoot = options.mangaRoot || "/vagrant/tmp/mangareader/";
    this.mangaRootFolder = path.join(this.mangaRoot, mangaName);
    this.mangaName = mangaName;

    this.hydraConcurrency = options.hydraConcurrency || 100;

    this.chapterList = [];
    this.chapterPages = {};
    this.chapterImages = {};
    this.downloadLinks = [];
    this.chapterPagesCount = 0;
    this.mangaTitle = "";
    this.pagesPerVolume = options.pagesPerVolume || 250;
    this.pageSize = options.pageSize || [600, 800];
    this.processingState = [];
  }

  async fetchChapterUrls() {
    try {
      const response = await axios.get(this.mangaRootUrl);
      const $ = cheerio.load(response.data);

      this.chapterList = $("#listing a")
        .map((_, element) => $(element).attr("href"))
        .get();
      this.mangaTitle = $("#mangaproperties h1").first().text();

      this.currentState("chapterUrls");
    } catch (error) {
      console.error("Error fetching chapter URLs:", error);
    }
  }

  async fetchPageUrls() {
    const hydra = new axios.Axios({
      maxRequestsPerSecond: this.hydraConcurrency,
    });

    await async.eachLimit(
      this.chapterList,
      this.hydraConcurrency,
      async (chapterLink) => {
        try {
          const response = await hydra.get(
            `http://www.mangareader.net${chapterLink}`
          );
          const $ = cheerio.load(response.data);
          const pages = $("#selectpage #pageMenu option")
            .map((_, element) => $(element).attr("value"))
            .get();
          this.chapterPages[chapterLink] = pages;
          console.log(".");
        } catch (error) {
          console.error("Error fetching page URLs:", error);
        }
      }
    );

    this.chapterPagesCount = Object.values(this.chapterPages).reduce(
      (total, list) => total + list.length,
      0
    );
    this.currentState("pageUrls");
  }

  async fetchImageUrls() {
    const hydra = new axios.Axios({
      maxRequestsPerSecond: this.hydraConcurrency,
    });

    await async.eachLimit(
      this.chapterList,
      this.hydraConcurrency,
      async (chapterKey) => {
        this.chapterImages[chapterKey] = [];

        await async.eachLimit(
          this.chapterPages[chapterKey],
          this.hydraConcurrency,
          async (pageLink) => {
            try {
              const response = await hydra.get(
                `http://www.mangareader.net${pageLink}`
              );
              const $ = cheerio.load(response.data);
              const image = $("#img").first();
              const tokens = image.attr("alt").match(/^(.*?)\s-\s(.*?)$/);
              const extension = path.extname(
                new URL(image.attr("src")).pathname
              );

              this.chapterImages[chapterKey].push({
                folder: tokens[1],
                filename: `${tokens[2]}${extension}`,
                url: image.attr("src"),
              });
              console.log(".");
            } catch (error) {
              console.error("Error fetching image URLs:", error);
            }
          }
        );
      }
    );

    this.currentState("imageUrls");
  }

  async fetchImages() {
    const hydra = new axios.Axios({
      maxRequestsPerSecond: this.hydraConcurrency,
    });

    await async.eachLimit(
      this.chapterList,
      this.hydraConcurrency,
      async (chapterKey) => {
        await async.eachLimit(
          this.chapterImages[chapterKey],
          this.hydraConcurrency,
          async (file) => {
            const downloadedFilename = path.join(
              this.mangaRootFolder,
              file.folder,
              file.filename
            );

            if (fs.existsSync(downloadedFilename)) {
              return; // Skip if the file already exists
            }

            try {
              const response = await hydra.get(file.url, {
                responseType: "arraybuffer",
              });
              const imageBuffer = Buffer.from(response.data);

              await mkdirp(path.dirname(downloadedFilename));
              fs.writeFileSync(downloadedFilename, imageBuffer);

              const image = await Jimp.read(downloadedFilename);
              await image.resize(this.pageSize[0], this.pageSize[1]);
              await image.quality(50);
              await image.writeAsync(downloadedFilename);

              console.log(".");
            } catch (error) {
              console.error("Error fetching images:", error);
            }
          }
        );
      }
    );

    this.currentState("images");
  }

  async compileEbooks() {
    const folders = fs
      .readdirSync(this.mangaRootFolder, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .sort((a, b) => a.name.split(" ").pop() - b.name.split(" ").pop());

    this.downloadLinks = folders.reduce((list, folder) => {
      const files = fs
        .readdirSync(path.join(this.mangaRootFolder, folder))
        .sort((a, b) => {
          return a.split(" ").pop() - b.split(" ").pop();
        });
      return [
        ...list,
        ...files.map((file) => path.join(this.mangaRootFolder, folder, file)),
      ];
    }, []);

    let chapterNumber = 0;
    while (this.downloadLinks.length > 0) {
      chapterNumber++;
      const pdfFile = path.join(
        this.mangaRootFolder,
        `${this.mangaTitle} ${chapterNumber}.pdf`
      );
      const list = this.downloadLinks.splice(0, this.pagesPerVolume);

      const doc = new PDFDocument({ autoFirstPage: false });
      doc.pipe(fs.createWriteStream(pdfFile));

      for (const imageFile of list) {
        const imageBuffer = fs.readFileSync(imageFile);
        const dimensions = fastimage.sizeSync(imageBuffer);
        const [width, height] = this.pageSize;
        const aspectRatio = dimensions.width / dimensions.height;
        const newWidth = Math.min(width, dimensions.width);
        const newHeight = newWidth / aspectRatio;

        doc.addPage({ size: [width, height] });
        doc.image(imageFile, 0, 0, { width: newWidth, height: newHeight });
      }

      doc.end();
      console.log(".");
    }

    this.currentState("ebooks");
  }

  state(state) {
    return this.processingState.includes(state);
  }

  currentState(state) {
    this.processingState.push(state);
    this.serialize(this);
  }

  static serialize(obj) {
    try {
      const dumpFileName = path.join("/tmp", `${obj.mangaName}.yaml`);
      fs.writeFileSync(dumpFileName, yaml.dump(obj));
    } catch (error) {
      console.error("Error serializing:", error);
    }
  }

  static create(rootUrl, mangaName, options = {}) {
    const dumpFileName = path.join("/tmp", `${mangaName}.yaml`);
    if (fs.existsSync(dumpFileName)) {
      try {
        return yaml.load(fs.readFileSync(dumpFileName));
      } catch (error) {
        console.error("Error loading serialized object:", error);
      }
    }
    return new MangaDownloadr(rootUrl, mangaName, options);
  }
}

module.exports = MangaDownloadr;
