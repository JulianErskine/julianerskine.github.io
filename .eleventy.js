module.exports = function (eleventyConfig) {
  // Static assets copied as-is.
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/images");
  // Only the scripts: docs kept next to them (README.md) stay out of the site.
  eleventyConfig.addPassthroughCopy("src/js/**/*.js");
  // three.js for the simulator, served as plain ES modules (no bundler):
  // the core build plus the post-processing addons the page imports.
  eleventyConfig.addPassthroughCopy({
    "node_modules/three/build/three.module.js": "js/vendor/three/three.module.js",
    "node_modules/three/build/three.core.js": "js/vendor/three/three.core.js",
    "node_modules/three/LICENSE": "js/vendor/three/LICENSE",
  });
  for (const file of [
    "postprocessing/EffectComposer.js",
    "postprocessing/RenderPass.js",
    "postprocessing/UnrealBloomPass.js",
    "postprocessing/OutputPass.js",
    "postprocessing/ShaderPass.js",
    "postprocessing/MaskPass.js",
    "postprocessing/Pass.js",
    "shaders/CopyShader.js",
    "shaders/LuminosityHighPassShader.js",
    "shaders/OutputShader.js",
  ]) {
    eleventyConfig.addPassthroughCopy({
      [`node_modules/three/examples/jsm/${file}`]: `js/vendor/three/addons/${file}`,
    });
  }
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
