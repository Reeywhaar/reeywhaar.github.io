function main() {
  const path = process.argv[2];

  if (!path) throw new Error("Path required");

  const data = require(path);

  console.log(data.map(createProductDescription).join("\n"));
}

function createProductDescription(item) {
  return `- [${item.name}](https://apps.vyrtsev.com/${
    item.id
  }) - ${item.description.replace(
    /\n+/g,
    "\n"
  )}\n[Download on\u00a0the\u00a0AppStore](${item.app_store_link})`;
}

main();
