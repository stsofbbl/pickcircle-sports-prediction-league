const fs = require("fs");
const zlib = require("zlib");

let html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("styles.css", "utf8");
const js = fs.readFileSync("app.js", "utf8");

html = html.replace(
  '<link rel="stylesheet" href="./styles.css" />',
  `<style>\n${css}\n</style>`,
);
html = html.replace(
  '<script src="./app.js"></script>',
  `<script>\n${js}\n</script>`,
);

const data = zlib.gzipSync(Buffer.from(html, "utf8")).toString("base64");
const output = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Yoso League</title>
</head>
<body>
  <script>
    const data = ${JSON.stringify(data)};
    (async () => {
      const bin = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
      const html = await new Response(stream).text();
      document.open();
      document.write(html);
      document.close();
    })();
  </script>
</body>
</html>
`;

fs.writeFileSync("github-index.html", output, "utf8");
