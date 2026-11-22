module.exports = function (eleventyConfig) {
  // Static assets copied as-is.
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/images");
  eleventyConfig.addPassthroughCopy("src/js");
  eleventyConfig.addPassthroughCopy("src/cv/*.pdf");

  // Projects collection: every markdown file under src/projects/ (except
  // the listing page itself), newest first.
  eleventyConfig.addCollection("projects", (collectionApi) =>
    collectionApi.getFilteredByGlob("src/projects/*.md").sort(
      (a, b) => b.date - a.date
    )
  );

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
  };
};
