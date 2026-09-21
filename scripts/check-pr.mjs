import fs from "node:fs";
const event = JSON.parse(
  fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
);
if (event.pull_request) {
  const body = event.pull_request.body || "";
  if (
    !/Documentation impact:\s*(behavior|configuration|maintenance|none)\s*(?:\r?\n|$)/i.test(
      body,
    )
  )
    throw Error("Declare one Documentation impact in the PR description.");
  if (
    !/https:\/\/github\.com\/ramideltoro\/pricedip-wiki\/(?:commit\/[a-f0-9]{40}|pull\/\d+)/i.test(
      body,
    )
  )
    throw Error("Reference the companion pricedip-wiki commit or PR.");
  console.log("PR documentation declaration verified");
}
