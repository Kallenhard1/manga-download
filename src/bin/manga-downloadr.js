#!/usr/bin/env node
const path = require("path");
const commander = require("commander");
const MangaGenerator = require("../lib/manga-downloadr/manga-downloadr.js"); // You may need to adjust the path

const program = new commander.Command();

program
  .version("1.0.0")
  .description("Manga Downloader")
  .option("-u, --url <url>", "Full MangaReader.net manga homepage URL")
  .option(
    "-n, --name <name>",
    "Slug to be used for the sub-folder to store all manga files"
  )
  .option(
    "-d, --directory <directory>",
    "Main folder where all mangas will be stored"
  )
  .parse(process.argv);

const options = program.opts();

const generator = new MangaGenerator(options.url, options.name, {
  mangaRoot: options.directory,
});

async function main() {
  try {
    if (!generator.state("chapterUrls")) {
      console.log("Massive parallel scanning of all chapters");
      await generator.fetchChapterUrls();
      console.log(`\nTotal page links found: ${generator.chapterPagesCount}`);
    }

    if (!generator.state("pageUrls")) {
      console.log("\nMassive parallel scanning of all pages");
      await generator.fetchPageUrls();
    }

    if (!generator.state("imageUrls")) {
      console.log("\nMassive parallel scanning of all images");
      await generator.fetchImageUrls();
    }

    if (!generator.state("images")) {
      console.log("\nMassive parallel download of all page images");
      await generator.fetchImages();
    }

    if (!generator.state("ebooks")) {
      console.log("\nCompiling all images into PDF volumes");
      await generator.compileEbooks();
    }

    console.log("\nProcess finished.");
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

main();
